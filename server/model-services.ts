import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User } from "../shared/types";
import { modelProviders } from "../shared/model-services";
import type { Store } from "./database";

type Row = Record<string, any>;
const provider = z.enum(modelProviders.map((p) => p.id));
const text = z.string().trim().min(1).max(120);
const model = z
  .object({ model: text, kind: z.enum(["chat", "image"]) })
  .strict();
const config = z
  .object({
    provider,
    name: text,
    baseUrl: z.url().max(300),
    apiKey: z.string().trim().min(1).max(1000).optional(),
    serviceId: z.uuid().optional(),
  })
  .strict();

/** All model invocations resolve credentials from the same service record. */
export const connectionSelect = `SELECT c.*,COALESCE(s.secret,c.secret) AS effective_secret,s.name AS service_name
  FROM connections c LEFT JOIN model_services s ON s.id=c.service_id`;
export function resolveConnection(row: Row): Row {
  return { ...row, secret: row.effective_secret ?? row.secret };
}

/** Preserve existing LinoRoute IDs, scopes and enabled flags without any network call. */
export function migrateLinoRoute(store: Store) {
  const rows = store.db
    .prepare(
      "SELECT * FROM connections WHERE service_id IS NULL AND base_url IN ('https://linoroute.com/v1','https://linoroute.com/v1/')",
    )
    .all() as Row[];
  if (!rows.length) return;
  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const key = store.decrypt(row.secret);
      const existing = (
        store.db
          .prepare(
            "SELECT * FROM model_services WHERE provider='linoroute' AND departments=?",
          )
          .all(row.departments) as Row[]
      ).find(
        (s) =>
          store.decrypt(s.secret) === key &&
          !store.db
            .prepare(
              "SELECT id FROM connections WHERE service_id=? AND model=? AND kind=?",
            )
            .get(s.id, row.model, row.kind),
      );
      const serviceId = existing?.id ?? randomUUID();
      if (!existing)
        store.db
          .prepare(
            "INSERT INTO model_services(id,provider,name,base_url,departments,secret) VALUES(?,'linoroute',?,?,?,?)",
          )
          .run(
            serviceId,
            row.name,
            row.base_url.replace(/\/$/, ""),
            row.departments,
            row.secret,
          );
      store.db
        .prepare("UPDATE connections SET service_id=?,secret='' WHERE id=?")
        .run(serviceId, row.id);
    }
    store.db.exec("COMMIT");
  } catch (e) {
    store.db.exec("ROLLBACK");
    throw e;
  }
}

