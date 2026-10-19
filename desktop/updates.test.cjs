const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { DesktopUpdates, newer } = require("./updates.cjs");

test("update versions compare numerically and never offer a downgrade", () => {
  assert.equal(newer("0.10.0", "0.9.9"), true);
  assert.equal(newer("1.0.0", "0.99.99"), true);
  for (const value of [
    "0.1.1",
    "0.1.0",
    "v1.0.0",
    "1.0.0-rc.1",
    "../2.0.0",
    "01.0.0",
  ])
    assert.equal(newer(value, "0.1.1"), false);
});
async function fixture(t, platform = "win32", arch = "x64") {
  const directory = await mkdtemp(join(tmpdir(), "brain-update-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payload = Buffer.from(
    "Inert updater verification fixture; never execute.",
  );
  const target = `${platform}-${arch}`;
  const asset = {
    name:
      target === "win32-x64"
        ? "Corporate-Brain-Setup-0.2.0-x64.exe"
        : `Corporate-Brain-0.2.0-macOS-${arch}.dmg`,
    bytes: payload.length,
    sha256: createHash("sha256").update(payload).digest("hex"),
  };
  const feed = {
    configured: true,
    release: {
      version: "0.2.0",
      notes: "Verification",
      publishedAt: "2026-10-19T00:00:00Z",
      assets: { [target]: asset },
    },
  };
  const events = [],
    requests = [];
  let binary = () => new Response(payload);
  const updater = new DesktopUpdates({
    version: "0.1.1",
    platform,
    arch,
    directory,
    notify: (state) => events.push(state),
    request: async (path, init) => {
      requests.push(path);
      return path.endsWith("/latest") ? Response.json(feed) : binary(init);
    },
  });
  return {
    updater,
    feed,
    asset,
    payload,
    events,
    requests,
    directory,
    setBinary: (value) => {
      binary = value;
    },
  };
}
test("Windows and both Mac targets download, hash-check and restore verified cached packages", async (t) => {
  for (const [platform, arch] of [
    ["win32", "x64"],
    ["darwin", "arm64"],
    ["darwin", "x64"],
  ]) {
    const f = await fixture(t, platform, arch);
    const obsolete = `0000000000000000-${f.asset.name.replace("0.2.0", "0.1.1")}`;
    await writeFile(join(f.directory, obsolete), "obsolete installer");
    await writeFile(join(f.directory, "unrelated.txt"), "preserve");
    assert.equal((await f.updater.check()).status, "available");
    assert.equal((await f.updater.download()).status, "ready");
    const file = await f.updater.verify();
    assert.deepEqual(await readFile(file), f.payload);
    assert.equal((await readdir(f.directory)).includes(obsolete), false);
    assert.equal(
      await readFile(join(f.directory, "unrelated.txt"), "utf8"),
      "preserve",
    );
    assert.ok(
      f.requests.includes(`/api/desktop-updates/0.2.0/${platform}-${arch}`),
    );
    assert.equal((await f.updater.check()).status, "ready");
    await writeFile(file, Buffer.alloc(f.payload.length, 1));
    await assert.rejects(f.updater.verify(), /校验失败/);
    assert.equal((await f.updater.check()).status, "available");
  }
});
test("tampering, truncated downloads, HTTP failures and unsafe asset names never become installable", async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  for (const response of [
    () => new Response(Buffer.alloc(f.payload.length)),
    () => new Response("short"),
    () => new Response("failure", { status: 401 }),
  ]) {
    f.setBinary(response);
    assert.equal((await f.updater.download()).status, "error");
    await assert.rejects(f.updater.verify());
    assert.deepEqual(await readdir(f.directory), []);
  }
  f.asset.name = "../../untrusted.exe";
  assert.equal((await f.updater.check()).status, "error");
  f.feed.release.version = "0.1.0";
  assert.equal((await f.updater.check()).status, "current");
  assert.equal(f.updater.state.release, null);
});
test("cancelled downloads remove partial files and allow retry without duplicate requests", async (t) => {
  const f = await fixture(t);
  await f.updater.check();
  let started;
  const beginning = new Promise((resolve) => {
    started = resolve;
  });
  f.setBinary(
    ({ signal }) =>
      new Response(
        new ReadableStream({
          start(controller) {
            started();
            controller.enqueue(f.payload.subarray(0, 4));
            signal.addEventListener(
              "abort",
              () => controller.error(new Error("cancelled")),
              { once: true },
            );
          },
        }),
      ),
  );
  const downloading = f.updater.download();
  await beginning;
  await f.updater.cancel();
  await downloading;
  assert.equal(f.updater.state.status, "available");
  assert.deepEqual(await readdir(f.directory), []);
  f.setBinary(() => new Response(f.payload));
  await Promise.all([f.updater.download(), f.updater.download()]);
  assert.equal(f.updater.state.status, "ready");
  assert.equal(f.requests.filter((path) => !path.endsWith("latest")).length, 2);
});
