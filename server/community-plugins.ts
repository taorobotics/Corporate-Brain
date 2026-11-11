import type { Express, Request } from "express";
import { z } from "zod";
import type { Store } from "./database";
import type { User } from "../shared/types";
import {
  COMMUNITY_ADAPTERS,
  type CommunityPlugin,
  type CommunityPluginPage,
} from "../shared/community-plugins";

const SOURCES = [
  "https://awesome-dsh-plugin.com/plugins.json",
  "https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/plugins.json",
];
const MAX_BYTES = 32 * 1024 * 1024;
const querySchema = z
  .object({
    scope: z.enum(["adapted", "community", "installed"]).default("adapted"),
    text: z.string().trim().max(120).default(""),
    category: z.string().max(100).default(""),
    offset: z.coerce.number().int().min(0).max(50000).default(0),
    refresh: z.enum(["true", "false"]).optional(),
  })
  .strict();

function repository(value: unknown) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password
    )
      return;
    const path = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
    if (
      !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/(?:tree|blob)\/.+)?$/.test(
        path,
      ) ||
      path.split("/").some((p) => p === "." || p === "..")
    )
      return;
    return "https://github.com" + path;
  } catch {
    return;
  }
}
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

export function readCommunityCatalog(value: unknown): CommunityPlugin[] {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as any).plugins) ||
    (value as any).plugins.length > 50000
  )
    throw Error("Invalid community catalog");
  const seen = new Set<string>();
  const plugins: CommunityPlugin[] = [];
  for (const row of (value as any).plugins) {
    if (!row || typeof row !== "object") continue;
    const source = repository(row.url);
    const name = text(row.name, 160);
    const key =
      source?.toLowerCase() + "#" + (text(row.npm, 180) || name).toLowerCase();
    if (!source || !name || seen.has(key)) continue;
    seen.add(key);
    const categories = Array.isArray(row.category)
      ? row.category
      : [row.category];
    const categoryId = text(categories[0], 100);
    const category =
      text((value as any).categories?.[categoryId]?.zh, 100) ||
      categoryId ||
      "其他";
    plugins.push({
      id: key,
      name,
      repository: source,
      author: text(row.owner, 100),
      description: text(row.description?.zh || row.description?.en, 1200),
      category,
      version: text(row.version, 80),
      license: "请查看原项目许可",
      availability: "pending",
      installed: false,
      enabled: false,
    });
  }
  if (!plugins.length) throw Error("Empty community catalog");
  return plugins;
}

