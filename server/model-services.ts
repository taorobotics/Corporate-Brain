import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User } from "../shared/types";
import { modelProviders } from "../shared/model-services";
import type { Store } from "./database";
import {
  modelFetch,
  personalModelUrl,
  type ModelTransport,
} from "./model-transport";

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
export const connectionSelect = `SELECT c.*,COALESCE(source.secret,s.secret,c.secret) AS effective_secret,s.name AS service_name,s.owner_user_id,s.source_service_id,s.deleted AS service_deleted,
  COALESCE(source.base_url,s.base_url,c.base_url) AS effective_url,source.departments AS source_departments,
  CASE WHEN s.source_service_id IS NULL THEN 1 ELSE (source.id IS NOT NULL AND source.owner_user_id IS NULL AND source.deleted=0 AND EXISTS(SELECT 1 FROM connections original WHERE original.service_id=source.id AND original.enabled=1)) END AS source_active
  FROM connections c LEFT JOIN model_services s ON s.id=c.service_id LEFT JOIN model_services source ON source.id=s.source_service_id`;
export function resolveConnection(row: Row): Row {
  return {
    ...row,
    secret: row.effective_secret ?? row.secret,
    base_url: row.effective_url ?? row.base_url,
  };
}
export function canUseConnection(row: Row, user: User) {
  if (!row.enabled || row.service_deleted || !row.source_active) return false;
  if (row.owner_user_id && row.owner_user_id !== user.id) return false;
  const departments = JSON.parse(row.source_departments ?? row.departments);
  return (
    user.role === "company_admin" ||
    !departments.length ||
    departments.includes(user.departmentId)
  );
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
            "SELECT * FROM model_services WHERE provider='linoroute' AND owner_user_id IS NULL AND deleted=0 AND departments=?",
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
  transport: ModelTransport = modelFetch,
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
      personal: Boolean(row.owner_user_id),
      sourceServiceId: row.source_service_id ?? undefined,
      models: db
        .prepare(
          "SELECT model,kind FROM connections WHERE service_id=? AND enabled=1 ORDER BY name",
        )
        .all(row.id),
    };
  }
  function settings(
    data: z.infer<typeof config>,
    user: User,
    personal = false,
  ) {
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
    if (personal)
      try {
        personalModelUrl(baseUrl);
      } catch (error) {
        fail(400, (error as Error).message);
      }
    const previous = data.serviceId
      ? (db
          .prepare(
            "SELECT * FROM model_services WHERE id=? AND owner_user_id IS ? AND source_service_id IS NULL AND deleted=0",
          )
          .get(data.serviceId, personal ? user.id : null) as Row | undefined)
      : undefined;
    if (data.serviceId && !previous) fail(404, "模型服务不存在");
    if (!data.apiKey && (!previous || previous.base_url !== baseUrl))
      fail(400, "新增服务或更换地址时，请填写该服务的 API 密钥");
    const secret = data.apiKey
      ? store.encrypt(data.apiKey)
      : (previous!.secret as string);
    return { previous, baseUrl, secret };
  }
  function register(personal: boolean) {
    const prefix = personal ? "/api/my-model-services" : "/api/model-services";
    const current = (req: Request) => (personal ? actor(req) : admin(req));
    app.get(prefix, (req, res) => {
      const user = current(req);
      res.json(
        (
          db
            .prepare(
              "SELECT * FROM model_services WHERE owner_user_id IS ? AND deleted=0 ORDER BY CASE WHEN provider='linoroute' THEN 0 ELSE 1 END,name",
            )
            .all(personal ? user.id : null) as Row[]
        ).map(view),
      );
    });
    app.post(prefix + "/discover", async (req, res) =>
      res.json(
        await discoverModels(current(req), config.parse(req.body), personal),
      ),
    );
    app.post(prefix, (req, res) => {
      const user = current(req);
      const data = config
        .extend(
          personal
            ? { models: z.array(model).max(200) }
            : {
                departments: z.array(z.uuid()).max(100).default([]),
                models: z.array(model).max(200),
              },
        )
        .parse(req.body);
      const { previous, baseUrl, secret } = settings(data, user, personal);
      const unique = new Set(data.models.map((m) => m.kind + ":" + m.model));
      if (unique.size !== data.models.length)
        fail(400, "模型标识重复，请保留一项");
      const departments = personal
        ? []
        : ([...new Set((data as any).departments)] as string[]);
      for (const department of departments)
        if (
          !db
            .prepare("SELECT id FROM departments WHERE id=? AND enabled=1")
            .get(department)
        )
          fail(400, "部门不存在或已停用，请刷新后重试");
      const serviceId = previous?.id ?? randomUUID();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT INTO model_services(id,provider,name,base_url,departments,secret,owner_user_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,name=excluded.name,base_url=excluded.base_url,departments=excluded.departments,secret=excluded.secret",
        ).run(
          serviceId,
          data.provider,
          data.name,
          baseUrl,
          JSON.stringify(departments),
          secret,
          personal ? user.id : null,
        );
        updateModels(serviceId, data.name, baseUrl, departments, data.models);
        store.audit(
          user.id,
          personal ? "personal_model_service.saved" : "model_service.saved",
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
            db
              .prepare("SELECT * FROM model_services WHERE id=?")
              .get(serviceId)!,
          ),
        );
    });
    if (personal)
      app.delete(prefix + "/:id", (req, res) => {
        const user = actor(req),
          service = db
            .prepare(
              "SELECT * FROM model_services WHERE id=? AND owner_user_id=? AND deleted=0",
            )
            .get(z.uuid().parse(req.params.id), user.id);
        if (!service) fail(404, "个人模型配置不存在");
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("UPDATE connections SET enabled=0 WHERE service_id=?").run(
            service.id,
          );
          db.prepare(
            "UPDATE model_services SET deleted=1,secret='' WHERE id=?",
          ).run(service.id);
          store.audit(
            user.id,
            "personal_model_service.removed",
            String(service.id),
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        res.json({ ok: true });
      });
  }
  const discovering = new Set<string>();
  async function discoverModels(
    user: User,
    data: z.infer<typeof config>,
    personal = false,
  ) {
    const { baseUrl, secret } = settings(data, user, personal);
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
      const response = await transport(
        { owner_user_id: personal ? user.id : null },
        baseUrl + "/models",
        {
          headers,
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        },
      );
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
      return { models };
    } catch (error) {
      if (error instanceof Error && "status" in error) throw error;
      fail(
        502,
        "无法获取模型列表，请核对网络、地址和密钥；原配置保持不变，可重试或手动添加模型标识",
      );
    } finally {
      discovering.delete(user.id);
    }
  }
  function updateModels(
    serviceId: string,
    name: string,
    baseUrl: string,
    departments: string[],
    models: z.infer<typeof model>[],
  ) {
    db.prepare(
      "UPDATE connections SET enabled=0,base_url=?,departments=? WHERE service_id=?",
    ).run(baseUrl, JSON.stringify(departments), serviceId);
    for (const item of models) {
      const existing = db
        .prepare(
          "SELECT id FROM connections WHERE service_id=? AND model=? AND kind=?",
        )
        .get(serviceId, item.model, item.kind) as Row | undefined;
      if (existing)
        db.prepare(
          "UPDATE connections SET name=?,enabled=1,secret='' WHERE id=?",
        ).run(name + " · " + item.model, existing.id);
      else
        db.prepare(
          "INSERT INTO connections(id,name,base_url,model,kind,departments,secret,enabled,service_id) VALUES(?,?,?,?,?,?,'',1,?)",
        ).run(
          randomUUID(),
          name + " · " + item.model,
          baseUrl,
          item.model,
          item.kind,
          JSON.stringify(departments),
          serviceId,
        );
    }
  }
  register(false);
  register(true);
  function catalog(user: User, id: string) {
    const row = db
      .prepare(
        "SELECT * FROM model_services WHERE id=? AND owner_user_id IS NULL AND provider='linoroute' AND deleted=0",
      )
      .get(id) as Row | undefined;
    if (
      !row ||
      !db
        .prepare("SELECT 1 FROM connections WHERE service_id=? AND enabled=1")
        .get(id) ||
      (user.role !== "company_admin" &&
        JSON.parse(row.departments).length &&
        !JSON.parse(row.departments).includes(user.departmentId))
    )
      fail(404, "模型库不存在或无权使用");
    return row!;
  }
  app.get("/api/company-model-catalogs", (req, res) => {
    const user = actor(req),
      rows = db
        .prepare(
          "SELECT * FROM model_services WHERE provider='linoroute' AND owner_user_id IS NULL AND deleted=0 ORDER BY name",
        )
        .all() as Row[];
    res.json(
      rows.flatMap((row) => {
        try {
          catalog(user, row.id);
        } catch {
          return [];
        }
        const chosen = db
          .prepare(
            "SELECT * FROM model_services WHERE owner_user_id=? AND source_service_id=? AND deleted=0",
          )
          .get(user.id, row.id);
        return [
          {
            ...view(row),
            departments: [],
            models: chosen ? view(chosen).models : [],
          },
        ];
      }),
    );
  });
  const catalogs = new Map<
    string,
    { fingerprint: string; expires: number; models: string[] }
  >();
  const fingerprint = (row: Row) => JSON.stringify([row.base_url, row.secret]);
  async function readCatalog(user: User, row: Row) {
    const result = await discoverModels(user, {
      provider: row.provider,
      name: row.name,
      baseUrl: row.base_url,
      serviceId: row.id,
    });
    if (!result) fail(502, "模型库未返回内容");
    if (catalogs.size > 100) catalogs.clear();
    catalogs.set(row.id, {
      fingerprint: fingerprint(row),
      expires: Date.now() + 300000,
      models: result!.models,
    });
    return result!;
  }
  app.post("/api/company-model-catalogs/:id/discover", async (req, res) => {
    z.object({}).strict().parse(req.body);
    const user = actor(req),
      row = catalog(user, z.uuid().parse(req.params.id));
    res.json(await readCatalog(user, row));
  });
  app.post("/api/company-model-catalogs/:id/selection", async (req, res) => {
    const user = actor(req),
      source = catalog(user, z.uuid().parse(req.params.id)),
      data = z
        .object({ models: z.array(model).max(200) })
        .strict()
        .parse(req.body);
    const cached = catalogs.get(source.id),
      models =
        cached &&
        cached.expires > Date.now() &&
        cached.fingerprint === fingerprint(source)
          ? cached.models
          : (await readCatalog(user, source)).models;
    const fresh = catalog(user, source.id);
    if (fingerprint(fresh) !== fingerprint(source))
      fail(409, "公司连接已变更，请刷新模型列表后重试");
    if (
      data.models.some((item) => !models.includes(item.model)) ||
      new Set(data.models.map((m) => m.kind + ":" + m.model)).size !==
        data.models.length
    )
      fail(400, "请选择模型库中实际返回的模型，不能重复或自行提交未知模型");
    const previous = db
        .prepare(
          "SELECT * FROM model_services WHERE owner_user_id=? AND source_service_id=?",
        )
        .get(user.id, source.id),
      serviceId = previous?.id ?? randomUUID();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO model_services(id,provider,name,base_url,departments,secret,owner_user_id,source_service_id) VALUES(?,'linoroute',?,?,'[]','',?,?) ON CONFLICT(id) DO UPDATE SET deleted=0,name=excluded.name,base_url=excluded.base_url",
      ).run(serviceId, source.name, source.base_url, user.id, source.id);
      updateModels(
        String(serviceId),
        source.name,
        source.base_url,
        [],
        data.models,
      );
      store.audit(user.id, "personal_catalog.selected", String(serviceId));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.json(
      view(
        db.prepare("SELECT * FROM model_services WHERE id=?").get(serviceId)!,
      ),
    );
  });
}
