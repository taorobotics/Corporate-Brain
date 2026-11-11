import { Agent } from "undici";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { once } from "node:events";

const blocked = new BlockList();
for (const [ip, mask] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(ip, mask, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
export function publicModelAddress(address: string) {
  const kind = isIP(address);
  return kind === 4
    ? !blocked.check(address, "ipv4")
    : kind === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
export function personalModelUrl(value: string) {
  const u = new URL(value),
    host = u.hostname.replace(/^\[|\]$/g, "");
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) && !publicModelAddress(host))
  )
    throw Error(
      "个人模型需使用公网 HTTPS 地址，不能连接内网、本机或包含账号及查询参数的地址",
    );
  return u.toString().replace(/\/+$/, "");
}
// Validate the actual DNS results used by the socket, including reconnects.
export function publicModelLookup(
  hostname: any,
  options: any,
  callback: any,
  resolver: typeof lookup = lookup,
) {
  resolver(hostname, { all: true, verbatim: true }, (error, records) => {
    if (error) return callback(error);
    if (!records.length || records.some((r) => !publicModelAddress(r.address)))
      return callback(Error("Personal model resolved to a non-public address"));
    const candidates = options.family
      ? records.filter((r) => r.family === options.family)
      : records;
    if (!candidates.length)
      return callback(Error("No permitted model address"));
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  });
}
// Project-scoped DNS repair for explicitly configured upstream hostnames. The
// URL/SNI and certificate validation remain unchanged; NAS/system DNS is untouched.
export function scopedModelLookup(
  hosts: Set<string>,
  fallback: typeof lookup = lookup,
  resolve = async (hostname: string) => {
    const response = await fetch(
      "https://dns.google/resolve?type=A&name=" + encodeURIComponent(hostname),
      { signal: AbortSignal.timeout(10000), redirect: "error" },
    );
    if (!response.ok) throw Error("Model DNS lookup failed");
    const result = (await response.json()) as {
      Status?: number;
      Answer?: { type: number; data: string; TTL: number }[];
    };
    if (result.Status !== 0) throw Error("Model DNS lookup failed");
    return (result.Answer ?? [])
      .filter((a) => a.type === 1)
      .map((a) => ({ address: a.data, ttl: a.TTL }));
  },
) {
  const cache = new Map<
    string,
    { until: number; records: { address: string; ttl: number }[] }
  >();
  return ((hostname: string, options: any, callback: any) => {
    if (!hosts.has(hostname.toLowerCase()))
      return (fallback as any)(hostname, options, callback);
    (async () => {
      let saved = cache.get(hostname);
      if (!saved || saved.until <= Date.now()) {
        const records = await resolve(hostname);
        if (
          !records.length ||
          records.length > 64 ||
          records.some(
            (r) => !publicModelAddress(r.address) || isIP(r.address) !== 4,
          )
        )
          throw Error(
            "Model DNS returned a non-public or missing IPv4 address",
          );
        saved = {
          records,
          until:
            Date.now() +
            Math.max(
              1,
              Math.min(
                300,
                ...records.map((r) => (Number.isFinite(r.ttl) ? r.ttl : 1)),
              ),
            ) *
              1000,
        };
        cache.set(hostname, saved);
      }
      if (options.family === 6) throw Error("No permitted IPv6 model address");
      const records = saved.records.map((r) => ({
        address: r.address,
        family: 4,
      }));
      return options.all ? [null, records] : [null, records[0].address, 4];
    })().then(
      (args) => callback(...args),
      (error) => callback(error),
    );
  }) as typeof lookup;
}
// Server .env files load after static imports. Refresh the shared set lazily so
// both dispatchers see deployment configuration without depending on import order.
const dohHosts = new Set<string>();
let configuredDohHosts: string | undefined;
function refreshDohHosts() {
  const value = process.env.BRAIN_MODEL_DOH_HOSTS ?? "";
  if (value === configuredDohHosts) return;
  dohHosts.clear();
  for (const host of value
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean))
    dohHosts.add(host);
  configuredDohHosts = value;
}
const companyLookup = scopedModelLookup(dohHosts);
export function modelUsesCustomDns(value: string) {
  refreshDohHosts();
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && dohHosts.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
// Callers own cancellation and inactivity; a slow image response must not hit
// Undici's separate five-minute headers/body deadline.
const companyAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connect: { lookup: companyLookup },
});
const publicAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connect: {
    lookup: ((host: any, options: any, callback: any) =>
      publicModelLookup(host, options, callback, companyLookup)) as any,
  },
});
export type ModelTransport = (
  row: Record<string, any>,
  url: string,
  init: RequestInit,
) => Promise<Response>;

export function modelConnectionErrorCode(error: unknown) {
  const value = error as { cause?: { code?: string }; code?: string } | null;
  const code = value?.cause?.code ?? value?.code ?? "";
  return [
    "ECONNRESET",
    "EPIPE",
    "ECONNREFUSED",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
  ].includes(code)
    ? code
    : undefined;
}

/** Only retry connection failure before receiving headers, never a partial reply or tool run. */
export async function retryModelConnection(
  request: () => Promise<Response>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  try {
    return await request();
  } catch (error) {
    signal.throwIfAborted();
    if (!modelConnectionErrorCode(error)) throw error;
    return request();
  }
}

export const modelFetch: ModelTransport = async (row, url, init) => {
  refreshDohHosts();
  if (!row.owner_user_id || row.source_service_id)
    return row.kind === "image" || modelUsesCustomDns(url)
      ? fetch(url, {
          ...init,
          dispatcher: companyAgent,
          redirect: "error",
        } as RequestInit)
      : fetch(url, init);
  personalModelUrl(url);
  return fetch(url, {
    ...init,
    redirect: "error",
    dispatcher: publicAgent,
  } as RequestInit);
};

/** DSH keeps its tools while all personal-provider traffic uses guarded egress. */
export async function privateModelProxy(
  row: Record<string, any>,
  apiKey: string,
  transport: ModelTransport,
) {
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      if (
        req.method !== "POST" ||
        req.url !== "/v1/chat/completions" ||
        req.headers.authorization !== `Bearer ${token}`
      ) {
        res.writeHead(403).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const response = await transport(
        row,
        row.base_url + "/chat/completions",
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: Buffer.concat(chunks).toString(),
          signal: controller.signal,
        },
      );
      res.writeHead(response.status, {
        "Content-Type":
          response.headers.get("content-type") ?? "application/json",
      });
      if (response.body)
        Readable.fromWeb(response.body as any)
          .on("error", () => res.destroy())
          .pipe(res);
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    key: token,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
