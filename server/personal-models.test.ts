import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createPlatform } from "./platform";
import {
  modelFetch,
  personalModelUrl,
  publicModelAddress,
  privateModelProxy,
  publicModelLookup,
  scopedModelLookup,
  modelUsesCustomDns,
} from "./model-transport";

test("model DNS configuration loaded after imports applies to transport and can be disabled", async () => {
  const previous = process.env.BRAIN_MODEL_DOH_HOSTS;
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(init);
    return new Response("OK");
  }) as typeof fetch;
  try {
    delete process.env.BRAIN_MODEL_DOH_HOSTS;
    assert.equal(modelUsesCustomDns("https://model.example/v1"), false);
    process.env.BRAIN_MODEL_DOH_HOSTS = " MODEL.EXAMPLE , other.example ";
    assert.equal(modelUsesCustomDns("https://model.example/v1"), true);
    assert.equal(modelUsesCustomDns("http://model.example/v1"), false);
    assert.equal(modelUsesCustomDns("https://unconfigured.example/v1"), false);
    await modelFetch({}, "https://model.example/v1", {});
    assert.ok(requests.at(-1).dispatcher);
    delete process.env.BRAIN_MODEL_DOH_HOSTS;
    await modelFetch({}, "https://model.example/v1", {});
    assert.equal(requests.at(-1).dispatcher, undefined);
    assert.equal(modelUsesCustomDns("https://model.example/v1"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.BRAIN_MODEL_DOH_HOSTS;
    else process.env.BRAIN_MODEL_DOH_HOSTS = previous;
  }
});

test("Project model DNS uses verified HTTPS resolution only for configured hosts, caches TTL and rejects private answers", async () => {
  let calls = 0;
  const resolver = scopedModelLookup(
    new Set(["model.example"]),
    ((_h: any, _o: any, cb: any) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }])) as any,
    async () => {
      calls++;
      return [{ address: "8.8.8.8", ttl: 30 }];
    },
  );
  const run = (fn: any, host: string) =>
    new Promise<any[]>((resolve, reject) =>
      fn(host, { all: true }, (e: any, r: any[]) =>
        e ? reject(e) : resolve(r),
      ),
    );
  assert.deepEqual(await run(resolver, "model.example"), [
    { address: "8.8.8.8", family: 4 },
  ]);
  await run(resolver, "model.example");
  assert.equal(calls, 1);
  assert.deepEqual(await run(resolver, "localhost"), [
    { address: "127.0.0.1", family: 4 },
  ]);
  const blocked = scopedModelLookup(
    new Set(["model.example"]),
    undefined,
    async () => [{ address: "192.168.1.1", ttl: 20 }],
  );
  await assert.rejects(run(blocked, "model.example"), /non-public/);
});

