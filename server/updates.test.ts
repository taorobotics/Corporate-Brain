import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createPlatform } from "./platform";
import { installerName } from "./updates";

async function start(t: any, updates: any) {
  const platform = createPlatform({
    database: ":memory:",
    updates: { publicSource: false, ...updates },
  });
  const server = createServer(platform.app).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    platform.store.close();
  });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const setup = await fetch(`${base}/api/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: "管理部",
      username: "qa-updates",
      name: "更新验收",
      password: "Update-Test-Only-Password",
    }),
  });
  assert.equal(setup.status, 201);
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "qa-updates",
      password: "Update-Test-Only-Password",
    }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  return {
    base,
    get: (path: string) =>
      fetch(`${base}/api/desktop-updates${path}`, {
        headers: { Cookie: cookie },
      }),
  };
}
function published() {
  const bytes = Buffer.from("Inert release fixture; not an executable.");
  return {
    bytes,
    data: {
      tag_name: "v0.2.0",
      draft: false,
      prerelease: false,
      body: "更新说明",
      published_at: "2026-10-19T00:00:00Z",
      assets: ["win32-x64", "darwin-arm64", "darwin-x64"].map((target, i) => ({
        id: i + 10,
        name: installerName("0.2.0", target),
        size: bytes.length,
        state: "uploaded",
        digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      })),
    },
  };
}
test("private update source requires company login and never returns credentials or signed URLs", async (t) => {
  const fixture = published(),
    calls: { url: string; init: RequestInit }[] = [];
  const token = "test-only-private-token";
  const p = await start(t, {
    token,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("latest")) return Response.json(fixture.data);
      if (url.includes("/releases/assets/"))
        return new Response(null, {
          status: 302,
          headers: {
            location:
              "https://release-assets.githubusercontent.com/qa/fixture?signature=not-for-client",
          },
        });
      return new Response(fixture.bytes);
    },
  });
  assert.equal(
    (await fetch(`${p.base}/api/desktop-updates/latest`)).status,
    401,
  );
  assert.equal(calls.length, 0);
  const raw = await (await p.get("/latest")).text();
  assert.ok(
    !raw.includes(token) &&
      !raw.includes("signature") &&
      !raw.includes("api.github.com"),
  );
  assert.equal(JSON.parse(raw).release.version, "0.2.0");
  await p.get("/latest");
  assert.equal(calls.length, 1, "latest metadata is cached");
  for (const target of ["win32-x64", "darwin-arm64", "darwin-x64"]) {
    const download = await p.get(`/0.2.0/${target}`);
    assert.equal(download.status, 200);
    assert.ok(
      download.headers
        .get("content-disposition")
        ?.includes(installerName("0.2.0", target)),
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture.bytes);
  }
  assert.equal((calls[0].init.headers as any).Authorization, `Bearer ${token}`);
  for (const call of calls.filter((call) =>
    call.url.startsWith("https://release-assets."),
  ))
    assert.equal(call.init.headers, undefined);
  const before = calls.length;
  assert.equal((await p.get("/0.1.0/win32-x64")).status, 409);
  assert.equal((await p.get("/0.2.0/linux-x64")).status, 400);
  assert.equal(calls.length, before);
});
test("unconfigured server reports the actual state without contacting GitHub", async (t) => {
  const p = await start(t, {
    token: "",
    fetch: () => {
      throw new Error("Unexpected network");
    },
  });
  assert.deepEqual(await (await p.get("/latest")).json(), {
    configured: false,
    release: null,
    reason: "not-configured",
  });
});
test("unpublished, preview or incomplete releases are not distributed and failures redact provider errors", async (t) => {
  for (const kind of ["draft", "prerelease", "missing", "credential-error"]) {
    const f = published();
    if (kind === "draft") f.data.draft = true;
    if (kind === "prerelease") f.data.prerelease = true;
    if (kind === "missing") f.data.assets.pop();
    const p = await start(t, {
      token: "secret-must-not-leak",
      fetch: async () => {
        if (kind === "credential-error")
          throw new Error("Provider secret-must-not-leak");
        return Response.json(f.data);
      },
    });
    const response = await p.get("/latest");
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("secret-must-not-leak"));
  }
});
test("asset redirects cannot send GitHub credentials or employee downloads to an arbitrary host", async (t) => {
  const f = published();
  let external = false;
  const p = await start(t, {
    token: "test-only",
    fetch: async (url: string) => {
      if (url.endsWith("latest")) return Response.json(f.data);
      if (url.includes("/releases/assets/"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://untrusted.example/installer" },
        });
      external = true;
      throw new Error("Unexpected external request");
    },
  });
  assert.equal((await p.get("/0.2.0/win32-x64")).status, 503);
  assert.equal(external, false);
});

test("explicit public update channel checks and downloads without a GitHub token", async (t) => {
  const fixture = published();
  const p = await start(t, {
    token: "",
    publicSource: true,
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(
        (init.headers as Record<string, string>)?.Authorization,
        undefined,
      );
      return String(url).endsWith("latest")
        ? Response.json(fixture.data)
        : new Response(fixture.bytes);
    },
  });
  const latest = await (await p.get("/latest")).json();
  assert.equal(latest.configured, true);
  assert.equal(latest.release.version, "0.2.0");
  const download = await p.get("/0.2.0/win32-x64");
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture.bytes);
});
