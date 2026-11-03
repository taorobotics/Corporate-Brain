import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createPlatform } from "./platform";
import { NasError, nasPath, nasSegment } from "./nas";

test("NAS paths preserve department names and reject escapes, alternate streams and ambiguous separators", () => {
  for (const p of ["", "产品组/2026 年", "AI 研发组/素材.v2"])
    assert.equal(nasPath.parse(p), p);
  for (const p of [
    "../财务",
    "/财务",
    "研发/../财务",
    "a\\..\\b",
    "a//b",
    "a/",
    "C:/a",
    "a:stream",
    "a\0b",
    "a/.. ",
    "a/.",
    Array(34).fill("a").join("/"),
  ])
    assert.equal(nasPath.safeParse(p).success, false, p);
  assert.equal(nasSegment.safeParse("a/b").success, false);
});

test("NAS API isolates departments, encrypts credentials, rechecks revocation and never grants admin implicit document access", async (t) => {
  let calls = 0,
    release: undefined | (() => void),
    entered: undefined | (() => void),
    block = false,
    deny = false;
  const platform = createPlatform({
    database: ":memory:",
    origins: ["https://company.test"],
    nas: {
      list: async (source, path, search) => {
        calls++;
        assert.equal(source.password, "Fixture$Pwd\\\\;Only");
        if (deny) throw new NasError("AUTH_FAILED");
        if (block) {
          entered?.();
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return {
          entries: [
            {
              name: "许可素材",
              directory: true,
              blocked: false,
              bytes: 0,
              modified: null,
            },
            {
              name: `报告-${path || search || "全部"}.txt`,
              directory: false,
              blocked: false,
              bytes: 33,
              modified: null,
            },
          ],
          truncated: false,
        };
      },
    },
  });
  const server = createServer(platform.app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await platform.library.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  async function request(
    path: string,
    body?: any,
    cookie = "",
    method = body === undefined ? "GET" : "POST",
    origin?: string,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
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
  const password = "Synthetic-Nas-Test-Password";
  await request("/bootstrap", {
    companyName: "Fixture company",
    username: "admin",
    name: "Admin",
    password,
  });
  const admin = (await request("/auth/login", { username: "admin", password }))
    .cookie;
  const depA = (await request("/departments", { name: "研发" }, admin)).data,
    depB = (await request("/departments", { name: "财务" }, admin)).data;
  async function employee(username: string, departmentId: string) {
    const c = (
      await request("/users", { username, name: username, departmentId }, admin)
    ).data;
    const first = (
      await request("/auth/login", { username, password: c.initialPassword })
    ).cookie;
    await request(
      "/auth/password",
      { current: c.initialPassword, password },
      first,
    );
    return (await request("/auth/login", { username, password })).cookie;
  }
  const a = await employee("researcher", depA.id),
    b = await employee("finance", depB.id);
  const config = {
    name: "研发资料",
    host: "192.168.20.16",
    share: "研发",
    basePath: "公开",
    username: "nas-user",
    password: "Fixture$Pwd\\\\;Only",
    departmentIds: [depA.id],
    enabled: true,
  };
  assert.equal((await request("/admin/knowledge", config, a)).status, 403);
  assert.equal(
    (
      await request(
        "/admin/knowledge",
        config,
        admin,
        "POST",
        "https://attacker.test",
      )
    ).status,
    403,
  );
  for (const host of [
    "127.0.0.1",
    "169.254.169.254",
    "example.com",
    "010.1.1.1",
    "192.168.1.256",
  ])
    assert.equal(
      (await request("/admin/knowledge", { ...config, host }, admin)).status,
      400,
    );
  const created = await request("/admin/knowledge", config, admin);
  assert.equal(created.status, 201);
  const id = created.data.id;
  assert.equal(created.data.hasPassword, true);
  assert.ok(!JSON.stringify(created.data).includes(config.password));
  const raw = platform.store.db
    .prepare("SELECT secret FROM nas_sources WHERE id=?")
    .get(id)!;
  assert.notEqual(raw.secret, config.password);
  assert.equal(platform.store.decrypt(String(raw.secret)), config.password);
  assert.equal((await request("/knowledge/sources")).status, 401);
  assert.equal(
    (await request("/knowledge/sources", undefined, a)).data.length,
    1,
  );
  assert.deepEqual(
    (await request("/knowledge/sources", undefined, b)).data,
    [],
  );
  assert.deepEqual(
    (await request("/knowledge/sources", undefined, admin)).data,
    [],
  );
  for (const cookie of [b, admin])
    assert.equal(
      (await request(`/knowledge/sources/${id}/files`, undefined, cookie))
        .status,
      404,
    );
  assert.equal(calls, 0);
  const listing = await request(
    `/knowledge/sources/${id}/files?path=设计&search=素材`,
    undefined,
    a,
  );
  assert.equal(listing.status, 200);
  assert.equal(listing.data.entries.length, 2);
  assert.equal(listing.data.path, "设计");
  const visible = (await request("/knowledge/sources", undefined, a)).data[0];
  assert.ok(!("username" in visible));
  assert.ok(!("host" in visible));
  assert.ok(!("secret" in visible));
  for (const path of ["../财务", "x\\..\\y", "x:stream", "/私密", "a//b"])
    assert.equal(
      (
        await request(
          `/knowledge/sources/${id}/files?path=${encodeURIComponent(path)}`,
          undefined,
          a,
        )
      ).status,
      400,
    );
  const beforeCalls = calls;
  assert.equal(
    (await request(`/admin/knowledge/${id}/test?path=私密`, {}, admin)).status,
    400,
  );
  assert.equal(calls, beforeCalls);
  const checked = await request(`/admin/knowledge/${id}/test`, {}, admin);
  assert.equal(checked.status, 200);
  assert.equal(checked.data.entryCount, 2);
  assert.ok(!("entries" in checked.data));
  assert.equal(
    (
      await request(
        `/admin/knowledge/${id}`,
        { ...config, password: "", revision: 99 },
        admin,
        "PATCH",
      )
    ).status,
    409,
  );
  // Revoke while a slow NAS request is in flight: stale results must never leave the server.
  block = true;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const pending = request(`/knowledge/sources/${id}/files`, undefined, a);
  await started;
  assert.equal(
    (await request(`/knowledge/sources/${id}/files`, undefined, a)).status,
    429,
  );
  const changed = await request(
    `/admin/knowledge/${id}`,
    { ...config, password: "", enabled: false, revision: 1 },
    admin,
    "PATCH",
  );
  assert.equal(changed.status, 200);
  release!();
  assert.equal((await pending).status, 409);
  block = false;
  assert.equal(
    (await request(`/knowledge/sources/${id}/files`, undefined, a)).status,
    404,
  );
  const enabled = await request(
    `/admin/knowledge/${id}`,
    { ...config, password: "", revision: changed.data.revision },
    admin,
    "PATCH",
  );
  assert.equal(enabled.status, 200);
  block = true;
  const logoutStarted = new Promise<void>((r) => {
    entered = r;
  });
  const pendingLogout = request(`/knowledge/sources/${id}/files`, undefined, a);
  await logoutStarted;
  await request("/auth/logout", {}, a);
  release!();
  assert.equal((await pendingLogout).status, 403);
  block = false;
  deny = true;
  const failed = await request(`/admin/knowledge/${id}/test`, {}, admin);
  assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(failed.data).includes(config.password));
  const authCalls = calls;
  assert.equal(
    (await request(`/admin/knowledge/${id}/test`, {}, admin)).status,
    429,
  );
  assert.equal(calls, authCalls);
  const audit = platform.store.db.prepare("SELECT * FROM audit").all();
  assert.ok(!JSON.stringify(audit).includes(config.password));
  assert.ok(!JSON.stringify(audit).includes("报告-"));
});