test("employees privately configure models and choose the authorized LinoRoute catalog without sharing credentials", async (t) => {
  const old = process.env.BRAIN_DSH_ENABLED;
  process.env.BRAIN_DSH_ENABLED = "0";
  const calls: { url: string; key: string; model?: string }[] = [];
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({
      url: req.url!,
      key: String(req.headers.authorization),
      model: body.model,
    });
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("/models"))
      res.end(
        JSON.stringify({
          data: [
            { id: "catalog-a" },
            { id: "catalog-b" },
            { id: "catalog-image" },
          ],
        }),
      );
    else if (req.url?.endsWith("/images/generations"))
      res.end(
        JSON.stringify({
          data: [
            {
              b64_json:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
            },
          ],
        }),
      );
    else
      res.end(
        JSON.stringify({
          choices: [
            { message: { content: "Personal fixture answer " + body.model } },
          ],
        }),
      );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as any).port}`;
  const platform = createPlatform({
    database: ":memory:",
    modelTransport: (row, url, init) =>
      fetch(
        row.owner_user_id && !row.source_service_id
          ? url.replace("https://personal-model.invalid", upstreamUrl)
          : url,
        init,
      ),
  });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    upstream.closeAllConnections();
    upstream.close();
    await platform.production.close();
    await platform.library.close();
    platform.store.close();
    if (old === undefined) delete process.env.BRAIN_DSH_ENABLED;
    else process.env.BRAIN_DSH_ENABLED = old;
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function req(
    path: string,
    body?: unknown,
    cookie = "",
    method = body ? "POST" : "GET",
  ) {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }
  const password = "Synthetic-Personal-Models-2026";
  await req("/bootstrap", {
    companyName: "Personal fixture",
    name: "Admin",
    username: "personal-admin",
    password,
  });
  const admin = await req("/auth/login", {
    username: "personal-admin",
    password,
  });
  const dept = (
    await req("/departments", { name: "Other private fixture" }, admin.cookie)
  ).data;
  async function staff(username: string, departmentId: string) {
    const user = await req(
      "/users",
      { username, name: username, departmentId, role: "employee" },
      admin.cookie,
    );
    const login = await req("/auth/login", {
      username,
      password: user.data.initialPassword,
    });
    await req(
      "/auth/password",
      { current: user.data.initialPassword, password },
      login.cookie,
    );
    return await req("/auth/login", { username, password });
  }
  const a = await staff("private-a", admin.data.departmentId),
    b = await staff("private-b", dept.id);
  const config = {
    provider: "linoroute",
    name: "Private fixture",
    baseUrl: "https://personal-model.invalid/v1",
    apiKey: "synthetic-personal-key",
    models: [
      { model: "catalog-b", kind: "chat" },
      { model: "catalog-image", kind: "image" },
    ],
  };
  let service: any, chat: any, image: any, source: any, borrowedChat: any;
  const chatBody = (connectionId: string) => ({
    connectionId,
    messages: [{ role: "user", content: "Fixture request" }],
  });
  await t.test(
    "employee creates encrypted own service; other employees and company admin cannot list or call it",
    async () => {
      const result = await req("/my-model-services", config, a.cookie);
      assert.equal(result.status, 201);
      service = result.data;
      assert.equal(service.personal, true);
      assert.deepEqual(service.departments, []);
      const stored = platform.store.db
        .prepare("SELECT * FROM model_services WHERE id=?")
        .get(service.id)!;
      assert.equal(stored.owner_user_id, a.data.id);
      assert.notEqual(stored.secret, config.apiKey);
      assert.equal(
        platform.store.decrypt(String(stored.secret)),
        config.apiKey,
      );
      const own = (await req("/connections", undefined, a.cookie)).data;
      chat = own.find((c: any) => c.kind === "chat");
      image = own.find((c: any) => c.kind === "image");
      assert.equal(chat.personal, true);
      for (const cookie of [b.cookie, admin.cookie]) {
        assert.equal(
          (await req("/connections", undefined, cookie)).data.some(
            (c: any) => c.id === chat.id,
          ),
          false,
        );
        assert.equal(
          (await req("/generate/chat", chatBody(chat.id), cookie)).status,
          403,
        );
        assert.equal(
          (await req("/skills", undefined, cookie)).data.some(
            (s: any) => s.id === image.id,
          ),
          false,
        );
      }
      assert.equal(
        (await req("/my-model-services", undefined, b.cookie)).data.length,
        0,
      );
      assert.equal(
        (await req("/model-services", undefined, admin.cookie)).data.length,
        0,
      );
      assert.ok(
        !JSON.stringify(
          (await req("/my-model-services", undefined, a.cookie)).data,
        ).includes(config.apiKey),
      );
    },
  );
  await t.test(
    "private chat and image capability execute with owner credentials, while forged scopes and service IDs are rejected",
    async () => {
      const result = await req(
        "/generate/chat",
        { ...chatBody(chat.id), skillIds: [image.id], imageSkillId: image.id },
        a.cookie,
      );
      assert.equal(result.status, 200);
      assert.match(result.data.content, /catalog-b/);
      assert.match(result.data.image, /^data:image\/png;base64,/);
      assert.equal(calls.at(-1)?.key, "Bearer synthetic-personal-key");
      assert.equal(
        (
          await req(
            "/my-model-services",
            { ...config, departments: [] },
            a.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            "/my-model-services",
            { ...config, ownerUserId: b.data.id },
            a.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            "/my-model-services",
            { ...config, serviceId: service.id },
            b.cookie,
          )
        ).status,
        404,
      );
      assert.equal(
        (await req(`/my-model-services/${service.id}`, {}, b.cookie, "DELETE"))
          .status,
        404,
      );
      assert.equal(
        (await req(`/connections/${chat.id}`, {}, admin.cookie, "DELETE"))
          .status,
        403,
      );
    },
  );
  await t.test(
    "personal refresh retains encrypted key and IDs; changing host needs a new key and private addresses are forbidden",
    async () => {
      assert.deepEqual(
        (
          await req(
            "/my-model-services/discover",
            {
              provider: config.provider,
              name: config.name,
              baseUrl: config.baseUrl,
              serviceId: service.id,
            },
            a.cookie,
          )
        ).data.models,
        ["catalog-a", "catalog-b", "catalog-image"],
      );
      const { apiKey: _, ...saved } = config;
      assert.equal(
        (
          await req(
            "/my-model-services",
            { ...saved, serviceId: service.id },
            a.cookie,
          )
        ).status,
        200,
      );
      assert.equal(
        (await req("/connections", undefined, a.cookie)).data.find(
          (c: any) => c.model === "catalog-b",
        ).id,
        chat.id,
      );
      assert.equal(
        (
          await req(
            "/my-model-services",
            {
              ...saved,
              serviceId: service.id,
              baseUrl: "https://other.invalid/v1",
            },
            a.cookie,
          )
        ).status,
        400,
      );
      const before = calls.length;
      for (const baseUrl of [
        "http://127.0.0.1/v1",
        "https://192.168.20.21/v1",
        "https://[::1]/v1",
        "https://localhost/v1",
      ]) {
        assert.equal(
          (await req("/my-model-services", { ...config, baseUrl }, a.cookie))
            .status,
          400,
        );
      }
      assert.equal(calls.length, before);
    },
  );
  const company = {
    provider: "linoroute",
    name: "Company catalog fixture",
    baseUrl: upstreamUrl + "/v1",
    apiKey: "synthetic-company-key",
    departments: [admin.data.departmentId],
    models: [{ model: "catalog-a", kind: "chat" }],
  };
  await t.test(
    "employee browses full company LinoRoute catalog and selects models not pre-enabled by admin, only for themselves",
    async () => {
      source = (await req("/model-services", company, admin.cookie)).data;
      const catalog = (
        await req("/company-model-catalogs", undefined, a.cookie)
      ).data;
      assert.equal(catalog.length, 1);
      assert.equal(catalog[0].id, source.id);
      assert.equal(
        (await req("/company-model-catalogs", undefined, b.cookie)).data.length,
        0,
      );
      assert.equal(
        (
          await req(
            `/company-model-catalogs/${source.id}/discover`,
            {},
            b.cookie,
          )
        ).status,
        404,
      );
      const found = await req(
        `/company-model-catalogs/${source.id}/discover`,
        {},
        a.cookie,
      );
      assert.equal(found.status, 200);
      assert.deepEqual(found.data.models, [
        "catalog-a",
        "catalog-b",
        "catalog-image",
      ]);
      assert.equal(
        (
          await req(
            `/company-model-catalogs/${source.id}/selection`,
            { models: [{ model: "not-in-catalog", kind: "chat" }] },
            a.cookie,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await req(
            `/company-model-catalogs/${source.id}/selection`,
            { models: config.models, departments: [] },
            a.cookie,
          )
        ).status,
        400,
      );
      const selected = await req(
        `/company-model-catalogs/${source.id}/selection`,
        { models: config.models },
        a.cookie,
      );
      assert.equal(selected.status, 200);
      const stored = platform.store.db
        .prepare("SELECT * FROM model_services WHERE id=?")
        .get(selected.data.id)!;
      assert.equal(stored.secret, "");
      assert.equal(stored.owner_user_id, a.data.id);
      assert.equal(stored.source_service_id, source.id);
      borrowedChat = (await req("/connections", undefined, a.cookie)).data.find(
        (c: any) => c.sourceServiceId === source.id && c.kind === "chat",
      );
      assert.equal(
        (await req("/generate/chat", chatBody(borrowedChat.id), a.cookie))
          .status,
        200,
      );
      assert.equal(calls.at(-1)?.key, "Bearer synthetic-company-key");
      assert.equal(
        (await req("/generate/chat", chatBody(borrowedChat.id), b.cookie))
          .status,
        403,
      );
      assert.deepEqual(
        (await req("/model-services", undefined, admin.cookie)).data.find(
          (s: any) => s.id === source.id,
        ).models,
        company.models,
      );
    },
  );
  await t.test(
    "source key/address rotation applies to personal choices; withdrawal of source scope blocks every borrowed connection",
    async () => {
      await req(
        "/model-services",
        {
          ...company,
          serviceId: source.id,
          apiKey: "synthetic-rotated-key",
          baseUrl: upstreamUrl + "/v2",
        },
        admin.cookie,
      );
      assert.equal(
        (await req("/generate/chat", chatBody(borrowedChat.id), a.cookie))
          .status,
        200,
      );
      assert.equal(calls.at(-1)?.key, "Bearer synthetic-rotated-key");
      assert.equal(calls.at(-1)?.url, "/v2/chat/completions");
      await req(
        "/model-services",
        { ...company, serviceId: source.id, departments: [dept.id] },
        admin.cookie,
      );
      const before = calls.length;
      assert.equal(
        (await req("/generate/chat", chatBody(borrowedChat.id), a.cookie))
          .status,
        403,
      );
      assert.equal(calls.length, before);
      assert.equal(
        (await req("/connections", undefined, a.cookie)).data.some(
          (c: any) => c.id === borrowedChat.id,
        ),
        false,
      );
      assert.equal(
        (await req("/company-model-catalogs", undefined, a.cookie)).data.length,
        0,
      );
      assert.equal(
        (await req("/generate/chat", chatBody(chat.id), a.cookie)).status,
        200,
      );
    },
  );
  await t.test(
    "removing own service clears stored personal secret and disables only its models",
    async () => {
      assert.equal(
        (await req(`/my-model-services/${service.id}`, {}, a.cookie, "DELETE"))
          .status,
        200,
      );
      assert.equal(
        (await req("/generate/chat", chatBody(chat.id), a.cookie)).status,
        403,
      );
      assert.equal(
        platform.store.db
          .prepare("SELECT secret FROM model_services WHERE id=?")
          .get(service.id)!.secret,
        "",
      );
      assert.equal(
        (await req("/model-services", undefined, admin.cookie)).data.length,
        1,
      );
    },
  );
});

test("personal provider egress refuses private, loopback and special addresses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "100.100.100.200",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.2.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ])
    assert.equal(publicModelAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(publicModelAddress(ip), true, ip);
  for (const url of [
    "http://example.com/v1",
    "https://127.0.0.1/v1",
    "https://localhost/v1",
    "https://foo.local/v1",
    "https://a:b@example.com/v1",
    "https://example.com/v1?key=private",
  ])
    assert.throws(() => personalModelUrl(url));
  await assert.rejects(
    modelFetch({ owner_user_id: "fixture" }, "https://127.0.0.1/v1/models", {}),
  );
});

test("DSH personal provider proxy confines paths and forwards streaming through the guarded transport", async () => {
  let forwarded = 0;
  const proxy = await privateModelProxy(
    { base_url: "https://personal.invalid/v1" },
    "synthetic-private-key",
    async (_row, url, init) => {
      forwarded++;
      assert.equal(url, "https://personal.invalid/v1/chat/completions");
      assert.equal(
        (init.headers as any).Authorization,
        "Bearer synthetic-private-key",
      );
      return new Response('data: {"fixture":true}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  );
  try {
    assert.equal((await fetch(proxy.url + "/models")).status, 403);
    assert.equal(
      (
        await fetch(proxy.url + "/chat/completions", {
          method: "POST",
          body: "{}",
        })
      ).status,
      403,
    );
    const result = await fetch(proxy.url + "/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.key}` },
      body: "{}",
    });
    assert.equal(result.status, 200);
    assert.match(await result.text(), /fixture/);
    assert.equal(forwarded, 1);
  } finally {
    await proxy.close();
  }
});

test("socket DNS lookup rejects mixed/private results and revalidates reconnections", async () => {
  const resolve = (records: any[]) =>
    new Promise<any>((done) =>
      publicModelLookup(
        "fixture.invalid",
        { all: true },
        (error: any, addresses: any) => done({ error, addresses }),
        ((_host: any, _options: any, cb: any) => cb(null, records)) as any,
      ),
    );
  assert.ok(
    (
      await resolve([
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ])
    ).error,
  );
  assert.ok((await resolve([{ address: "10.1.2.3", family: 4 }])).error);
  assert.deepEqual(
    (await resolve([{ address: "1.1.1.1", family: 4 }])).addresses,
    [{ address: "1.1.1.1", family: 4 }],
  );
  assert.ok((await resolve([{ address: "192.168.20.21", family: 4 }])).error);
});