export function mountModelServices(
  app: Express,
  store: Store,
  actor: (req: Request) => User,
  fail: (status: number, message: string) => never,
) {
  const { db } = store;
  function admin(req: Request) {
    const user = actor(req);
    if (user.role !== "company_admin") fail(403, "需要公司管理员权限");
    return user;
  }
  function view(row: Row) {
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      baseUrl: row.base_url,
      departments: JSON.parse(row.departments),
      hasKey: Boolean(row.secret),
      models: db
        .prepare(
          "SELECT model,kind FROM connections WHERE service_id=? AND enabled=1 ORDER BY name",
        )
        .all(row.id),
    };
  }
  function settings(data: z.infer<typeof config>) {
    const url = new URL(data.baseUrl);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      fail(400, "外部服务需要 HTTPS，本机服务可用 HTTP");
    if (url.username || url.password || url.search || url.hash)
      fail(400, "服务地址不能包含账号、查询参数或片段");
    const baseUrl = data.baseUrl.replace(/\/+$/, "");
    const previous = data.serviceId
      ? (db
          .prepare("SELECT * FROM model_services WHERE id=?")
          .get(data.serviceId) as Row | undefined)
      : undefined;
    if (data.serviceId && !previous) fail(404, "模型服务不存在");
    if (!data.apiKey && (!previous || previous.base_url !== baseUrl))
      fail(400, "新增服务或更换地址时，请填写该服务的 API 密钥");
    const secret = data.apiKey
      ? store.encrypt(data.apiKey)
      : (previous!.secret as string);
    return { previous, baseUrl, secret };
  }
  app.get("/api/model-services", (req, res) => {
    admin(req);
    res.json(
      (
        db
          .prepare(
            "SELECT * FROM model_services ORDER BY CASE WHEN provider='linoroute' THEN 0 ELSE 1 END,name",
          )
          .all() as Row[]
      ).map(view),
    );
  });
  const discovering = new Set<string>();
  app.post("/api/model-services/discover", async (req, res) => {
    const user = admin(req);
    const data = config.parse(req.body);
    const { baseUrl, secret } = settings(data);
    if (discovering.has(user.id)) fail(409, "正在获取模型列表，请稍候");
    discovering.add(user.id);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${store.decrypt(secret)}`,
        Accept: "application/json",
      };
      if (data.provider === "claude")
        Object.assign(headers, {
          "x-api-key": store.decrypt(secret),
          "anthropic-version": "2023-06-01",
        });
      const response = await fetch(baseUrl + "/models", {
        headers,
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
      if (!response.ok)
        fail(
          502,
          `获取模型列表失败（HTTP ${response.status}），请核对地址、密钥和服务商权限；也可手动添加模型标识`,
        );
      if (!response.body) fail(502, "服务商未返回模型列表");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 2_000_000)
            fail(502, "服务商模型列表过大，请手动添加需要的模型标识");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const parsed = z
        .object({ data: z.array(z.object({ id: text })).max(5000) })
        .safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!parsed.success)
        fail(502, "服务商未返回兼容的模型列表，可手动添加模型标识");
      const models = [...new Set(parsed.data.data.map((m) => m.id))].sort(
        (a, b) => a.localeCompare(b),
      );
      store.audit(
        user.id,
        "model_service.models_discovered",
        data.serviceId ?? data.provider,
      );
      res.json({ models });
    } catch (error) {
      if (error instanceof Error && "status" in error) throw error;
      fail(
        502,
        "无法获取模型列表，请核对网络、地址和密钥；原配置保持不变，可重试或手动添加模型标识",
      );
    } finally {
      discovering.delete(user.id);
    }
  });
  app.post("/api/model-services", (req, res) => {
    const user = admin(req);
    const data = config
      .extend({
        departments: z.array(z.uuid()).max(100).default([]),
        models: z.array(model).max(200),
      })
      .parse(req.body);
    const { previous, baseUrl, secret } = settings(data);
    const unique = new Set(data.models.map((m) => m.kind + ":" + m.model));
    if (unique.size !== data.models.length)
      fail(400, "模型标识重复，请保留一项");
    const departments = [...new Set(data.departments)];
    for (const id of departments)
      if (
        !db
          .prepare("SELECT id FROM departments WHERE id=? AND enabled=1")
          .get(id)
      )
        fail(400, "部门不存在或已停用，请刷新后重试");
    const serviceId = previous?.id ?? randomUUID();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO model_services(id,provider,name,base_url,departments,secret) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,name=excluded.name,base_url=excluded.base_url,departments=excluded.departments,secret=excluded.secret",
      ).run(
        serviceId,
        data.provider,
        data.name,
        baseUrl,
        JSON.stringify(departments),
        secret,
      );
      db.prepare(
        "UPDATE connections SET enabled=0,base_url=?,departments=? WHERE service_id=?",
      ).run(baseUrl, JSON.stringify(departments), serviceId);
      for (const item of data.models) {
        const existing = db
          .prepare(
            "SELECT id FROM connections WHERE service_id=? AND model=? AND kind=?",
          )
          .get(serviceId, item.model, item.kind) as Row | undefined;
        if (existing)
          db.prepare(
            "UPDATE connections SET name=?,enabled=1,secret='' WHERE id=?",
          ).run(data.name + " · " + item.model, existing.id);
        else
          db.prepare(
            "INSERT INTO connections(id,name,base_url,model,kind,departments,secret,enabled,service_id) VALUES(?,?,?,?,?,?,'',1,?)",
          ).run(
            randomUUID(),
            data.name + " · " + item.model,
            baseUrl,
            item.model,
            item.kind,
            JSON.stringify(departments),
            serviceId,
          );
      }
      store.audit(
        user.id,
        previous ? "model_service.updated" : "model_service.created",
        serviceId,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res
      .status(previous ? 200 : 201)
      .json(
        view(
          db.prepare("SELECT * FROM model_services WHERE id=?").get(serviceId)!,
        ),
      );
  });
}
