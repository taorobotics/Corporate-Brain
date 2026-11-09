import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseNasDocument } from "./nas-documents";
import { NAS_DOCUMENT_EXTENSIONS } from "../shared/nas";
import { tokenHash, type Store } from "./database";
import type { User } from "../shared/types";
import type {
  NasAdminSource,
  NasEntry,
  NasSource,
  NasListing,
  NasDocument,
} from "../shared/nas";

export const nasSegment = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (s) =>
      !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(s) &&
      s !== "." &&
      s !== ".." &&
      !/[. ]$/.test(s),
    "目录名称不能包含路径分隔符或特殊路径字符",
  );
export const nasPath = z
  .string()
  .max(1024)
  .refine(
    (s) =>
      s === "" ||
      (s.split("/").length <= 32 &&
        s.split("/").every((p) => nasSegment.safeParse(p).success)),
    "请使用授权目录内的相对路径",
  );
const lanHost = z.string().refine((s) => {
  const p = s.split(".");
  if (
    p.length !== 4 ||
    p.some((x) => !/^(0|[1-9]\d{0,2})$/.test(x) || Number(x) > 255)
  )
    return false;
  return (
    p[0] === "10" ||
    (p[0] === "172" && +p[1] >= 16 && +p[1] <= 31) ||
    (p[0] === "192" && p[1] === "168")
  );
}, "NAS 地址需要填写公司局域网 IPv4 地址");
const sourceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    host: lanHost,
    share: nasSegment,
    basePath: nasPath.default(""),
    username: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[^\x00-\x1f\\/@]+$/),
    domain: z
      .string()
      .max(128)
      .regex(/^[^\x00-\x1f\\/@]*$/)
      .default(""),
    password: z.string().max(1024).optional(),
    departmentIds: z.array(z.string().uuid()).min(1).max(100),
    enabled: z.boolean().default(false),
    revision: z.number().int().positive().optional(),
  })
  .strict();
export type NasConnection = {
  host: string;
  share: string;
  basePath: string;
  username: string;
  domain: string;
  password: string;
};
type WorkerResult = { entries: NasEntry[]; truncated: boolean };
type NasRawDocument = { data: Buffer; modified: string | null };
export type NasOptions = {
  read?: (
    source: NasConnection,
    path: string,
    signal: AbortSignal,
  ) => Promise<NasRawDocument>;
  list?: (
    source: NasConnection,
    path: string,
    search: string,
    signal: AbortSignal,
  ) => Promise<WorkerResult>;
};
const errors: Record<string, string> = {
  UNSUPPORTED_DOCUMENT: "这个文件格式暂不支持正文读取",
  DOCUMENT_TOO_LARGE: "NAS 文档请小于 10MB，请拆分后再读取",
  DOCUMENT_CHANGED: "文档在读取时发生变化，请刷新后重试",
  RUNTIME_MISSING: "NAS 连接组件尚未安装，请联系管理员",
  AUTH_FAILED: "NAS 账号或密码未通过验证，请联系管理员核对",
  ACCESS_DENIED: "NAS 账号无权访问这个目录或文件",
  SHARE_MISSING: "NAS 上未找到配置的共享目录，请联系管理员核对",
  PATH_MISSING: "文件或目录不存在或已移动，请返回上一级刷新",
  LINK_BLOCKED: "此目录是链接或转向其他位置，暂不支持浏览",
  CONNECTION_FAILED: "NAS 连接失败，请确认内网连接、账号和 SMB 加密支持",
  TIMEOUT: "NAS 响应超时，请稍后重试",
  CANCELLED: "NAS 请求已取消",
  INVALID_REQUEST: "目录请求无效",
};
export class NasError extends Error {
  constructor(public code: string) {
    super(errors[code] ?? errors.CONNECTION_FAILED);
  }
}
const workerSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            name: z.string().min(1).max(255),
            directory: z.boolean(),
            blocked: z.boolean(),
            bytes: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER),
            modified: z.string().max(60).nullable(),
          })
          .strict(),
      )
      .max(500),
    truncated: z.boolean(),
  })
  .strict();
