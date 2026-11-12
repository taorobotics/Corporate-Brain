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
  requests = [],
  layouts = [];
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
  // Test motion independently from the runner's accessibility defaults.
  await web.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
    enabled: true,
  });
  await web.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
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
  // The native connection view starts its own first navigation asynchronously.
  // Audit a fresh document only after that navigation has reached login and
  // released its overlay, otherwise two loadURL calls can abort each other.
  await loginReady();
  await waitFor(
    () => !win.contentView.children.some(view =>
      view.webContents?.getURL().includes("startup.html")),
    "initial native navigation has revealed login",
  );
  await web.debugger.sendCommand("Page.enable");
  await web.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__entryAudit={oldScene:false,inertForm:false,firstForm:0};
      new MutationObserver(()=>{
        const audit=window.__entryAudit;
        audit.oldScene ||= !!document.querySelector('brain-entry-scene,.entry-scene-host,.entry-skip');
        audit.inertForm ||= !!document.querySelector('.entry-form-stage[inert]');
        if(!audit.firstForm && document.querySelector('.login-submit'))audit.firstForm=performance.now();
      }).observe(document,{subtree:true,childList:true,attributes:true});`,
  });
  await web.loadURL(origin);
  await loginReady();
  const entry = await js(`({...window.__entryAudit,authEnd:performance.getEntriesByType('resource').find(r=>r.name.endsWith('/api/auth/me'))?.responseEnd})`);
  assert.equal(entry.oldScene, false);
  assert.equal(entry.inertForm, false);
  assert.ok(entry.firstForm > 0);
  assert.ok(entry.authEnd > 0 && entry.firstForm - entry.authEnd < 2500,
    "Login mounts promptly after authentication without the 3.6 second intro");
  checks.push("Cold logged-out navigation never mounts the old intro, skip button or inert form and exposes login immediately after account check");
  win.setMinimumSize(320, 400);
  async function checkLayout(width, height, zoom = 1, fits = true) {
    web.setZoomFactor(zoom);
    win.setContentSize(width, height);
    await delay(250);
    const layout = await js(`(()=>{
      const stage=document.querySelector('.entry-form-stage');
      stage.scrollTop=0;
      const controls=['input[name=username]','input[name=password]','.login-submit','.auth-legal','.theme-toggle'].map(s=>{
        const r=document.querySelector(s).getBoundingClientRect();
        return {selector:s,left:r.left,top:r.top,right:r.right,bottom:r.bottom};
      });
      return {width:innerWidth,height:innerHeight,scrollHeight:stage.scrollHeight,clientHeight:stage.clientHeight,
        scrollWidth:stage.scrollWidth,clientWidth:stage.clientWidth,scrollbar:getComputedStyle(stage).scrollbarWidth,controls};
    })()`);
    layouts.push({window:[width,height],zoom,...layout});
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, JSON.stringify(layout));
    assert.equal(layout.scrollbar, "none");
    if (fits) {
      assert.ok(layout.scrollHeight <= layout.clientHeight + 1, "Login genuinely fits viewport: " + JSON.stringify(layout));
      for (const control of layout.controls)
        assert.ok(control.left >= 0 && control.top >= 0 && control.right <= layout.width + 1 && control.bottom <= layout.height + 1,
          "Visible login control: " + JSON.stringify(control));
    } else {
      await js(`document.querySelector('.auth-legal').focus()`);
      const reachable = await js(`(()=>{const r=document.querySelector('.auth-legal').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()`);
      assert.equal(reachable, true, "Very small windows can still reach the footer by keyboard and scrolling");
    }
  }
  for (const [width,height,zoom] of [
    [1762,965,1],[1468,804,1],[1366,768,1],[1280,720,1],[1024,640,1],
    [1440,900,1.25],[1440,900,1.5],[1152,547,1],[960,456,1],[390,844,1],[390,667,1],
  ]) await checkLayout(width,height,zoom);
  await checkLayout(390,480,1.5,false);
  await checkLayout(1440,900);
  await capture("login-production-fit.png");
  checks.push("Desktop, narrow and 125%/150% layouts genuinely fit without page scrolling or clipped controls; extreme zoom retains keyboard/scroll access without scrollbar chrome");
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
    await waitFor(
      async () => (await state()).frames > first.frames,
      "actual 3D frames advance",
    );
    await js(
      `document.querySelector('.login-artwork-host').dispatchEvent(new PointerEvent('pointermove',{clientX:500,clientY:350}))`,
    );
    await waitFor(async () => {
      const pointer = (await state()).pointer;
      return Math.abs(pointer.x) + Math.abs(pointer.y) > 0.01;
    }, "pointer changes actual scene pose");
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
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    await web.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
      enabled: false,
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
    await web.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
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
  await checkLayout(1280,720);
  win.setMinimumSize(360, 500);
  win.setContentSize(390, 844);
  await waitFor(() => js(`innerWidth<=390`), "native narrow resize has reached the renderer");
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
    layouts,
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
