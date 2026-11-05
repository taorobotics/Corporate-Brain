import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createPlatform } from "./platform";
import { createStore } from "./database";
import { modelProviders } from "../shared/model-services";

test("shared model services: discovery, multi-model routing, authorization and updates", async (t) => {
  const oldDsh = process.env.BRAIN_DSH_ENABLED;
  process.env.BRAIN_DSH_ENABLED = "0";
  let listing: unknown = {
    data: [{ id: "fixture-a" }, { id: "fixture-b" }, { id: "fixture-a" }],
  };
  let upstreamStatus = 200;
  let requests = 0;
  let seenKey = "";
  let seenModel = "";
  const upstream = createServer(async (req, res) => {
    requests++;
    seenKey = req.headers.authorization ?? "";
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") {
      res.statusCode = upstreamStatus;
      res.end(JSON.stringify(listing));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    seenModel = body.model;
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "Synthetic model service reply" } }],
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const platform = createPlatform({ database: ":memory:" });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    upstream.close();
    platform.store.close();
    if (oldDsh === undefined) delete process.env.BRAIN_DSH_ENABLED;
    else process.env.BRAIN_DSH_ENABLED = oldDsh;
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function req(
    path: string,
    body?: unknown,
    cookie = "",
    method = body ? "POST" : "GET",
    origin?: string,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(origin ? { Origin: origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const password = "Synthetic-Services-2026";
  await req("/bootstrap", {
    companyName: "Fixture A",
    name: "Admin",
    username: "service-admin",
    password,
  });
  const admin = await req("/auth/login", {
    username: "service-admin",
    password,
  });
  assert.equal(admin.status, 200);
  const other = await req("/departments", { name: "Fixture B" }, admin.cookie);
  const employee = await req(
    "/users",
    {
      username: "service-employee",
      name: "Employee",
      departmentId: other.data.id,
      role: "employee",
    },
    admin.cookie,
  );
  const employeeLogin = await req("/auth/login", {
    username: "service-employee",
    password: employee.data.initialPassword,
  });
  await req(
    "/auth/password",
    { current: employee.data.initialPassword, password },
    employeeLogin.cookie,
  );
  const staff = await req("/auth/login", {
    username: "service-employee",
    password,
  });
  const config = {
    provider: "linoroute",
    name: "Synthetic gateway",
    baseUrl: `http://127.0.0.1:${(upstream.address() as any).port}/v1`,
    apiKey: "synthetic-services-key",
  };
  await t.test(
    "service configuration and discovery require company administrator and permitted origin",
    async () => {
      assert.equal((await req("/model-services")).status, 401);
      assert.equal(
        (await req("/model-services", undefined, staff.cookie)).status,
        403,
      );
      assert.equal(
        (await req("/model-services/discover", config, staff.cookie)).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/model-services/discover",
            config,
            admin.cookie,
            "POST",
            "https://untrusted.invalid",
          )
        ).status,
        403,
      );
      assert.equal(requests, 0);
    },
  );
  await t.test(
    "discovers unique real upstream model IDs without revealing or storing the key",
    async () => {
      const result = await req(
        "/model-services/discover",
        config,
        admin.cookie,
      );
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.models, ["fixture-a", "fixture-b"]);
      assert.equal(seenKey, "Bearer synthetic-services-key");
      assert.equal(
        (await req("/model-services", undefined, admin.cookie)).data.length,
        0,
      );
      assert.ok(!JSON.stringify(result.data).includes(config.apiKey));
    },
  );
  let serviceId = "",
    aId = "",
    bId = "";
  await t.test(
    "stores one encrypted credential for multiple models and routes each selected model",
    async () => {
      const saved = await req(
        "/model-services",
        {
          ...config,
          departments: [],
          models: [
            { model: "fixture-a", kind: "chat" },
            { model: "fixture-b", kind: "chat" },
          ],
        },
        admin.cookie,
      );
      assert.equal(saved.status, 201);
      serviceId = saved.data.id;
      assert.equal(saved.data.models.length, 2);
      assert.ok(!JSON.stringify(saved.data).includes(config.apiKey));
      const row = platform.store.db
        .prepare("SELECT * FROM model_services WHERE id=?")
        .get(serviceId)!;
      assert.notEqual(row.secret, config.apiKey);
      assert.equal(platform.store.decrypt(String(row.secret)), config.apiKey);
      const rows = platform.store.db
        .prepare("SELECT id,model,secret FROM connections WHERE service_id=?")
        .all(serviceId);
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => r.secret === ""));
      const available = await req("/connections", undefined, staff.cookie);
      assert.equal(available.data.length, 2);
      assert.ok(
        available.data.every((r: any) => r.hasKey && r.serviceId === serviceId),
      );
      aId = available.data.find((r: any) => r.model === "fixture-a").id;
      bId = available.data.find((r: any) => r.model === "fixture-b").id;
      for (const id of [aId, bId]) {
        const reply = await req(
          "/generate/chat",
          {
            connectionId: id,
            messages: [{ role: "user", content: "Synthetic request" }],
          },
          staff.cookie,
        );
        assert.equal(reply.status, 200);
        assert.equal(reply.data.content, "Synthetic model service reply");
        assert.equal(seenModel, id === aId ? "fixture-a" : "fixture-b");
        assert.equal(seenKey, "Bearer synthetic-services-key");
      }
    },
  );
  await t.test(
    "refresh reuses saved key; changed host cannot receive saved key; failure preserves current selection",
    async () => {
      const { apiKey: _, ...withoutKey } = config;
      const body = { ...withoutKey, serviceId };
      assert.equal(
        (await req("/model-services/discover", body, admin.cookie)).status,
        200,
      );
      const n = requests;
      assert.equal(
        (
          await req(
            "/model-services/discover",
            { ...body, baseUrl: "https://untrusted.invalid/v1" },
            admin.cookie,
          )
        ).status,
        400,
      );
      assert.equal(requests, n);
      const before = JSON.stringify(
        (await req("/model-services", undefined, admin.cookie)).data,
      );
      upstreamStatus = 401;
      assert.equal(
        (await req("/model-services/discover", body, admin.cookie)).status,
        502,
      );
      upstreamStatus = 200;
      listing = { data: "invalid" };
      assert.equal(
        (await req("/model-services/discover", body, admin.cookie)).status,
        502,
      );
      assert.equal(
        JSON.stringify(
          (await req("/model-services", undefined, admin.cookie)).data,
        ),
        before,
      );
      listing = { data: [{ id: "fixture-a" }, { id: "fixture-c" }] };
    },
  );
  await t.test(
    "updates scope and key for all models, preserves IDs and blocks removed or unauthorized models",
    async () => {
      const updated = await req(
        "/model-services",
        {
          ...config,
          apiKey: "synthetic-rotated-key",
          serviceId,
          departments: [admin.data.departmentId],
          models: [{ model: "fixture-a", kind: "chat" }],
        },
        admin.cookie,
      );
      assert.equal(updated.status, 200);
      assert.equal(
        (await req("/connections", undefined, staff.cookie)).data.length,
        0,
      );
      const payload = {
        connectionId: aId,
        messages: [{ role: "user", content: "Synthetic" }],
      };
      assert.equal(
        (await req("/generate/chat", payload, staff.cookie)).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/generate/chat",
            { ...payload, connectionId: bId },
            admin.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (await req("/generate/chat", payload, admin.cookie)).status,
        200,
      );
      assert.equal(seenKey, "Bearer synthetic-rotated-key");
      const restored = await req(
        "/model-services",
        {
          ...config,
          serviceId,
          departments: [],
          models: [
            { model: "fixture-a", kind: "chat" },
            { model: "fixture-b", kind: "chat" },
          ],
        },
        admin.cookie,
      );
      assert.equal(restored.status, 200);
      const rows = (await req("/connections", undefined, staff.cookie)).data;
      assert.equal(rows.find((r: any) => r.model === "fixture-a").id, aId);
      assert.equal(rows.find((r: any) => r.model === "fixture-b").id, bId);
    },
  );
  await t.test(
    "rejects duplicate models, unknown departments, invalid URL and excessive selections atomically",
    async () => {
      const good = {
        ...config,
        serviceId,
        models: [{ model: "fixture-a", kind: "chat" }],
      };
      const before = JSON.stringify(
        (await req("/model-services", undefined, admin.cookie)).data,
      );
      for (const invalid of [
        { ...good, models: [good.models[0], good.models[0]] },
        { ...good, departments: [randomUUID()] },
        { ...good, baseUrl: "http://untrusted.invalid/v1" },
        { ...good, baseUrl: "https://example.com/v1?key=synthetic" },
        {
          ...good,
          models: Array.from({ length: 201 }, (_, i) => ({
            model: "fixture-" + i,
            kind: "chat",
          })),
        },
      ])
        assert.equal(
          (await req("/model-services", invalid, admin.cookie)).status,
          400,
        );
      assert.equal(
        JSON.stringify(
          (await req("/model-services", undefined, admin.cookie)).data,
        ),
        before,
      );
      const audit = platform.store.db.prepare("SELECT * FROM audit").all();
      assert.ok(!JSON.stringify(audit).includes(config.apiKey));
    },
  );
});