function nasWorker(
  source: NasConnection,
  path: string,
  search: string,
  signal: AbortSignal,
  operation: "list" | "read",
): Promise<WorkerResult | NasRawDocument> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new NasError("CANCELLED"));
    const child = spawn(
      process.env.BRAIN_NAS_PYTHON || "python3",
      ["-I", "-B", fileURLToPath(new URL("./nas-worker.py", import.meta.url))],
      {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          BRAIN_NAS_PYTHON_PATH: process.env.BRAIN_NAS_PYTHON_PATH,
          PYTHONDONTWRITEBYTECODE: "1",
        },
      },
    );
    let output = "",
      size = 0,
      finished = false;
    const done = (error?: Error, value?: WorkerResult | NasRawDocument) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (child.exitCode === null) child.kill();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => done(new NasError("CANCELLED"));
    const timer = setTimeout(
      () => done(new NasError("TIMEOUT")),
      operation === "read" ? 30000 : 18000,
    );
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => done(new NasError("RUNTIME_MISSING")));
    child.stdin.on("error", () => done(new NasError("CONNECTION_FAILED")));
    child.stdout.on("data", (buffer: Buffer) => {
      size += buffer.length;
      if (size > (operation === "read" ? 14500000 : 1024 * 1024))
        done(new NasError("CONNECTION_FAILED"));
      else output += buffer.toString("utf8");
    });
    child.on("close", (code) => {
      if (finished) return;
      try {
        if (code !== 0) throw new NasError("CONNECTION_FAILED");
        const value = JSON.parse(output);
        if (value.error)
          throw new NasError(
            Object.hasOwn(errors, value.error)
              ? value.error
              : "CONNECTION_FAILED",
          );
        if (operation === "read") {
          const parsed = z
            .object({
              data: z
                .string()
                .max(14000000)
                .regex(/^[A-Za-z0-9+/]*={0,2}$/),
              bytes: z
                .number()
                .int()
                .min(0)
                .max(10 * 1024 * 1024),
              modified: z.string().max(60).nullable(),
            })
            .strict()
            .parse(value);
          const data = Buffer.from(parsed.data, "base64");
          if (data.length !== parsed.bytes)
            throw new NasError("CONNECTION_FAILED");
          done(undefined, { data, modified: parsed.modified });
          return;
        }
        const parsed = workerSchema.parse(value);
        for (const entry of parsed.entries)
          if (!nasSegment.safeParse(entry.name).success) entry.blocked = true;
        done(undefined, parsed);
      } catch (error) {
        done(
          error instanceof NasError ? error : new NasError("CONNECTION_FAILED"),
        );
      }
    });
    child.stdin.end(JSON.stringify({ ...source, path, search, operation }));
  });
}

export async function listNas(
  source: NasConnection,
  path: string,
  search: string,
  signal: AbortSignal,
): Promise<WorkerResult> {
  return (await nasWorker(
    source,
    path,
    search,
    signal,
    "list",
  )) as WorkerResult;
}
export async function readNas(
  source: NasConnection,
  path: string,
  signal: AbortSignal,
): Promise<NasRawDocument> {
  return (await nasWorker(source, path, "", signal, "read")) as NasRawDocument;
}

