// Real Electron overlays, stalled resources, retry IPC and isolated preferences.
const { app, BrowserWindow, nativeTheme } = require("electron");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { mkdtemp, mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const {
  loadCompanyWindow,
  startupState,
  connectionFailure,
} = require("./startup.cjs");
const { readAppearance } = require("./appearance.cjs");
process.env.BRAIN_VERIFY = "1";
app.disableHardwareAcceleration();
let server;
const checks = [];
async function waitFor(check, label) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((done) => setTimeout(done, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
(async () => {
  app.setPath("userData", await mkdtemp(join(tmpdir(), "brain-startup-")));
  let mode = "pending",
    failures = 0,
    stalledImage = false;
  const pending = new Set();
  const reply = (res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><title>Startup verification</title><div id="root"><p>Company page ready</p></div><img src="/slow-image">',
    );
  };
  server = createServer((req, res) => {
    if (req.url === "/slow-image") {
      stalledImage = true;
      return;
    }
    if (mode === "failure" && failures++ === 0) {
      res.writeHead(503);
      res.end("Unavailable");
    } else if (mode !== "pending") reply(res);
    else {
      pending.add(res);
      res.once("close", () => pending.delete(res));
    }
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = `http://127.0.0.1:${server.address().port}`;
  process.env.BRAIN_APP_URL = address;
  nativeTheme.themeSource = "dark";
  require("./main.cjs");
  app.removeAllListeners("window-all-closed");
  await app.whenReady();
  await waitFor(
    async () => BrowserWindow.getAllWindows().length > 0,
    "main window",
  );
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.setBackgroundThrottling(false);
  const overlay = () =>
    win.contentView.children.find((view) =>
      view.webContents?.getURL().includes("startup.html"),
    )?.webContents;
  const evalOverlay = (code) => overlay().executeJavaScript(code);
  await waitFor(
    async () =>
      (await evalOverlay("document.body.innerText")).includes(
        "正在打开公司大脑",
      ),
    "local animation while server pending",
  );
  assert.equal(
    await evalOverlay("document.documentElement.dataset.theme"),
    "light",
  );
  assert.equal(await evalOverlay("typeof window.brainDesktop"), "undefined");
  await waitFor(
    () =>
      evalOverlay(
        "Array.from(document.querySelectorAll('.entry-logo')).length === 2 && Array.from(document.querySelectorAll('.entry-logo')).every(img => img.complete && img.naturalWidth === 512)",
      ),
    "bundled company logo loads offline under startup CSP",
  );
  assert.equal(
    await evalOverlay(
      "getComputedStyle(document.querySelector('.entry-logo-wrap')).backgroundColor.replaceAll(' ', '')",
    ),
    "rgba(0,0,0,0)",
    "Startup logo must not have a white plate",
  );
  checks.push(
    "Warm startup remains responsive offline; default ignores dark OS; minimal isolated preload",
  );
  const shots = resolve("artifacts/screenshots");
  await mkdir(shots, { recursive: true });
  async function capture(name) {
    for (let attempt = 0; attempt < 3; attempt++) {
      win.showInactive();
      await new Promise((done) => setTimeout(done, 350));
      try {
        const picture = await overlay().capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        });
        assert.equal(picture.isEmpty(), false);
        await writeFile(join(shots, name), picture.toPNG());
        return;
      } catch (error) {
        if (error.message !== "UnknownVizError" || attempt === 2) throw error;
      }
    }
  }
  await new Promise((done) => setTimeout(done, 3700));
  await capture("client-startup.png");
  await evalOverlay("document.getElementById('skip').click()");
  await waitFor(
    async () => startupState(win)?.skipped,
    "skip acknowledged without exposing empty page",
  );
  mode = "ready";
  for (const res of pending) reply(res);
  await waitFor(
    async () => !startupState(win),
    "rendered company UI revealed before resource load finishes",
  );
  assert.equal(stalledImage, true);
  assert.equal(
    win.webContents.isLoading(),
    true,
    "slow image must still be pending",
  );
  // stop only the deliberately hung subresource before executeJavaScript calls.
  win.webContents.stop();
  checks.push(
    "Painted app reveals while a subresource is still pending; skip never exposes a blank navigation",
  );
  assert.equal(
    await win.webContents.executeJavaScript(
      "window.brainDesktop.retryStartup().then(()=>false,()=>true)",
    ),
    true,
  );
  checks.push("Remote renderer is rejected by startup-only retry IPC");

  mode = "pending";
  await loadCompanyWindow(win, address, { timeoutMs: 300, maxAttempts: 1 });
  await waitFor(
    async () =>
      (await evalOverlay("document.body.innerText")).includes("ERR_TIMED_OUT"),
    "classified timeout",
  );
  await capture("client-startup-retry.png");
  mode = "ready";
  await evalOverlay("document.getElementById('retry').click()");
  await waitFor(
    async () => !startupState(win),
    "manual retry through native IPC",
  );
  win.webContents.stop();
  checks.push(
    "Timeout leaves actionable local screen and real retry button reconnects",
  );

  mode = "failure";
  await loadCompanyWindow(win, address, { timeoutMs: 2000, retryDelayMs: 40 });
  assert.equal(failures, 2);
  await waitFor(
    async () => !startupState(win),
    "automatic retry after HTTP 503",
  );
  win.webContents.stop();
  checks.push("Transient HTTP 503 automatically retries and recovers");

  await win.webContents.executeJavaScript(
    "window.brainDesktop.writeAppearance('dark')",
  );
  assert.equal(readAppearance(address), "dark");
  assert.equal(readAppearance("https://another-company.invalid"), "default");
  assert.equal(
    await win.webContents.executeJavaScript(
      "window.brainDesktop.writeAppearance('system').then(()=>false,()=>true)",
    ),
    true,
  );
  await win.webContents.executeJavaScript(
    "window.brainDesktop.previewStartup()",
  );
  assert.equal(
    await evalOverlay("document.documentElement.dataset.theme"),
    "dark",
  );
  await new Promise((done) => setTimeout(done, 3700));
  await capture("client-startup-dark.png");
  await evalOverlay("document.getElementById('skip').click()");
  await waitFor(
    async () => !startupState(win),
    "skip preview returns to existing page",
  );
  await loadCompanyWindow(win, address, { timeoutMs: 2000 });
  await waitFor(
    async () => !startupState(win),
    "subsequent launch with persisted theme",
  );
  win.webContents.stop();
  checks.push(
    "Explicit dark persists per company; invalid preferences rejected; preview closes without navigation",
  );
  await win.webContents.executeJavaScript(
    "window.brainDesktop.writeAppearance('default')",
  );
  await win.webContents.executeJavaScript(
    "window.brainDesktop.previewStartup()",
  );
  assert.equal(
    await evalOverlay("document.documentElement.dataset.theme"),
    "light",
  );
  overlay().debugger.attach("1.3");
  await overlay().debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  assert.equal(
    await evalOverlay(
      "getComputedStyle(document.querySelector('.orbit-one')).animationName",
    ),
    "none",
  );
  overlay().debugger.detach();
  await evalOverlay("document.getElementById('skip').click()");
  await waitFor(async () => !startupState(win), "preview cleanup");
  checks.push(
    "Default restores warm appearance; reduced-motion disables rotation",
  );

  mode = "pending";
  const obsolete = loadCompanyWindow(win, address, {
    timeoutMs: 1000,
    maxAttempts: 1,
  });
  await waitFor(
    async () => !!overlay() && startupState(win)?.phase === "connecting",
    "obsolete load started",
  );
  mode = "ready";
  await loadCompanyWindow(win, address, { timeoutMs: 2000 });
  await obsolete;
  await waitFor(async () => !startupState(win), "latest navigation wins");
  win.webContents.stop();
  checks.push(
    "Superseded attempts cannot replace a successful newer navigation",
  );
  assert.equal(
    connectionFailure(new Error("net::ERR_CERT_DATE_INVALID")).retry,
    false,
  );
  assert.equal(
    connectionFailure(new Error("ERR_NAME_NOT_RESOLVED")).code,
    "ERR_NAME_NOT_RESOLVED",
  );
  mode = "pending";
  const closing = loadCompanyWindow(win, address, { timeoutMs: 1000 });
  await waitFor(
    async () => startupState(win)?.phase === "connecting",
    "close while pending",
  );
  const local = overlay();
  win.destroy();
  await closing;
  await waitFor(async () => local.isDestroyed(), "overlay destruction");
  checks.push(
    "Certificate failures never bypass TLS; closing cancels attempts and destroys overlay",
  );
  const report = { result: "passed", checks, productionModelsCalled: false };
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
  .finally(() => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    server?.closeAllConnections();
    server?.close();
    app.exit(process.exitCode || 0);
  });
