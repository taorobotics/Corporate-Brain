// Real production login UI against an isolated, disposable company server.
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const { resolve, join } = require("node:path");
const { tmpdir } = require("node:os");
const { randomBytes } = require("node:crypto");
const assert = require("node:assert/strict");
process.env.BRAIN_VERIFY = "1";
let server, win;
const checks = [],
  errors = [],
  requests = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(test, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await delay(100);
  }
  throw Error("Timed out: " + label);
}
(async () => {
  const directory = await fs.mkdtemp(join(tmpdir(), "brain-auth-artwork-"));
  app.setPath("userData", directory);
  app.setPath("sessionData", directory);
  server = spawn("node", ["--import", "tsx", "server/qa.ts"], {
    cwd: resolve(__dirname, ".."),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      BRAIN_DSH_ENABLED: "0",
    },
  });
  const port = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error("QA server timeout")), 15000);
    server.once("message", (message) => {
      clearTimeout(timer);
      done(message.port);
    });
    server.once("exit", (code) => reject(Error("QA server exited " + code)));
  });
  const origin = `http://127.0.0.1:${port}`;
  const password = "QA-" + randomBytes(18).toString("hex");
  const response = await fetch(origin + "/api/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      companyName: "隔离验收部门",
      name: "界面验收",
      username: "artwork-qa",
      password,
    }),
  });
  assert.equal(response.ok, true, "Disposable company initialization");
  process.env.BRAIN_APP_URL = origin;
  require("./main.cjs");
  await app.whenReady();
  await waitFor(
    () => BrowserWindow.getAllWindows().length,
    "real desktop window",
  );
  win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(1440, 960);
  win.showInactive();
  const web = win.webContents;
  web.setBackgroundThrottling(false);
  web.debugger.attach("1.3");
  web.on("console-message", (event) => {
    if (
      event.level === "error" &&
      !event.message.includes("Electron Security Warning")
    )
      errors.push(event.message);
  });
  web.session.webRequest.onBeforeRequest((details, callback) => {
    requests.push(details.url);
    callback({});
  });
  const js = (code) => web.executeJavaScript(code, true);
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) =>
    js(
      `(() => {const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  const state = () =>
    js(
      `document.querySelector('.login-artwork-host')?.__brainArtwork?.getState()`,
    );
  const loginReady = () =>
    waitFor(
      () =>
        js(
          `!!document.querySelector('.entry-experience[data-intro-done="true"] .login-surface input[name=username]')`,
        ),
      "production login",
    );
  const screenshots = resolve(__dirname, "../artifacts/screenshots");
  await fs.mkdir(screenshots, { recursive: true });
  const capture = async (name) => {
    await delay(200);
    const pixels = await web.capturePage();
    assert.equal(pixels.isEmpty(), false);
    await fs.writeFile(join(screenshots, name), pixels.toPNG());
  };
  await loginReady();
  await waitFor(
    async () => ["webgl", "fallback"].includes((await state())?.mode),
    "artwork capability",
  );
  const capability = (await state()).mode;
  if (process.env.BRAIN_REQUIRE_AUTH_WEBGL === "1")
    assert.equal(capability, "webgl");
  assert.equal(
    await js(
      `document.querySelector('.brand-visual img,.brand-visual text')===null`,
    ),
    true,
  );
  assert.equal(
    await js(`document.querySelector('input[name=username]').value`),
    "",
  );
  assert.equal(
    await js(`document.querySelector('input[name=password]').value`),
    "",
  );
  assert.equal(
    await js(`document.querySelectorAll('input[name=companyName]').length`),
    0,
  );
  assert.equal(
    await js(
      `document.querySelector('.brand-visual').innerText.includes('演示')`,
    ),
    false,
  );
  checks.push(
    "Approved production artwork contains no logo, lettering or demo account; initialized company exposes login only",
  );
  if (capability === "webgl") {
    const first = await state();
    await delay(700);
    assert.ok(
      (await state()).frames > first.frames,
      "Actual 3D frames advance",
    );
    await js(
      `document.querySelector('.login-artwork-host').dispatchEvent(new PointerEvent('pointermove',{clientX:500,clientY:350}))`,
    );
    await delay(500);
    const pointer = (await state()).pointer;
    assert.ok(
      Math.abs(pointer.x) + Math.abs(pointer.y) > 0.01,
      "Pointer changes actual scene pose",
    );
    await click(".motion-toggle");
    await delay(250);
    const paused = await state();
    await delay(500);
    assert.equal(
      (await state()).frames,
      paused.frames,
      "Paused artwork schedules no frames",
    );
    await click(".motion-toggle");
    await web.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    await delay(250);
    const reduced = await state();
    await delay(500);
    assert.equal((await state()).frames, reduced.frames);
    assert.equal(
      await js(`document.querySelector('.motion-toggle').disabled`),
      true,
    );
    await web.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [],
    });
    web.setBackgroundThrottling(true);
    win.hide();
    await delay(250);
    const hidden = await state();
    await delay(500);
    assert.equal(
      (await state()).frames,
      hidden.frames,
      "Hidden window does not animate",
    );
    win.showInactive();
    web.setBackgroundThrottling(false);
    checks.push(
      "Real WebGL frames, pointer follow, manual pause, system reduced motion and hidden-window pause verified",
    );
  } else
    checks.push(
      "Device reports no WebGL: production SVG fallback and disabled motion control verified; 3D not asserted",
    );
  await capture("login-production-light.png");
  await click(".theme-toggle");
  await waitFor(
    () =>
      js(
        `document.querySelector('.login-surface').classList.contains('dsu-dark')`,
      ),
    "dark theme",
  );
  await capture("login-production-dark.png");
  await click(".theme-toggle");
  await fill("input[name=username]", "artwork-qa");
  await fill("input[name=password]", "incorrect-disposable-password");
  await click('[aria-label="显示密码"]');
  assert.equal(
    await js(`document.querySelector('input[name=password]').type`),
    "text",
  );
  await click('[aria-label="隐藏密码"]');
  await click(".forgot-password");
  await waitFor(
    () => js(`!!document.querySelector('[role=dialog]')`),
    "administrator reset help",
  );
  await js(
    `Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent.trim()==='知道了').click()`,
  );
  await click(".login-submit");
  await waitFor(
    () => js(`!!document.querySelector('.login-error[role=alert]')`),
    "real API rejection",
  );
  assert.equal(
    await js(`document.querySelector('.login-submit').disabled`),
    false,
  );
  checks.push(
    "Real API rejects incorrect password without entering workspace; visibility toggle and administrator reset guidance work",
  );
  win.setMinimumSize(360, 500);
  win.setContentSize(390, 844);
  await delay(350);
  assert.equal(
    await js(
      `document.querySelector('.login-surface').scrollWidth<=innerWidth`,
    ),
    true,
    "Narrow form has no horizontal overflow",
  );
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector('.brand-visual')).display`,
    ),
    "none",
  );
  const bounds = await js(
    `(()=>{const r=document.querySelector('.login-submit').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`,
  );
  assert.ok(
    bounds.left >= 0 &&
      bounds.right <= 390 &&
      bounds.top > 0 &&
      bounds.bottom <= 844,
  );
  await capture("login-production-narrow.png");
  checks.push(
    "Light/dark themes and 390px layout keep the real form accessible without horizontal scroll",
  );
  win.setContentSize(1440, 960);
  await js(
    `void(window.__qaArtwork=document.querySelector('.login-artwork-host').__brainArtwork)`,
  );
  await fill("input[name=password]", password);
  await click(".login-submit");
  await waitFor(
    () => js(`!!document.querySelector('.chat.is-empty [data-chat-headline]')`),
    "real account login",
  );
  assert.equal(await js(`window.__qaArtwork.getState().disposed`), true);
  checks.push(
    "Real company account signs in and the artwork releases its rendering resources on unmount",
  );
  await js(
    `fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>{if(!r.ok)throw Error('Logout failed')})`,
  );
  await web.loadURL(origin);
  await loginReady();
  await waitFor(
    async () => ["webgl", "fallback"].includes((await state())?.mode),
    "logout artwork",
  );
  if ((await state()).mode === "webgl")
    await js(
      `void document.querySelector('.planet-canvas').dispatchEvent(new Event('webglcontextlost',{cancelable:true}))`,
    );
  await waitFor(
    async () => (await state())?.mode === "fallback",
    "lost or unavailable GPU fallback",
  );
  assert.equal(
    await js(`document.querySelector('.motion-toggle').disabled`),
    true,
  );
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector('.planet-fallback')).display!=='none'`,
    ),
    true,
  );
  checks.push(
    "Lost or unavailable WebGL falls back to original static planet and still exposes login",
  );
  const external = requests.filter(
    (url) => /^https?:/.test(url) && new URL(url).origin !== origin,
  );
  assert.deepEqual(
    external,
    [],
    "No external artwork assets, telemetry or scene service requests",
  );
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    version: require("../package.json").version,
    runtime: "Real Electron + production bundle + disposable company API",
    capability,
    checks,
    consoleErrors: errors,
    externalRequests: external,
  };
  await fs.writeFile(
    resolve(__dirname, "../artifacts/auth-artwork-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  server.kill();
  app.exit(0);
})().catch(async (error) => {
  console.error(error.stack);
  try {
    if (win && !win.isDestroyed())
      await fs.writeFile(
        resolve(__dirname, "../artifacts/login-production-failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
  } catch {}
  if (server) server.kill();
  app.exit(1);
});
