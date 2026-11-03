import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createPlatform } from "./platform";
import { installerName } from "./updates";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import mirror from "../shared/update-mirror.cjs";

async function start(t: any, updates: any) {
  const platform = createPlatform({
    database: ":memory:",
    updates,
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
    get: (path: string, headers: Record<string, string> = {}) =>
      fetch(`${base}/api/desktop-updates${path}`, {
        headers: { Cookie: cookie, ...headers },
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

async function mirrorFixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), "brain-mirror-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from("An inert installer fixture. Never execute.");
  const manifest = (version = "0.11.0") => ({
    version,
    notes: "更新",
    publishedAt: "2026-11-02T00:00:00Z",
    assets: Object.fromEntries(
      mirror.targets.map((target) => [
        target,
        {
          name: installerName(version, target),
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ]),
    ),
  });
  const bundle = (release: any, payload = bytes) =>
    Buffer.concat([
      Buffer.from(JSON.stringify(release) + "\n"),
      ...mirror.targets.map(() => payload),
    ]);
  const publish = (release: any) =>
    mirror.importBundle(Readable.from([bundle(release)]), directory);
  return { directory, bytes, manifest, bundle, publish };
}
test("company mirror serves authenticated old-client feed, full downloads and verified byte ranges without GitHub", async (t) => {
  const f = await mirrorFixture(t),
    release = f.manifest();
  await f.publish(release);
  const p = await start(t, {
    directory: f.directory,
    fetch: () => {
      throw new Error("No GitHub access allowed");
    },
  });
  assert.equal(
    (await fetch(`${p.base}/api/desktop-updates/latest`)).status,
    401,
  );
  assert.deepEqual(await (await p.get("/latest")).json(), {
    configured: true,
    release,
  });
  for (const target of mirror.targets) {
    const full = await p.get(`/0.11.0/${target}`);
    assert.equal(full.status, 200);
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), f.bytes);
    const hash = release.assets[target].sha256;
    const range = await p.get(`/0.11.0/${target}`, {
      Range: "bytes=7-",
      "If-Range": `"${hash}"`,
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("etag"), `"${hash}"`);
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      f.bytes.subarray(7),
    );
  }
  await f.publish(f.manifest("0.12.0"));
  assert.equal(
    (await (await p.get("/latest")).json()).release.version,
    "0.12.0",
  );
  assert.equal(
    (await p.get("/0.11.0/win32-x64")).status,
    200,
    "old version remains downloadable after promotion",
  );
  const asset = f.manifest("0.12.0").assets["win32-x64"];
  await writeFile(
    join(f.directory, "0.12.0", asset.name),
    Buffer.alloc(asset.bytes, 1),
  );
  assert.equal(
    (await p.get("/latest")).status,
    503,
    "corrupt mirror never reports current/available",
  );
  assert.equal((await p.get("/0.12.0/win32-x64")).status, 409);
});
test("private platform channels serve verified installers to old and new clients without advertising missing architectures", async (t) => {
  const f = await mirrorFixture(t);
  await f.publish(f.manifest("0.11.0"));
  const target = "darwin-arm64",
    next = f.manifest("0.12.0");
  const partial = { ...next, assets: { [target]: next.assets[target] } };
  const bytes = Buffer.concat([
    Buffer.from(JSON.stringify(partial) + "\n"),
    f.bytes,
  ]);
  // Partial packages remain invalid in the public, all-platform release flow.
  assert.throws(() => mirror.validateRelease(partial), /manifest/);
  assert.throws(() => mirror.validateRelease(partial, "../unsafe"), /target/);
  const folder = join(f.directory, "channels", target);
  await mirror.importBundle(Readable.from([bytes]), folder, target);
  const p = await start(t, {
    directory: f.directory,
    fetch: () => {
      throw new Error("No GitHub");
    },
  });
  assert.equal(
    (await (await p.get("/latest", { "X-Brain-Update-Target": target })).json())
      .release.version,
    "0.12.0",
  );
  // A real old Electron session sends its normal auth cookie plus the renderer's platform cookie.
  const setupResponse = await fetch(`${p.base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "qa-updates",
      password: "Update-Test-Only-Password",
    }),
  });
  const cookie = setupResponse.headers.get("set-cookie")!.split(";")[0];
  const legacy = await fetch(`${p.base}/api/desktop-updates/latest`, {
    headers: { Cookie: `${cookie}; brain_update_target=${target}` },
  });
  assert.equal((await legacy.json()).release.version, "0.12.0");
  assert.equal(
    (
      await (
        await p.get("/latest", { "X-Brain-Update-Target": "darwin-x64" })
      ).json()
    ).release.version,
    "0.11.0",
  );
  const full = await p.get(`/0.12.0/${target}`);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), f.bytes);
  const range = await p.get(`/0.12.0/${target}`, {
    Range: "bytes=7-",
    "If-Range": `"${partial.assets[target].sha256}"`,
  });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), f.bytes.subarray(7));
  assert.equal((await p.get("/0.12.0/darwin-x64")).status, 409);
  assert.equal(
    (await p.get("/latest", { "X-Brain-Update-Target": "../unsafe" })).status,
    400,
  );
  await assert.rejects(
    mirror.importBundle(Readable.from([bytes.subarray(0, -1)]), folder, target),
    /Incomplete/,
  );
  const asset = partial.assets[target];
  await writeFile(
    join(folder, next.version, asset.name),
    Buffer.alloc(asset.bytes),
  );
  assert.equal(
    (await p.get("/latest", { "X-Brain-Update-Target": target })).status,
    503,
  );
  assert.equal((await p.get(`/0.12.0/${target}`)).status, 409);
  await writeFile(join(folder, next.version, asset.name), f.bytes);
  await f.publish(f.manifest("0.13.0"));
  assert.equal(
    (await (await p.get("/latest", { "X-Brain-Update-Target": target })).json())
      .release.version,
    "0.13.0",
  );
  assert.equal((await p.get(`/0.13.0/${target}`)).status, 200);
  assert.equal((await p.get(`/0.12.0/${target}`)).status, 200);
});

test("mirror publishing is atomic, immutable, bounded, idempotent and rejects downgrades and incomplete/tampered bundles", async (t) => {
  const f = await mirrorFixture(t),
    first = f.manifest();
  await f.publish(first);
  await f.publish(first);
  const before = await readFile(join(f.directory, "latest.json"));
  const next = f.manifest("0.12.0");
  for (const invalid of [
    f.bundle(next).subarray(0, -1),
    f.bundle(next, Buffer.alloc(f.bytes.length)),
    Buffer.concat([f.bundle(next), Buffer.from("extra")]),
    Buffer.alloc(65537, 97),
  ]) {
    await assert.rejects(
      mirror.importBundle(Readable.from([invalid]), f.directory),
    );
    assert.deepEqual(await readFile(join(f.directory, "latest.json")), before);
  }
  await assert.rejects(f.publish(f.manifest("0.9.0")), /downgrade/);
  await assert.rejects(f.publish({ ...first, notes: "replaced" }), /immutable/);
  const traversal = f.manifest("0.12.0");
  traversal.assets["win32-x64"].name = "../evil.exe";
  await assert.rejects(f.publish(traversal), /manifest/);
  assert.equal(
    (await readdir(f.directory)).some((name) => name.startsWith(".incoming")),
    false,
  );
  // Exercise network chunk boundaries and version retention.
  await mirror.importBundle(
    Readable.from([...f.bundle(next)].map((byte) => Buffer.from([byte]))),
    f.directory,
  );
  await f.publish(f.manifest("0.13.0"));
  await f.publish(f.manifest("0.14.0"));
  assert.ok(!(await readdir(f.directory)).includes("0.11.0"));
});
test("unconfigured server reports the actual state without contacting GitHub", async (t) => {
  const p = await start(t, {
    token: "",
    publicSource: false,
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

test("a fresh server uses the public Releases source by default", async (t) => {
  const fixture = published();
  const p = await start(t, {
    token: "",
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
});