export function mountNas(
  app: Express,
  store: Store,
  actorOf: (req: Request) => User,
  fail: (status: number, message: string) => never,
  options: NasOptions = {},
) {
  const { db } = store;
  db.exec(`CREATE TABLE IF NOT EXISTS nas_sources(
    id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,host TEXT NOT NULL,share TEXT NOT NULL,
    base_path TEXT NOT NULL,username TEXT NOT NULL,domain TEXT NOT NULL,secret TEXT NOT NULL,
    department_ids TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,
    last_checked TEXT,status TEXT NOT NULL DEFAULT 'untested',status_message TEXT NOT NULL DEFAULT ''
  )`);
  type Row = Record<string, any>;
  const rows = () =>
    db.prepare("SELECT * FROM nas_sources ORDER BY name").all() as Row[];
  const row = (id: string) =>
    db.prepare("SELECT * FROM nas_sources WHERE id=?").get(id) as
      Row | undefined;
  const view = (s: Row): NasSource => ({
    id: s.id,
    name: s.name,
    departmentIds: JSON.parse(s.department_ids),
    enabled: !!s.enabled,
    revision: s.revision,
    lastChecked: s.last_checked,
    status: s.status,
    statusMessage: s.status_message,
  });
  const adminView = (s: Row): NasAdminSource => ({
    ...view(s),
    host: s.host,
    share: s.share,
    basePath: s.base_path,
    username: s.username,
    domain: s.domain,
    hasPassword: !!s.secret,
  });
  const admin = (req: Request) => {
    const actor = actorOf(req);
    if (actor.role !== "company_admin") fail(403, "需要公司管理员权限");
    return actor;
  };
  const allowed = (s: Row, actor: User) =>
    !!s.enabled &&
    (JSON.parse(s.department_ids) as string[]).includes(actor.departmentId);
  const sources = (actor: User) =>
    rows()
      .filter((s) => allowed(s, actor))
      .map(view);
  app.get("/api/knowledge/sources", (req, res) =>
    res.json(sources(actorOf(req))),
  );
  app.get("/api/admin/knowledge", (req, res) => {
    admin(req);
    res.json(rows().map(adminView));
  });
  function save(req: Request, previous?: Row) {
    const actor = admin(req),
      data = sourceSchema.parse(req.body);
    if (previous && data.revision !== previous.revision)
      fail(409, "资料源已被更新，请刷新后再保存");
    for (const department of data.departmentIds)
      if (
        !db
          .prepare("SELECT id FROM departments WHERE id=? AND enabled=1")
          .get(department)
      )
        fail(400, "授权部门不存在或已停用");
    if (!previous && !data.password) fail(400, "请填写 NAS 密码");
    const secret = data.password
      ? store.encrypt(data.password)
      : previous!.secret;
    const id = previous?.id ?? randomUUID();
    db.prepare(
      `INSERT INTO nas_sources(id,name,host,share,base_path,username,domain,secret,department_ids,enabled)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,share=excluded.share,
      base_path=excluded.base_path,username=excluded.username,domain=excluded.domain,secret=excluded.secret,
      department_ids=excluded.department_ids,enabled=excluded.enabled,revision=nas_sources.revision+1,
      status='untested',status_message='',last_checked=NULL`,
    ).run(
      id,
      data.name,
      data.host,
      data.share,
      data.basePath,
      data.username,
      data.domain,
      secret,
      JSON.stringify([...new Set(data.departmentIds)]),
      Number(data.enabled),
    );
    store.audit(
      actor.id,
      previous ? "nas.source_updated" : "nas.source_created",
      id,
    );
    return adminView(row(id)!);
  }
  app.post("/api/admin/knowledge", (req, res) =>
    res.status(201).json(save(req)),
  );
  app.patch("/api/admin/knowledge/:id", (req, res) => {
    admin(req);
    const s = row(z.string().uuid().parse(req.params.id));
    if (!s) fail(404, "资料源不存在");
    res.json(save(req, s));
  });
  const activeActors = new Set<string>(),
    activeSources = new Set<string>(),
    limits = new Map<string, { n: number; until: number }>(),
    cooldown = new Map<string, number>();
  function assertCurrent(req: Request) {
    const actor = actorOf(req);
    const current = db
      .prepare(
        `SELECT u.id FROM users u JOIN departments d ON u.department_id=d.id JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND u.enabled=1 AND d.enabled=1 AND u.department_id=? AND u.role=?
      AND s.auth_version=u.auth_version AND s.token_hash=? AND s.expires_at>?`,
      )
      .get(
        actor.id,
        actor.departmentId,
        actor.role,
        tokenHash(req.cookies?.brain_session ?? ""),
        Date.now(),
      );
    if (!current) fail(403, "账号权限已变化，请重新登录");
  }
  async function access(
    req: Request,
    sourceId: string,
    input: { path?: string; search?: string },
    signal: AbortSignal,
    test = false,
    documentOffset?: number,
  ): Promise<NasListing | NasDocument> {
    const actor = test ? admin(req) : actorOf(req),
      s = row(z.string().uuid().parse(sourceId));
    assertCurrent(req);
    signal.throwIfAborted();
    if (!s || (!test && !allowed(s, actor)))
      fail(404, "资料源不存在或无权访问");
    const query = z
      .object({
        path: nasPath.default(""),
        search: z
          .string()
          .max(80)
          .refine(
            (q) => !q || nasSegment.safeParse(q).success,
            "请输入目录内的名称关键词",
          )
          .default(""),
      })
      .strict()
      .parse(input);
    if (test && (query.path || query.search))
      fail(400, "连接检查只验证资料源根目录");
    const now = Date.now();
    for (const [key, value] of limits)
      if (value.until <= now) limits.delete(key);
    for (const [key, value] of cooldown) if (value <= now) cooldown.delete(key);
    if ((cooldown.get(s.id) ?? 0) > now)
      fail(429, "NAS 验证暂缓，请一分钟后重试或先核对账号密码");
    const limit = limits.get(actor.id) ?? { n: 0, until: now + 60000 };
    limits.set(actor.id, limit);
    if (
      ++limit.n > 60 ||
      activeActors.has(actor.id) ||
      activeSources.has(s.id) ||
      activeActors.size >= 4
    )
      fail(429, "目录请求较多，请稍后重试");
    const startAuth = Number(
      db.prepare("SELECT auth_version FROM users WHERE id=?").get(actor.id)
        ?.auth_version,
    );
    if (!Number.isSafeInteger(startAuth)) fail(401, "请重新登录");
    activeActors.add(actor.id);
    activeSources.add(s.id);
    try {
      const connection = {
        host: s.host,
        share: s.share,
        basePath: s.base_path,
        username: s.username,
        domain: s.domain,
        password: store.decrypt(s.secret),
      };
      let result: NasListing | NasDocument | WorkerResult;
      if (documentOffset !== undefined) {
        const raw = await (options.read ?? readNas)(
          connection,
          query.path,
          signal,
        );
        try {
          result = await parseNasDocument(
            query.path,
            raw.data,
            raw.modified,
            documentOffset,
            signal,
          );
        } catch (error) {
          signal.throwIfAborted();
          fail(422, (error as Error).message);
        }
      } else
        result = await (options.list ?? listNas)(
          connection,
          query.path,
          query.search,
          signal,
        );
      signal.throwIfAborted();
      const current = row(s.id);
      const stillLoggedIn = db
        .prepare(
          `SELECT u.id FROM users u JOIN departments d ON u.department_id=d.id JOIN sessions s ON s.user_id=u.id
        WHERE u.id=? AND u.enabled=1 AND d.enabled=1 AND u.department_id=? AND u.role=? AND u.auth_version=?
        AND s.auth_version=u.auth_version AND s.token_hash=? AND s.expires_at>?`,
        )
        .get(
          actor.id,
          actor.departmentId,
          actor.role,
          startAuth,
          tokenHash(req.cookies?.brain_session ?? ""),
          Date.now(),
        );
      if (!stillLoggedIn) fail(403, "账号权限已变化，请重新登录");
      if (
        !current ||
        current.revision !== s.revision ||
        (!test && !allowed(current, actor))
      )
        fail(409, "资料源权限已变化，请刷新后重试");
      db.prepare(
        "UPDATE nas_sources SET status='connected',status_message='',last_checked=? WHERE id=? AND revision=?",
      ).run(new Date().toISOString(), s.id, s.revision);
      if (test) {
        store.audit(actor.id, "nas.connection_checked", s.id);
        return { path: query.path, ...result };
      } else {
        store.audit(
          actor.id,
          documentOffset === undefined
            ? "nas.directory_listed"
            : "nas.document_read",
          s.id,
        );
        return { path: query.path, ...result };
      }
    } catch (error) {
      if (error instanceof NasError) {
        if (error.code === "AUTH_FAILED")
          cooldown.set(s.id, Date.now() + 60000);
        if (
          ![
            "CANCELLED",
            "UNSUPPORTED_DOCUMENT",
            "DOCUMENT_TOO_LARGE",
            "DOCUMENT_CHANGED",
          ].includes(error.code)
        )
          db.prepare(
            "UPDATE nas_sources SET status='error',status_message=?,last_checked=? WHERE id=? AND revision=?",
          ).run(error.message, new Date().toISOString(), s.id, s.revision);
        fail(
          error.code === "ACCESS_DENIED" || error.code === "LINK_BLOCKED"
            ? 403
            : error.code === "DOCUMENT_TOO_LARGE"
              ? 413
              : error.code === "UNSUPPORTED_DOCUMENT"
                ? 415
                : error.code === "DOCUMENT_CHANGED"
                  ? 409
                  : 502,
          error.message,
        );
      }
      throw error;
    } finally {
      activeActors.delete(actor.id);
      activeSources.delete(s.id);
    }
  }
  async function readDirectory(
    req: Request,
    sourceId: string,
    input: { path?: string; search?: string },
    signal: AbortSignal,
    test = false,
  ): Promise<NasListing> {
    return (await access(req, sourceId, input, signal, test)) as NasListing;
  }
  async function readDocument(
    req: Request,
    sourceId: string,
    input: { path: string; offset?: number },
    signal: AbortSignal,
  ): Promise<NasDocument> {
    const data = z
      .object({
        path: nasPath.refine(
          (p) => !!p && NAS_DOCUMENT_EXTENSIONS.test(p),
          "请选择支持的 Word、PDF、表格或文本文件",
        ),
        offset: z.number().int().min(0).max(120000).default(0),
      })
      .strict()
      .parse(input);
    return (await access(
      req,
      sourceId,
      { path: data.path },
      signal,
      false,
      data.offset,
    )) as NasDocument;
  }
  app.post("/api/knowledge/sources/:id/document", async (req, res) => {
    const controller = new AbortController(),
      close = () => {
        if (!res.writableEnded) controller.abort();
      };
    res.once("close", close);
    try {
      res.json(
        await readDocument(
          req,
          String(req.params.id),
          req.body,
          controller.signal,
        ),
      );
    } finally {
      res.off("close", close);
    }
  });
  async function browse(
    req: Request,
    res: import("express").Response,
    test: boolean,
  ) {
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", abort);
    try {
      const result = await readDirectory(
        req,
        String(req.params.id),
        req.query,
        controller.signal,
        test,
      );
      res.json(
        test
          ? {
              ok: true,
              entryCount: result.entries.length,
              truncated: result.truncated,
            }
          : result,
      );
    } finally {
      res.off("close", abort);
    }
  }
  app.get("/api/knowledge/sources/:id/files", (req, res) =>
    browse(req, res, false),
  );
  app.post("/api/admin/knowledge/:id/test", (req, res) =>
    browse(req, res, true),
  );
  return { sources, readDirectory, readDocument, assertCurrent };
}