test("legacy LinoRoute migration preserves IDs, keys, department scope and enabled state after restart", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "corporate-brain-service-migration-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const file = join(dir, "test.sqlite");
  const store = createStore(file),
    id = randomUUID(),
    departmentId = randomUUID();
  store.db
    .prepare(
      "INSERT INTO connections(id,name,base_url,model,kind,departments,secret,enabled) VALUES(?,'LinoRoute','https://linoroute.com/v1','fixture-a','chat',?,?,0)",
    )
    .run(
      id,
      JSON.stringify([departmentId]),
      store.encrypt("synthetic-migration-key"),
    );
  store.close();
  for (let i = 0; i < 2; i++) {
    const platform = createPlatform({ database: file });
    const row = platform.store.db
      .prepare("SELECT * FROM connections WHERE id=?")
      .get(id)!;
    assert.equal(row.enabled, 0);
    assert.equal(row.secret, "");
    assert.equal(row.departments, JSON.stringify([departmentId]));
    const service = platform.store.db
      .prepare("SELECT * FROM model_services WHERE id=?")
      .get(row.service_id as string)!;
    assert.equal(
      platform.store.decrypt(String(service.secret)),
      "synthetic-migration-key",
    );
    assert.equal(
      platform.store.db.prepare("SELECT count(*) n FROM model_services").get()!
        .n,
      1,
    );
    await platform.production.close();
    platform.store.close();
  }
});

test("provider presets recommend LinoRoute first and include the requested official services", () => {
  assert.equal(modelProviders[0].id, "linoroute");
  assert.equal(modelProviders[0].recommended, true);
  assert.deepEqual(
    modelProviders.map((p) => p.id),
    [
      "linoroute",
      "deepseek",
      "kimi",
      "qwen",
      "hunyuan",
      "zhipu",
      "minimax",
      "openai",
      "gemini",
      "claude",
      "custom",
    ],
  );
  for (const p of modelProviders.filter((p) => p.id !== "custom"))
    assert.equal(new URL(p.baseUrl).protocol, "https:");
});
