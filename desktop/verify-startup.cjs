// Real local startup navigation and IPC boundaries; no employee profile/model calls.
const { app, BrowserWindow } = require("electron");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { mkdtemp, mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const { loadCompanyWindow } = require("./startup.cjs");
process.env.BRAIN_VERIFY = "1";
app.disableHardwareAcceleration();
let server, directory;
async function waitFor(check, label) {
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((done) => setTimeout(done, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
(async () => {
  directory = await mkdtemp(join(tmpdir(), "brain-startup-"));
  app.setPath("userData", directory);
  let respond = false;
  const pending = new Set();
  const reply = (res) =>
    res.end(
      "<!doctype html><title>Startup verification</title><p>Company page ready</p>",
    );
  server = createServer((_req, res) => {
    if (respond) reply(res);
    else {
      pending.add(res);
      res.once("close", () => pending.delete(res));
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = `http://127.0.0.1:${server.address().port}`;
  process.env.BRAIN_APP_URL = address;
  require("./main.cjs");
  await app.whenReady();
  await waitFor(
    async () => BrowserWindow.getAllWindows().length > 0,
    "main window",
  );
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  const text = () =>
    win.webContents.executeJavaScript("document.body.innerText");
  await waitFor(
    async () => (await text()).includes("正在打开公司大脑"),
    "local startup while server is pending",
  );
  const shots = resolve("artifacts/screenshots");
  await mkdir(shots, { recursive: true });
  async function capture(name) {
    await win.webContents.executeJavaScript(
      "document.fonts.ready.then(() => true)",
    );
    await new Promise((done) => setTimeout(done, 250));
    await writeFile(
      join(shots, name),
      (await win.webContents.capturePage()).toPNG(),
    );
  }
  await capture("client-startup.png");
  respond = true;
  for (const res of pending) reply(res);
  await waitFor(
    async () => (await text()).includes("Company page ready"),
    "company content replaces startup",
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "window.brainDesktop.retryStartup().then(()=>false,()=>true)",
    ),
    true,
    "remote content must not access local retry IPC",
  );
  respond = false;
  await loadCompanyWindow(win, address, { timeoutMs: 250 });
  await waitFor(
    async () => (await text()).includes("暂时无法连接公司服务器"),
    "timeout fallback",
  );
  await capture("client-startup-retry.png");
  respond = true;
  await win.webContents.executeJavaScript(
    "document.getElementById('retry').click()",
  );
  await waitFor(
    async () => (await text()).includes("Company page ready"),
    "real retry button reconnects",
  );
  const report = {
    result: "passed",
    checks: [
      "Local startup page is visible while network response is pending",
      "Successful navigation replaces startup without a fixed delay",
      "Remote renderer cannot invoke startup-only IPC",
      "Timed-out navigation restores local recovery screen",
      "Recovery button reconnects through real preload IPC",
    ],
    productionModelsCalled: false,
  };
  await writeFile(
    "artifacts/startup-verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    server?.closeAllConnections();
    server?.close();
    // Electron may still hold its disposable profile until process exit.
    app.exit(process.exitCode || 0);
  });
