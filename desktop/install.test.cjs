const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtemp, writeFile, readdir, rm } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { installWindowsUpdate } = require("./install.cjs");

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "brain-install-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [], child = new EventEmitter();
  child.unref = () => calls.push("unref");
  const options = {
    directory,
    save: async () => calls.push("save"),
    verify: async () => { calls.push("verify"); return join(directory, "verified.exe"); },
    spawn: (file, args, settings) => {
      calls.push({ file, args, settings });
      // Stand in for the installer's ready signal; never execute a binary.
      setTimeout(async () => {
        const token = args[1].split("=")[1];
        await writeFile(join(directory, token + ".ready"), "ready");
      }, 5);
      return child;
    },
    quit: () => calls.push("quit"),
    timeout: 80,
    interval: 2,
  };
  return { options, directory, calls, child };
}

test("automatic update saves, verifies, waits for installer readiness, then quits", async (t) => {
  const f = await fixture(t);
  await installWindowsUpdate(f.options);
  assert.deepEqual(f.calls.slice(0, 2), ["save", "verify"]);
  const launch = f.calls[2];
  assert.equal(launch.file, join(f.directory, "verified.exe"));
  assert.equal(launch.args[0], "/S");
  assert.match(launch.args[1], /^--brain-update=[a-f0-9]{32}$/);
  assert.deepEqual(launch.settings, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  assert.deepEqual(f.calls.slice(3), ["unref", "quit"]);
  assert.deepEqual(await readdir(f.directory), [launch.args[1].split("=")[1] + ".proceed"]);
});

for (const stage of ["save", "verify"]) test(`${stage} failure never launches or quits`, async (t) => {
  const f = await fixture(t);
  f.options[stage] = async () => { throw new Error(stage); };
  await assert.rejects(installWindowsUpdate(f.options), new RegExp(stage));
  assert.ok(!f.calls.includes("quit"));
  assert.ok(!f.calls.some(value => typeof value === "object"));
});

for (const failure of ["error", "exit", "timeout"]) test(`installer ${failure} keeps the running client open`, async (t) => {
  const f = await fixture(t);
  f.options.spawn = () => {
    if (failure === "error") setTimeout(() => f.child.emit("error", new Error("blocked")), 2);
    if (failure === "exit") setTimeout(() => f.child.emit("exit", 2, null), 2);
    return f.child;
  };
  await assert.rejects(installWindowsUpdate(f.options), /安装程序/);
  assert.ok(!f.calls.includes("quit"));
  assert.equal(f.child.listenerCount("error"), 0);
  assert.equal(f.child.listenerCount("exit"), 0);
});

test("a stale ready signal cannot authorize a different installation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "0".repeat(32) + ".ready"), "ready");
  f.options.spawn = () => f.child;
  await assert.rejects(installWindowsUpdate(f.options), /安装程序/);
  assert.ok(!f.calls.includes("quit"));
});