export function communityCatalog(fetcher: typeof fetch = fetch) {
  let cached:
    | { items: CommunityPlugin[]; at: number; source: string; warning?: string }
    | undefined;
  let pending: Promise<typeof cached> | undefined;
  let lastAttempt = 0;
  async function load() {
    for (const source of SOURCES) {
      try {
        const signal = AbortSignal.timeout(15000);
        const response = await fetcher(source, {
          signal,
          redirect: "error",
          headers: { Accept: "application/json" },
        });
        if (
          !response.ok ||
          !response.body ||
          Number(response.headers.get("content-length")) > MAX_BYTES
        ) {
          await response.body?.cancel();
          throw Error("Catalog HTTP error or size limit");
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        const reader = response.body.getReader();
        try {
          for (;;) {
            signal.throwIfAborted();
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > MAX_BYTES) throw Error("Catalog too large");
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        const items = readCommunityCatalog(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
        cached = { items, at: Date.now(), source };
        return cached;
      } catch {
        /* Try the second fixed public source; never fetch a catalog-supplied URL. */
      }
    }
    throw Error("社区目录暂时无法连接，请稍后重试；已适配插件仍可使用。");
  }
  return async (refresh = false) => {
    if (pending) return pending;
    if (
      cached &&
      Date.now() - cached.at < 600000 &&
      (!refresh || Date.now() - lastAttempt < 60000)
    )
      return cached;
    if (cached && Date.now() - lastAttempt < 30000)
      return {
        ...cached,
        warning: "刷新失败，当前显示上次成功读取的社区目录。",
      };
    if (!cached && lastAttempt && Date.now() - lastAttempt < 30000)
      throw Error("社区目录正在恢复，请稍后重试。");
    lastAttempt = Date.now();
    pending = load().catch((error) => {
      if (!cached) throw error;
      cached = {
        ...cached,
        warning: "刷新失败，当前显示上次成功读取的社区目录。",
      };
      return cached;
    });
    try {
      return await pending;
    } finally {
      pending = undefined;
    }
  };
}

export function mountCommunityPlugins(
  app: Express,
  store: Store,
  actorOf: (req: Request) => User,
  fail: (status: number, message: string) => never,
  fetcher?: typeof fetch,
) {
  const { db } = store;
  const catalog = communityCatalog(fetcher);
  const adapted = () =>
    COMMUNITY_ADAPTERS.map((p) => ({
      ...p,
      availability: "adapted" as const,
      installed: false,
      enabled: false,
    }));
  const installations = (userId: string) =>
    db
      .prepare(
        "SELECT plugin_id,enabled FROM community_plugins WHERE user_id=?",
      )
      .all(userId) as { plugin_id: string; enabled: number }[];
  const active = (userId: string) => {
    const rows = installations(userId);
    return COMMUNITY_ADAPTERS.filter((p) =>
      rows.some((r) => r.plugin_id === p.id && r.enabled),
    );
  };
  function resolve(userId: string, ids: string[]) {
    const allowed = active(userId);
    if (ids.some((id) => !allowed.some((p) => p.id === id)))
      fail(403, "插件未安装、已停用或尚未适配，请在开源社区插件中检查。");
    return [...new Set(ids)].sort();
  }
  app.get("/api/community-plugins", async (req, res) => {
    const actor = actorOf(req);
    const query = querySchema.parse(req.query);
    let items: CommunityPlugin[] = adapted();
    let fetchedAt: string | null = null;
    let warning: string | undefined;
    let source = "公司大脑已适配清单";
    if (query.scope === "community") {
      try {
        const result = await catalog(query.refresh === "true");
        if (result) {
          const own = new Set(items.map((p) => p.repository.toLowerCase()));
          items.push(
            ...result.items.filter((p) => !own.has(p.repository.toLowerCase())),
          );
          fetchedAt = new Date(result.at).toISOString();
          warning = "warning" in result ? String(result.warning) : undefined;
          source = result.source;
        }
      } catch (error) {
        fail(502, (error as Error).message);
      }
    }
    const rows = installations(actor.id);
    items = items.map((p) => {
      const row = rows.find((r) => r.plugin_id === p.id);
      return { ...p, installed: !!row, enabled: !!row?.enabled };
    });
    if (query.scope === "installed") items = items.filter((p) => p.installed);
    const categories = [...new Set(items.map((p) => p.category))].sort();
    const terms = query.text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    items = items.filter(
      (p) =>
        (!query.category || p.category === query.category) &&
        terms.every((t) =>
          [p.name, p.author, p.description]
            .join(" ")
            .normalize("NFKC")
            .toLocaleLowerCase()
            .includes(t),
        ),
    );
    res.json({
      items: items.slice(query.offset, query.offset + 24),
      total: items.length,
      categories,
      fetchedAt,
      warning,
      source,
    } satisfies CommunityPluginPage);
  });
  const known = (req: Request) => {
    const plugin = COMMUNITY_ADAPTERS.find((p) => p.id === req.params.id);
    if (!plugin) fail(409, "此插件尚未适配公司大脑，暂不能安装或执行。");
    return plugin;
  };
  app.post("/api/community-plugins/:id/install", (req, res) => {
    z.object({}).strict().parse(req.body);
    const actor = actorOf(req),
      plugin = known(req);
    db.prepare(
      "INSERT INTO community_plugins(user_id,plugin_id,enabled,installed_at) VALUES(?,?,1,?) ON CONFLICT(user_id,plugin_id) DO NOTHING",
    ).run(actor.id, plugin.id, new Date().toISOString());
    store.audit(actor.id, "community_plugin.install", plugin.id);
    res.json({ ok: true });
  });
  app.post("/api/community-plugins/:id/enabled", (req, res) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const actor = actorOf(req),
      plugin = known(req);
    const result = db
      .prepare(
        "UPDATE community_plugins SET enabled=? WHERE user_id=? AND plugin_id=?",
      )
      .run(Number(enabled), actor.id, plugin.id);
    if (!result.changes) fail(404, "此账号尚未安装该插件。");
    store.audit(
      actor.id,
      "community_plugin." + (enabled ? "enable" : "disable"),
      plugin.id,
    );
    res.json({ ok: true });
  });
  app.delete("/api/community-plugins/:id", (req, res) => {
    z.object({}).strict().parse(req.body);
    const actor = actorOf(req),
      plugin = known(req);
    db.prepare(
      "DELETE FROM community_plugins WHERE user_id=? AND plugin_id=?",
    ).run(actor.id, plugin.id);
    store.audit(actor.id, "community_plugin.uninstall", plugin.id);
    res.json({ ok: true });
  });
  return { active, resolve };
}
