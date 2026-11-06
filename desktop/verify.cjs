// Exercises the real Electron window and preload bridge against a disposable server.
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { randomBytes } = require("node:crypto");
const assert = require("node:assert/strict");
process.env.BRAIN_VERIFY = "1";
app.disableHardwareAcceleration();
const errors = [],
  checks = [];
let server;
async function waitFor(test, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
(async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "corporate-brain-electron-"));
  app.setPath("userData", dir);
  server = spawn("node", ["--import", "tsx", "server/qa.ts"], {
    cwd: resolve(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      BRAIN_DSH_ENABLED: "0",
    },
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("QA server startup timed out")),
      15000,
    );
    server.once("message", (message) => {
      clearTimeout(timeout);
      resolve(message.port);
    });
    server.once("exit", (code) =>
      reject(new Error(`QA server exited ${code}`)),
    );
  });
  process.env.BRAIN_APP_URL = `http://127.0.0.1:${port}`;
  require("./main.cjs");
  await app.whenReady();
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, "window");
  const win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(1586, 992);
  const web = win.webContents;
  // Keep offscreen menu transitions and keyboard focus running as in a foreground window.
  web.setBackgroundThrottling(false);
  web.debugger.attach("1.3");
  await web.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
    enabled: true,
  });
  web.on("console-message", (event) => {
    if (
      event.level === "error" &&
      !event.message.includes("Electron Security Warning")
    )
      errors.push(event.message);
  });
  const js = (code) => web.executeJavaScript(code, true);
  const revealed = () =>
    waitFor(
      () =>
        js(`!document.querySelector('.entry-experience[data-phase="ready"]')`),
      "workspace reveal finished",
    );
  const has = (text) =>
    js(`document.body.innerText.includes(${JSON.stringify(text)})`);
  const click = (text) =>
    js(
      `(() => { const item = Array.from(document.querySelectorAll('button,[role="menuitem"]')).find(b => b.textContent.trim() === ${JSON.stringify(text)} || b.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!item) throw new Error('Button missing: ' + ${JSON.stringify(text)}); item.click(); })()`,
    );
  const fill = async (selector, value) => {
    await revealed();
    return js(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Field missing: ' + ${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  };
  const request = (path, body, method = body === undefined ? "GET" : "POST") =>
    js(
      `(async () => { const response = await fetch('/api' + ${JSON.stringify(path)}, {method:${JSON.stringify(method)}, headers: {'Content-Type':'application/json'}, body:${body === undefined ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`}}); const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })()`,
    );
  const shots = resolve(__dirname, "../artifacts/screenshots");
  await fs.mkdir(shots, { recursive: true });
  async function capture(name) {
    await js(`document.querySelector('[aria-label="关闭提示"]')?.click()`);
    await js(`document.fonts.ready.then(() => true)`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await web.capturePage();
    await fs.writeFile(join(shots, name), image.toPNG());
  }
  async function verifyWindowControls(label, exercise = false) {
    await revealed();
    const visible = await js(
      `Array.from(document.querySelectorAll('.window-buttons button')).filter(button => button.getBoundingClientRect().width > 0).map(button => button.getAttribute('aria-label'))`,
    );
    if (process.platform !== "win32") {
      assert.deepEqual(visible, [], `${label}: use native OS controls`);
      return;
    }
    assert.deepEqual(visible, ["最小化", "最大化", "关闭窗口"], label);
    const regions = await js(
      `({bar:getComputedStyle(document.querySelector('.desktop-bar')).webkitAppRegion,button:getComputedStyle(document.querySelector('.window-buttons')).webkitAppRegion})`,
    );
    assert.deepEqual(regions, { bar: "drag", button: "no-drag" });
    if (exercise) {
      await js(
        `document.querySelector('.window-buttons [aria-label="最大化"]').click()`,
      );
      await waitFor(() => win.isMaximized(), `${label}: maximize button`);
      await waitFor(
        () =>
          js(
            `!!document.querySelector('.window-buttons [aria-label="还原窗口"]')`,
          ),
        `${label}: restore label`,
      );
      await js(
        `document.querySelector('.window-buttons [aria-label="还原窗口"]').click()`,
      );
      await waitFor(() => !win.isMaximized(), `${label}: restore button`);
      await js(
        `document.querySelector('.window-buttons [aria-label="最小化"]').click()`,
      );
      await waitFor(() => win.isMinimized(), `${label}: minimize button`);
      win.restore();
      await waitFor(() => !win.isMinimized(), `${label}: return from taskbar`);
      let closeReceived = false;
      const preventClose = (event) => {
        event.preventDefault();
        closeReceived = true;
      };
      win.on("close", preventClose);
      try {
        await js(
          `document.querySelector('.window-buttons [aria-label="关闭窗口"]').click()`,
        );
        await waitFor(() => closeReceived, `${label}: native close event`);
      } finally {
        win.removeListener("close", preventClose);
      }
      win.setContentSize(1586, 992);
    }
  }
  const key = async (keyCode) => {
    const keys = {
      Escape: ["Escape", 27],
      End: ["End", 35],
      Home: ["Home", 36],
      ArrowRight: ["ArrowRight", 39],
      Return: ["Enter", 13],
    };
    const [key, windowsVirtualKeyCode] = keys[keyCode];
    if (!web.debugger.isAttached()) web.debugger.attach("1.3");
    for (const type of ["keyDown", "keyUp"])
      await web.debugger.sendCommand("Input.dispatchKeyEvent", {
        type,
        key,
        code: key,
        windowsVirtualKeyCode,
      });
    await new Promise((resolve) => setTimeout(resolve, 160));
  };
  const openSelect = async (label) => {
    await revealed();
    await waitFor(
      () =>
        js(
          `!document.querySelector('.select-popup[data-open],.select-popup[data-ending-style]')`,
        ),
      "previous select finished closing",
    );
    await js(
      `(() => { const trigger = document.querySelector(${JSON.stringify(`.select-trigger[aria-label="${label}"]`)}); trigger.focus(); trigger.click(); })()`,
    );
    await waitFor(
      () => js(`!!document.querySelector('.select-popup[data-open]')`),
      `open select ${label}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 160));
  };
  const selectOption = async (label, text) => {
    await openSelect(label);
    if (label === "选择模型") {
      const nested = await js(`(() => {const group=[...document.querySelectorAll('[data-model-labels]')].find(el=>JSON.parse(el.dataset.modelLabels).includes(${JSON.stringify(text)}));if(!group)return false;group.click();return true})()`);
      if (nested) await waitFor(() => js(`!!document.querySelector('.model-picker-submenu[data-open]')`), "provider submenu");
    }
    await js(
      `(() => { const option = Array.from(document.querySelectorAll('.select-popup[data-open] [role="option"],.select-popup[data-open] [role="menuitemradio"]')).find(el => el.dataset.modelName === ${JSON.stringify(text)} || el.querySelector('.select-option-label')?.textContent === ${JSON.stringify(text)}); if (!option) throw new Error('Missing option: ' + ${JSON.stringify(text)}); option.click(); })()`,
    );
    await waitFor(
      () =>
        js(
          `!document.querySelector('.select-popup[data-open],.select-popup[data-ending-style]')`,
        ),
      `select ${text}`,
    );
  };
  await waitFor(() => has("建立你的公司大脑"), "setup page");
  await waitFor(
    () =>
      js(
        `document.querySelector('.entry-experience')?.dataset.introDone === 'true'`,
      ),
    "cinematic intro completes without blocking login indefinitely",
  );
  assert.equal(
    await js(
      `!!document.querySelector('brain-entry-scene') && !document.querySelector('.loading-screen')`,
    ),
    true,
  );
  await verifyWindowControls("Before login", true);
  checks.push(
    "Pre-login window controls minimize, maximize, restore and request native close on Windows; macOS keeps native controls",
  );
  assert.equal(
    await js(
      "getComputedStyle(document.querySelector('.auth-card .brand-mark')).backgroundColor.replaceAll(' ', '')",
    ),
    "rgba(0,0,0,0)",
    "Login logo must show the page through its transparent spaces",
  );
  await capture("client-login-window-controls.png");
  await click("隐私与许可");
  await waitFor(() => has("公司大脑隐私说明"), "pre-login privacy policy");
  await click("开源许可");
  assert.ok(await has("MIT License"));
  await capture("client-legal-license.png");
  await key("Escape");
  await fill("input[name=companyName]", "管理部");
  await fill("input[name=name]", "验收管理员");
  await fill("input[name=username]", "qa-admin");
  const password = `QA-${randomBytes(18).toString("hex")}`;
  await fill("input[name=password]", password);
  await click("创建并进入");
  await waitFor(() => has("今天，一起完成些什么"), "initialized workspace");
  await revealed();
  checks.push(
    "Shared cinematic startup, authentication, profile preparation and welcome reveal replace the old loading screen",
  );
  checks.push("First administrator setup and login through UI");
  const workspaceFixture = join(dir, "workspace-fixture");
  await fs.mkdir(join(workspaceFixture, "node_modules"), { recursive: true });
  await fs.writeFile(
    join(workspaceFixture, "README.md"),
    "# Local workspace\nThis file is visible to the read-only workspace scanner.\n",
  );
  await fs.writeFile(
    join(workspaceFixture, "node_modules", "ignored.txt"),
    "ignore",
  );
  const workspaceSnapshot = await js(
    `window.brainDesktop.inspectWorkspace(${JSON.stringify(workspaceFixture)})`,
  );
  assert.equal(workspaceSnapshot.root, "workspace-fixture");
  assert.ok(workspaceSnapshot.files.some((file) => file.name === "README.md"));
  assert.ok(
    !workspaceSnapshot.files.some((file) => file.name.includes("node_modules")),
  );
  checks.push(
    "Desktop workspace scanner reads text files and excludes dependency directories",
  );
  await capture("employee-chat.png");
  await waitFor(
    () =>
      js(
        "!!document.querySelector('.account-area .sidebar-update.has-update[aria-label^=\"有可用更新\"]')",
      ),
    "automatic update discovery in account footer",
  );
  await capture("client-update-sidebar.png");
  await js("document.querySelector('.sidebar-update').click()");
  await waitFor(() => has("让工作空间保持最新"), "update details dialog");
  await capture("client-update-dialog.png");
  assert.ok((await js("window.brainDesktop.updates.state()")).release.version);
  await waitFor(
    () =>
      js(
        "Array.from(document.querySelectorAll('.update-dialog button')).some(button => button.textContent.startsWith('下载更新') && !button.disabled)",
      ),
    "download button enabled after manual refresh",
  );
  await js(
    "Array.from(document.querySelectorAll('.update-dialog button')).find(button => button.textContent.startsWith('下载更新')).click()",
  );
  await waitFor(
    () => has("安装包完整性校验通过"),
    "native download and hash verification",
  );
  const update = await js("window.brainDesktop.updates.state()");
  assert.equal(update.status, "ready");
  const updateFiles = await fs.readdir(join(dir, "updates"));
  assert.equal(updateFiles.length, 1);
  const updateBytes = await fs.readFile(join(dir, "updates", updateFiles[0]));
  assert.equal(
    require("node:crypto")
      .createHash("sha256")
      .update(updateBytes)
      .digest("hex"),
    update.release.asset.sha256,
  );
  await capture("client-update-ready.png");
  assert.equal(
    await js(
      "Array.from(document.querySelectorAll('.update-dialog button')).some(button => button.textContent.trim() === '" +
        (process.platform === "win32" ? "安装" : "打开安装包") +
        "' && !button.disabled)",
    ),
    true,
  );
  assert.equal(
    await js("window.brainDesktop.updates.install().then(()=>false,()=>true)"),
    true,
    "Development QA never executes the inert installer",
  );
  await js(
    "Array.from(document.querySelectorAll('.update-dialog button')).find(button => button.textContent.trim() === '" +
      (process.platform === "win32" ? "安装" : "打开安装包") +
      "').click()",
  );
  await waitFor(
    () => has("开发预览中不运行安装程序"),
    "installation failure keeps the client open and displays a retryable error",
  );
  assert.equal(
    await js(
      "Array.from(document.querySelectorAll('.update-dialog button')).some(button => button.textContent.trim() === '" +
        (process.platform === "win32" ? "安装" : "打开安装包") +
        "' && !button.disabled)",
    ),
    true,
  );
  await key("Escape");
  await waitFor(
    () => js("!document.querySelector('[role=dialog]')"),
    "update dialog dismissed",
  );
  checks.push(
    "Client discovers a fixture release, shows sidebar and details, downloads through authenticated server, verifies SHA-256, and blocks installer execution in development QA",
  );
  if (process.platform === "win32") {
    const cornerRadius = () =>
      js(
        `getComputedStyle(document.getElementById('root')).borderTopLeftRadius`,
      );
    await waitFor(
      () => cornerRadius().then((value) => value === "8px"),
      "normal window corners",
    );
    win.maximize();
    await waitFor(() => win.isMaximized(), "native maximize");
    await waitFor(
      () => cornerRadius().then((value) => value === "0px"),
      "maximized edge treatment",
    );
    win.unmaximize();
    await waitFor(() => !win.isMaximized(), "native restore");
    await waitFor(
      () => cornerRadius().then((value) => value === "8px"),
      "restored corner treatment",
    );
    win.setFullScreen(true);
    await waitFor(() => win.isFullScreen(), "native fullscreen");
    await waitFor(
      () => cornerRadius().then((value) => value === "0px"),
      "fullscreen edge treatment",
    );
    win.setFullScreen(false);
    await waitFor(() => !win.isFullScreen(), "leave native fullscreen");
    await waitFor(
      () => cornerRadius().then((value) => value === "8px"),
      "restored corners after fullscreen",
    );
    win.setContentSize(1586, 992);
    checks.push(
      "Native maximize and fullscreen use straight edges; restored windows recover small corners",
    );
  }
  assert.equal(
    await js(`document.querySelectorAll('.composer-tools select').length`),
    0,
  );
  assert.equal(
    await js(
      `document.querySelectorAll('[aria-label="任务类型"], [aria-label="DSH 模式"]').length`,
    ),
    0,
  );
  assert.equal(
    await js(
      `document.querySelector('.composer-automatic')?.textContent.includes('AI 自动')`,
    ),
    true,
  );
  await openSelect("项目权限");
  assert.equal(
    await js(`document.querySelector('.select-popup[data-open]').dataset.side`),
    "top",
  );
  await capture("composer-automatic.png");
  const composerRegion = await js(
    `(() => { const a = document.querySelector('.composer').getBoundingClientRect(), b = document.querySelector('.select-popup[data-open]').getBoundingClientRect(); const x=Math.max(0,Math.floor(Math.min(a.left,b.left)-20)), y=Math.max(0,Math.floor(Math.min(a.top,b.top)-20)); return {x,y,width:Math.min(innerWidth-x,Math.ceil(Math.max(a.right,b.right)-x+20)),height:Math.min(innerHeight-y,Math.ceil(Math.max(a.bottom,b.bottom)-y+20))}; })()`,
  );
  await fs.writeFile(
    join(shots, "dropdown-composer-detail.png"),
    (await web.capturePage(composerRegion)).toPNG(),
  );
  await key("Escape");
  await waitFor(
    () => js(`!document.querySelector('.select-popup[data-open]')`),
    "escape closes permission select",
  );
  await waitFor(
    () =>
      js(`document.activeElement.getAttribute('aria-label') === '项目权限'`),
    "Escape restores select trigger focus",
  );
  await openSelect("切换项目");
  assert.equal(await has("默认项目"), true);
  await key("Escape");
  await selectOption("项目权限", "仅可查看");
  assert.equal(
    await js(
      `document.querySelector('[aria-label="项目权限"]').textContent.includes('仅可查看')`,
    ),
    true,
  );
  await selectOption("项目权限", "项目内修改");
  checks.push(
    "Unified AI automatic composer removes task/mode selectors while retaining accessible workspace and permission choices",
  );
  await openSelect("选择模型");
  assert.equal(await has("尚未配置可用模型"), true);
  await capture("dropdown-model-empty.png");
  await click("前往模型与服务");
  await waitFor(
    () => has("还没有可用的模型连接"),
    "empty model configuration action",
  );
  await js(`location.hash='chat'`);
  await waitFor(
    () => has("今天，一起完成些什么"),
    "return from model settings",
  );
  checks.push(
    "Empty model picker explains configuration and opens the real model settings",
  );
  const modelFixtures = [];
  for (const [name, kind] of [
    ["验收模型 A（仅测试选项）", "chat"],
    ["验收模型 B（仅测试选项）", "chat"],
    ["验收图片模型（仅测试选项）", "image"],
  ]) {
    modelFixtures.push(
      await request("/connections", {
        name,
        kind,
        model: "qa-selection-only-no-generation",
        baseUrl: "https://qa.invalid/v1",
        apiKey: "qa-placeholder-not-a-secret",
        departments: [],
      }),
    );
  }
  await js(`location.reload()`);
  await waitFor(() => has("验收模型 A（仅测试选项）"), "model fixture choices");
  await selectOption("选择模型", "验收模型 B（仅测试选项）");
  await openSelect("选择模型");
  assert.equal(
    await js(
      `document.querySelectorAll('.select-popup[data-open] [role="menuitemradio"]').length`,
    ),
    2,
  );
  await capture("dropdown-model-configured.png");
  await key("Escape");
  await js(`location.reload()`);
  await waitFor(
    () =>
      js(
        `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('验收模型 B')`,
      ),
    "selected model restored after reload",
  );
  await require("./verify-workspace.cjs")({
    js,
    click,
    fill,
    waitFor,
    request,
    capture,
    checks,
    dir,
    win,
    selectOption,
  });
  // This disposable client receives explicit fixtures, never invented production activity.
  await js(`(() => {
    window.__loadingOriginalFetch = window.fetch;
    window.fetch = (input, options) => {
      if (String(input) === '/api/generate/plan') return Promise.resolve(Response.json({kind:'chat',mode:'standard',seconds:10,connectionId:JSON.parse(options.body).connectionId}));
      if (String(input) !== '/api/generate/chat') return window.__loadingOriginalFetch(input, options);
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        window.__emitProgress = event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event)+'\\n'));
        window.__finishLoadingFixture = (failed = false) => { window.__emitProgress(failed ? {type:'error',message:'隔离验收：模拟请求失败'} : {type:'done',content:'这是隔离验收回复，未调用真实模型。'}); controller.close(); };
        options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted','AbortError')), {once:true});
      }}), {headers:{'Content-Type':'application/x-ndjson'}}));
    };
  })()`);
  await fill('textarea[aria-label="任务输入"]', "加载项验收：等待完成后再回复");
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  await waitFor(
    () =>
      js(
        `document.querySelector('.chat-loading')?.dataset.phase === 'waiting' && !!window.__emitProgress`,
      ),
    "stream starts",
  );
  assert.equal(
    await js(`!!document.querySelector('.chat-loading .grok-ball-host svg')`),
    true,
  );
  assert.equal(
    await js(`document.querySelectorAll('.reasoning-entry').length`),
    0,
  );
  await js(
    `window.__emitProgress({type:'reasoning',id:'r1',text:'【隔离测试内容】先比较平台功能、更新记录与使用成本，再核对公开来源。'}); window.__emitProgress({type:'tool',id:'s1',name:'web_search',status:'done',sources:[{url:'https://example.com/platform',title:'平台功能说明（演示来源）'},{url:'https://example.org/releases',title:'更新记录（演示来源）'}]}); window.__emitProgress({type:'reasoning',id:'r2',text:'【隔离测试内容】已收到两个来源。接下来结合适用场景整理建议，最终回答会显示在过程区下方。'});`,
  );
  await waitFor(
    () => has("找到 2 个来源"),
    "live reasoning and real event fixture sources",
  );
  const openedSources = [];
  const originalOpenExternal = shell.openExternal;
  const previousWindowCount = BrowserWindow.getAllWindows().length;
  shell.openExternal = async (url) => {
    openedSources.push(url);
  };
  try {
    await js(`document.querySelector('.thinking-sources a').click()`);
    await waitFor(
      () => openedSources.length === 1,
      "source reaches system browser",
    );
    assert.equal(openedSources[0], "https://example.com/platform");
    await js(
      `window.open('mailto:fixture@example.com');window.open('https://user:password@example.com/')`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(openedSources.length, 1);
    assert.equal(BrowserWindow.getAllWindows().length, previousWindowCount);
    assert.equal(new URL(web.getURL()).origin, process.env.BRAIN_APP_URL);
  } finally {
    shell.openExternal = originalOpenExternal;
  }
  checks.push(
    "Source links reach the system browser; credential-bearing URLs and non-web protocols are rejected without opening an application window",
  );
  await fill('textarea[aria-label="任务输入"]', "输入草稿触发重绘");
  await waitFor(
    () =>
      js(
        `parseInt(document.querySelector('.chat-loading .thinking-elapsed')?.textContent) >= 2`,
      ),
    "stream survives rerender",
  );
  await capture("client-chat-loading-light.png");
  await js(`document.documentElement.dataset.theme='dark'`);
  await capture("client-chat-loading-dark.png");
  await js(`document.documentElement.dataset.theme='light'`);
  win.setContentSize(900, 760);
  await capture("client-chat-loading-narrow.png");
  assert.equal(
    await js(`document.documentElement.scrollWidth <= innerWidth + 1`),
    true,
  );
  await js(`document.querySelector('.chat-loading .thinking-toggle').click()`);
  assert.equal(
    await js(
      `document.querySelector('.chat-loading .thinking-details').hidden`,
    ),
    true,
  );
  await js(`document.querySelector('.chat-loading .thinking-toggle').click()`);
  await web.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  assert.equal(
    await js(
      `getComputedStyle(document.querySelector('.thinking-title.is-active')).animationName`,
    ),
    "none",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  const staticBall = await js(
    `document.querySelector('.chat-loading .grok-ball-host').innerHTML`,
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(
    await js(
      `document.querySelector('.chat-loading .grok-ball-host').innerHTML`,
    ),
    staticBall,
  );
  await web.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [],
  });
  win.setContentSize(1586, 992);
  await require("./verify-chat-scroll.cjs")({
    web,
    win,
    js,
    waitFor,
    capture,
    checks,
  });
  await click("新建任务");
  await waitFor(
    () =>
      js(
        `!!document.querySelector('.chat-welcome') && !document.querySelector('.chat-loading')`,
      ),
    "no cross-conversation stream",
  );
  await click("加载项验收：等待完成后再回复");
  await waitFor(
    () => js(`!!document.querySelector('.chat-loading')`),
    "return to live stream",
  );
  await waitFor(
    () =>
      js(
        `(() => {const el=document.querySelector('.messages');return el.scrollHeight-el.clientHeight-el.scrollTop <= 2;})()`,
      ),
    "reopened conversation follows its own live reply",
  );
  await js(`window.__emitProgress({type:'text',text:'这是逐段到达的回答。'})`);
  await waitFor(() => has("这是逐段到达的回答。"), "answer streams separately");
  await js(`window.__finishLoadingFixture()`);
  await waitFor(
    () =>
      js(
        `!document.querySelector('.chat-loading') && document.body.innerText.includes('这是隔离验收回复')`,
      ),
    "settled response",
  );
  await waitFor(
    () =>
      js(
        `(() => {const el=document.querySelector('.messages');return el.scrollHeight-el.clientHeight-el.scrollTop <= 2;})()`,
      ),
    "final response remains at the end",
  );
  await require("./verify-feedback.cjs")({
    js,
    click,
    fill,
    waitFor,
    request,
    selectOption,
    capture,
    checks,
  });
  await js(`document.querySelector('.thinking-toggle').click()`);
  assert.equal(await has("找到 2 个来源"), true);
  await fill('textarea[aria-label="任务输入"]', "加载项验收：失败清理");
  // The process now stays compact; create an explicit inert long history block
  // to retain the separate send-after-reading-history regression check.
  await js(
    `(() => { const p=document.createElement('p');p.id='send-history-fixture';p.textContent='隔离验收历史内容。'.repeat(1000);document.querySelector('.messages-content').prepend(p); })()`,
  );
  await waitFor(
    () =>
      js(
        `(() => {const el=document.querySelector('.messages');return el.scrollHeight-el.clientHeight > 150;})()`,
      ),
    "expanded history is scrollable",
  );
  await js(
    `document.querySelector('.messages').scrollTop=document.querySelector('.messages').scrollHeight`,
  );
  await waitFor(
    () =>
      js(
        `(() => {const el=document.querySelector('.messages');return el.scrollHeight-el.clientHeight-el.scrollTop <= 2;})()`,
      ),
    "expanded history has settled before user navigation",
  );
  const historyPoint = await js(
    `(() => {const r=document.querySelector('.messages').getBoundingClientRect();return {x:Math.round(r.left+8),y:Math.round(r.top+r.height/2)};})()`,
  );
  await web.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...historyPoint,
    deltaX: 0,
    deltaY: -350,
  });
  await waitFor(
    () => js(`!!document.querySelector('.chat-jump-latest')`),
    "reading history before sending again",
  );
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  await waitFor(
    () =>
      js(
        `document.querySelector('.chat-loading')?.dataset.phase === 'waiting'`,
      ),
    "second request",
  );
  await waitFor(
    () =>
      js(
        `(() => {const el=document.querySelector('.messages');return el.scrollHeight-el.clientHeight-el.scrollTop <= 2;})()`,
      ),
    "sending a message restores following",
  );
  await js(`document.querySelector('#send-history-fixture').remove()`);
  await js(
    `window.__emitProgress({type:'reasoning',id:'error-r',text:'错误前收到的思考。'});window.__emitProgress({type:'text',text:'错误前收到的部分回答。'});window.__finishLoadingFixture(true)`,
  );
  await waitFor(
    () =>
      js(
        `!document.querySelector('.chat-loading') && !!document.querySelector('.task-error')`,
      ),
    "partial failure",
  );
  assert.equal(await has("错误前收到的部分回答。"), true);
  await fill('textarea[aria-label="任务输入"]', "加载项验收：主动停止");
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  await waitFor(
    () =>
      js(
        `document.querySelector('.chat-loading')?.dataset.phase === 'waiting'`,
      ),
    "third request",
  );
  await js(`window.__emitProgress({type:'text',text:'停止前收到的内容。'})`);
  await waitFor(() => has("停止前收到的内容。"), "partial before stop");
  await click("停止生成");
  await waitFor(
    () =>
      js(
        `!document.querySelector('.chat-loading') && !!document.querySelector('[data-status="stopped"]')`,
      ),
    "cancel stops and persists partial",
  );
  await fill('textarea[aria-label="任务输入"]', "加载项验收：无思考模型");
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  await waitFor(
    () =>
      js(
        `document.querySelector('.chat-loading')?.dataset.phase === 'waiting'`,
      ),
    "no reasoning turn",
  );
  await js(`window.__finishLoadingFixture()`);
  await waitFor(
    () => js(`!document.querySelector('.chat-loading')`),
    "no reasoning complete",
  );
  await js(
    `Array.from(document.querySelectorAll('.thinking-toggle')).at(-1).click()`,
  );
  assert.equal(await has("此轮模型未提供可显示的思考内容。"), true);
  const traceActor = await request("/auth/me");
  await waitFor(async () => {
    const data = await js(
      `window.brainDesktop.readState(${JSON.stringify(traceActor.id)})`,
    );
    return data.conversations.some((c) =>
      c.messages.some((m) => m.trace?.items.some((i) => i.id === "r1")),
    );
  }, "trace persisted locally");
  await js(
    `window.fetch=window.__loadingOriginalFetch; delete window.__loadingOriginalFetch; delete window.__finishLoadingFixture; delete window.__emitProgress;`,
  );
  await js("location.reload()");
  await waitFor(() => has("加载项验收：等待完成后再回复"), "history reload");
  await click("加载项验收：等待完成后再回复");
  await waitFor(
    () => js(`!!document.querySelector('.thinking-toggle')`),
    "trace restored",
  );
  await js(`document.querySelector('.thinking-toggle').click()`);
  assert.equal(await has("找到 2 个来源"), true);
  await click("新建任务");
  await waitFor(
    () =>
      js(
        `!!document.querySelector('.chat-welcome') && !document.querySelector('.task-error,.chat-loading')`,
      ),
    "fresh task clear",
  );
  checks.push(
    "Real streamed reasoning/tool event fixtures, source links, expandable disclosure, separate answer, static reduced-motion Grok-ball, local trace reload, partial error/cancel, no-reasoning fallback and conversation isolation",
  );
  const nativeRename = fs.rename;
  let transientProfileLock = false;
  if (process.platform === "win32") fs.rename = async (from, to) => {
    if (!transientProfileLock && String(from).startsWith(dir) && String(from).endsWith("state.json.tmp")) {
      transientProfileLock = true;
      throw Object.assign(new Error("Synthetic transient profile lock"), { code: "EPERM" });
    }
    return nativeRename(from, to);
  };
  try {
    await require("./verify-image-skills.cjs")({ js, click, fill, waitFor, request, selectOption, key, checks, capture, port });
    if (process.platform === "win32") {
      assert.equal(transientProfileLock, true);
      checks.push("Windows transient profile replacement lock is retried without deleting the old snapshot; subsequent text/image writes and reload complete through the native bridge");
    }
  } finally { fs.rename = nativeRename; }
  for (const fixture of modelFixtures)
    await request(`/connections/${fixture.id}`, {}, "DELETE");
  await js(`location.reload()`);
  await waitFor(
    () => has("未配置模型"),
    "removed fixtures leave unconfigured state",
  );
  checks.push(
    "Conversation model picker persists selection; image connections are reserved for automatic dispatch; QA fixtures never call a real model",
  );
  await fill('textarea[aria-label="任务输入"]', "菜单编辑选区验收");
  const editPoint = await js(
    `(() => { const input = document.querySelector('[aria-label="任务输入"]'); input.focus(); input.setSelectionRange(2, 4); const trigger = Array.from(document.querySelectorAll('.menu-label')).find(el => el.textContent === '编辑'); const r = trigger.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`,
  );
  if (!web.debugger.isAttached()) web.debugger.attach("1.3");
  await web.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...editPoint,
  });
  await web.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    ...editPoint,
  });
  await waitFor(
    () => js(`!!document.querySelector('.action-menu-popup[data-open]')`),
    "edit menu open",
  );
  await capture("dropdown-top-menu.png");
  const editActions = [];
  const trackEdit = (_event, action) => editActions.push(action);
  ipcMain.on("edit:action", trackEdit);
  await click("全选");
  await waitFor(
    () =>
      js(
        `document.activeElement === document.querySelector('[aria-label="任务输入"]')`,
      ),
    "edit menu restores original input focus",
  );
  assert.ok(
    editActions.includes("selectAll"),
    "Edit action reaches the existing native bridge",
  );
  ipcMain.off("edit:action", trackEdit);
  await fill('textarea[aria-label="任务输入"]', "");
  await js(
    `document.querySelector('[aria-label="打开账号菜单"]').focus(); document.querySelector('[aria-label="打开账号菜单"]').click()`,
  );
  await waitFor(
    () => js(`!!document.querySelector('.account-menu-popup[data-open]')`),
    "keyboard account menu",
  );
  await key("Home");
  await key("Return");
  await waitFor(
    () => has("本地记录与备份"),
    "account menu keyboard navigation",
  );
  await js(`location.hash='chat'`);
  await waitFor(
    () => has("今天，一起完成些什么"),
    "return from keyboard menu action",
  );
  checks.push(
    "Top edit menu restores the original input target and invokes its native action; account menu supports keyboard navigation",
  );
  await js(`document.querySelector('[aria-label="打开账号菜单"]').click()`);
  await waitFor(() => has("管理后台"), "account menu");
  await capture("employee-account-menu.png");
  await click("管理后台");
  await waitFor(() => has("添加员工"), "admin users");
  const design = await request("/departments", { name: "设计部" }),
    operations = await request("/departments", { name: "运营部" });
  const employee = await request("/users", {
    username: "qa-employee",
    name: "验收员工",
    departmentId: design.id,
    role: "employee",
  });
  const reviewer = await request("/users", {
    username: "qa-reviewer",
    name: "验收审核员",
    departmentId: design.id,
    role: "department_reviewer",
  });
  await js(`location.hash='admin-users';location.reload()`);
  await waitFor(() => has("验收员工"), "department users refresh");
  await verifyWindowControls("Admin page");
  checks.push(
    "Admin page retains the shared Windows controls without duplicating native macOS controls",
  );
  await capture("admin-users.png");
  await openSelect("筛选部门");
  await capture("dropdown-admin-departments.png");
  await key("Escape");
  await selectOption("筛选部门", "运营部");
  await waitFor(
    () =>
      js(`!document.querySelector('tbody').textContent.includes('验收员工')`),
    "department filter applied",
  );
  await selectOption("筛选部门", "全部获准部门");
  await waitFor(() => has("验收员工"), "department filter reset");
  await click("添加员工");
  await waitFor(() => js(`!!document.querySelector('.modal')`), "account form");
  await selectOption("所属部门", "设计部");
  await selectOption("角色", "部门管理员");
  const formValues = await js(
    `Object.fromEntries(new FormData(document.querySelector('.modal form')))`,
  );
  assert.equal(formValues.departmentId, design.id);
  assert.equal(formValues.role, "department_admin");
  await openSelect("角色");
  await capture("dropdown-admin-role.png");
  await key("Escape");
  assert.equal(
    await js(`!!document.querySelector('.modal')`),
    true,
    "Escape closes only the menu, not the underlying dialog",
  );
  await key("Escape");
  await waitFor(
    () => js(`!document.querySelector('.modal')`),
    "second Escape closes dialog",
  );
  checks.push(
    "Admin dropdown filters and form values work; portalled menus preserve dialog Escape handling",
  );
  await click("部门");
  await waitFor(() => has("设计部"), "department list");
  await capture("admin-departments.png");
  await js(`location.hash='admin-models';location.reload()`);
  await waitFor(() => has("自定义配置"), "admin model connections");
  await click("自定义配置");
  await waitFor(
    () =>
      js(
        `!!document.querySelector('.modal .checkbox-row input[name="departments"]')`,
      ),
    "model authorization form",
  );
  const modelDepartmentRows = await js(
    `Array.from(document.querySelectorAll('.modal .checkbox-row')).map(row => row.textContent.trim())`,
  );
  assert.deepEqual(modelDepartmentRows, ["管理部", "设计部", "运营部"]);
  const modelDepartmentWidths = await js(
    `Array.from(document.querySelectorAll('.modal .checkbox-row input[name="departments"]')).map(input => Math.round(input.getBoundingClientRect().width))`,
  );
  assert.deepEqual(modelDepartmentWidths, [16, 16, 16]);
  await capture("admin-model-connection.png");
  const providers = await js(
    `Array.from(document.querySelectorAll('.provider-option strong')).map(el=>el.textContent)`,
  );
  assert.equal(providers.length, 11);
  assert.equal(providers[0], "LinoRoute推荐");
  for (const name of [
    "DeepSeek",
    "Kimi",
    "千问",
    "腾讯混元",
    "智谱",
    "MiniMax",
    "OpenAI / GPT",
    "Gemini",
    "Claude",
    "自定义服务",
  ])
    assert.ok(providers.includes(name));
  await js(`document.querySelectorAll('.provider-option')[1].click()`);
  assert.equal(
    await js(`document.querySelector('.modal input[name="baseUrl"]').value`),
    "https://api.deepseek.com/v1",
  );
  await js(`document.querySelectorAll('.provider-option')[0].click()`);
  await fill(
    '.modal input[name="baseUrl"]',
    `http://127.0.0.1:${port}/model-service-fixture`,
  );
  await fill('.modal input[name="apiKey"]', "synthetic-model-service-ui-key");
  await click("获取 / 刷新模型");
  await waitFor(() => has("已获取 3 个模型"), "provider model list received");
  await js(
    `Array.from(document.querySelectorAll('.model-catalog-row input')).slice(0,2).forEach(el=>el.click())`,
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.model-catalog-row input:checked').length`,
    ),
    2,
  );
  await capture("model-service-multiple-models.png");
  await click("保存配置");
  await waitFor(
    () =>
      js(
        `!document.querySelector('.modal') && !!document.querySelector('.model-service-list .connection-card')`,
      ),
    "provider multi-model configuration saved",
  );
  const serviceBefore = (await request("/model-services"))[0];
  assert.equal(serviceBefore.models.length, 2);
  const connectionsBefore = (await request("/connections")).filter(
    (c) => c.serviceId === serviceBefore.id,
  );
  assert.equal(connectionsBefore.length, 2);
  assert.ok(connectionsBefore.every((c) => c.hasKey));
  await require("./verify-model-picker.cjs")({js,click,request,waitFor,capture,key,checks,win,service:serviceBefore});
  await click("管理模型");
  await waitFor(
    () => js(`!!document.querySelector('.modal')`),
    "saved provider reopened",
  );
  assert.equal(
    await js(`document.querySelector('.modal input[name="apiKey"]').value`),
    "",
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.model-catalog-row input:checked').length`,
    ),
    2,
  );
  await click("获取 / 刷新模型");
  await waitFor(
    () => has("已获取 3 个模型"),
    "provider refresh reuses saved credential",
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.model-catalog-row input:checked').length`,
    ),
    2,
  );
  await fill('input[aria-label="搜索模型标识"]', "model-b");
  assert.equal(
    await js(`document.querySelectorAll('.model-catalog-row').length`),
    1,
  );
  await js(`document.documentElement.dataset.theme='dark'`);
  win.setContentSize(550, 850);
  await capture("model-service-dark-narrow.png");
  assert.equal(
    await js(`document.documentElement.scrollWidth <= innerWidth`),
    true,
  );
  await js(`document.documentElement.dataset.theme='light'`);
  win.setContentSize(1586, 992);
  await fill('input[aria-label="搜索模型标识"]', "");
  await js(`document.querySelector('.model-catalog-row input').click()`);
  await click("保存配置");
  await waitFor(
    () => js(`!document.querySelector('.modal')`),
    "provider model selection updated",
  );
  const connectionsAfter = await request("/connections");
  assert.equal(
    connectionsAfter.find((c) => c.id === connectionsBefore[0].id).enabled,
    0,
  );
  assert.equal(
    connectionsAfter.find((c) => c.id === connectionsBefore[1].id).enabled,
    1,
  );
  for (const c of connectionsBefore)
    await request(`/connections/${c.id}`, {}, "DELETE");
  await click("自定义配置");
  await key("Escape");
  await waitFor(
    () => js(`!document.querySelector('.modal')`),
    "model connection dialog close",
  );
  checks.push(
    "Company model authorization shows department names and keeps checkboxes at their intended size",
    "Provider presets recommend LinoRoute first; native multi-model discovery, selection, save, retained IDs, key-free refresh, search and dark narrow layout passed using an isolated local upstream; no real model generation",
  );
  await click("查看员工端");
  await waitFor(() => has("今天，一起完成些什么"), "employee workbench");
  await fill('textarea[aria-label="任务输入"]', "只在本机保存的集成验收记录");
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  await waitFor(() => has("尚未配置可用模型"), "unconfigured model state");
  const actor = await request("/auth/me");
  await waitFor(async () => {
    const saved = await js(
      `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
    );
    return saved?.conversations.some((c) =>
      c.messages.some((m) => m.content === "只在本机保存的集成验收记录"),
    );
  }, "message durable on local disk");
  checks.push(
    "Unconfigured generation is explicit; message persisted on the local disk",
  );
  await js("location.reload()");
  await waitFor(
    () => has("只在本机保存的集成验收记录"),
    "history after reload",
  );
  checks.push("Local history restored after reloading");
  const previewFixture = (
    await fs.readFile(
      resolve(__dirname, "../docs/design/approved/employee-chat-preview.png"),
    )
  ).toString("base64");
  const fixtureConversation = {
    id: "preview-fixture",
    title: "预览验收（静态测试素材）",
    createdAt: new Date().toISOString(),
    messages: [
      {
        id: "preview-message",
        role: "assistant",
        content: "静态测试素材，用于验证预览面板；未调用生成模型。",
        image: `data:image/png;base64,${previewFixture}`,
        at: new Date().toISOString(),
      },
    ],
  };
  await js(
    `(async()=>{ const data=await window.brainDesktop.readState(${JSON.stringify(actor.id)}); data.conversations.unshift(${JSON.stringify(fixtureConversation)}); await window.brainDesktop.writeState(${JSON.stringify(actor.id)},data); })()`,
  );
  await js("location.reload()");
  await waitFor(() => has(fixtureConversation.title), "local preview fixture");
  await click(fixtureConversation.title);
  await waitFor(() => has("静态测试素材，用于验证"), "fixture conversation");
  assert.equal(await js(`!!document.querySelector('.preview')`), false);
  await js(`document.querySelector('.generated-image').click()`);
  await waitFor(
    () => js(`!!document.querySelector('.preview')`),
    "preview open",
  );
  await js(
    `document.querySelector('[aria-label="调整预览宽度"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`,
  );
  assert.equal(
    await js(
      `document.querySelector('[aria-label="调整预览宽度"]').getAttribute('aria-valuenow')`,
    ),
    "44",
  );
  await js(`document.querySelector('[aria-label="关闭预览"]').click()`);
  assert.equal(await js(`!!document.querySelector('.preview')`), false);
  checks.push(
    "Conversation preview defaults closed, opens from an image, resizes with keyboard and closes",
  );
  await js(`document.querySelector('[aria-label="打开账号菜单"]').click()`);
  await click("技能中心").catch(async () => {
    await js(`document.querySelector('[aria-label="打开账号菜单"]').click()`);
    await click("技能中心");
  });
  await waitFor(() => has("创建技能"), "skills page");
  await click("创建技能");
  await waitFor(() => has("制作成技能"), "skill editor");
  const setField = async (label, value) => {
    const selector = await js(
      `(() => { const labels = Array.from(document.querySelectorAll('.modal .field')); const label = labels.find(l => l.querySelector('span')?.textContent === ${JSON.stringify(label)}); const input = label?.querySelector('input,textarea'); if (!input) throw new Error('Missing label'); input.id='qa-field'; return '#qa-field'; })()`,
    );
    await fill(selector, value);
    await js(`document.querySelector('#qa-field').removeAttribute('id')`);
  };
  await setField("技能名称", "团队文案流程");
  await setField("适用场景与说明", "用于验证部门共享技能的完整流程");
  await setField(
    "可复用流程（Markdown，可编辑）",
    "先确认任务目标和输入，再整理出三个步骤，最后检查结果是否符合用户要求。",
  );
  await click("下一步");
  await setField(
    "测试摘要（说明真实测试输入、结果与局限）",
    "集成测试样例，验证提交与审核流程，未调用付费模型。",
  );
  await click("下一步");
  await selectOption("发布范围", "全公司");
  await click("提交审核");
  await waitFor(() => has("技能包已提交审核"), "skill submitted");
  checks.push(
    "UI source selection, local draft and package preview submit workflow",
  );
  await js(`document.querySelector('[aria-label="打开账号菜单"]').click()`);
  await click("管理后台");
  await click("技能发布");
  await waitFor(() => has("团队文案流程"), "review queue");
  await js(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('查看与审核')).click()`,
  );
  await fill("#review-note", "集成验收：检查提交内容和公司范围后批准。");
  await capture("admin-skill-review.png");
  await click("批准并发布");
  await waitFor(() => has("已按批准范围发布"), "approved");
  checks.push("Company-scope review through the real UI");
  await click("查看员工端");
  await click("技能中心");
  await click("全公司");
  await waitFor(() => has("团队文案流程"), "published skill");
  await click("安装");
  await waitFor(() => has("技能已安装到当前设备"), "installed");
  checks.push("Published package downloaded and installed locally");
  await require("./verify-skills.cjs")({
    js,
    click,
    fill,
    waitFor,
    request,
    key,
    win,
    capture,
    checks,
    revealed,
    selectOption,
  });
  // Real UI and API, with synthetic SMB results from the disposable QA server.
  await js(`location.hash='admin-knowledge'`);
  await waitFor(() => has("添加资料源"), "NAS administration");
  await click("添加资料源");
  await fill('input[name="name"]', "部门资料验收");
  await fill('input[name="host"]', "192.168.1.10");
  await fill('input[name="share"]', "资料验收");
  await fill('input[name="username"]', "fixture-reader");
  await fill('input[name="password"]', "Synthetic-NAS-Fixture");
  await js(
    `(()=>{const label=[...document.querySelectorAll('.knowledge-departments label')].find(e=>e.textContent.includes(${JSON.stringify(actor.departmentName)}));if(!label)throw Error('Department checkbox missing');label.querySelector('input').click();document.querySelector('input[name=enabled]').click()})()`,
  );
  await click("保存");
  await waitFor(
    () =>
      js(
        `!document.querySelector('.modal') && !!document.querySelector('.knowledge-admin-table')`,
      ),
    "NAS source saved",
  );
  await click("检查连接");
  await waitFor(() => has("连接正常"), "NAS connection checked");
  await capture("nas-admin-synthetic.png");
  await js(`location.hash='knowledge'`);
  await waitFor(() => has("部门资料验收"), "authorized NAS source");
  await js(`document.querySelector('.knowledge-source').click()`);
  await waitFor(() => has("项目手册"), "NAS directory listing");
  assert.equal(
    await js(
      `[...document.querySelectorAll('.knowledge-entry')].find(e=>e.textContent.includes('受限链接')).disabled`,
    ),
    true,
  );
  await click("项目手册");
  await waitFor(() => has("使用说明.txt"), "NAS child directory");
  await click("使用说明.txt");
  await waitFor(() => has("文件信息"), "NAS metadata dialog");
  assert.ok(await has("尚未开放内容预览"));
  await click("关闭");
  await click("上一级");
  await waitFor(() => has("部门说明.txt"), "NAS parent navigation");
  await fill('input[aria-label="搜索当前目录的名称"]', "部门说明");
  await js(`document.querySelector('.knowledge-search').requestSubmit()`);
  await waitFor(
    () => js(`document.querySelectorAll('.knowledge-entry').length===1`),
    "NAS current-directory search",
  );
  await capture("nas-browser-synthetic.png");
  await js(`location.hash='settings'`);
  await waitFor(() => has("本地记录与备份"), "NAS preview theme settings");
  await selectOption("外观", "深色");
  await js(`location.hash='knowledge'`);
  await waitFor(() => has("部门资料验收"), "NAS source in dark theme");
  await js(`document.querySelector('.knowledge-source').click()`);
  await waitFor(() => has("项目手册"), "dark NAS directory");
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  win.setContentSize(900, 720);
  await capture("nas-browser-dark-narrow.png");
  assert.equal(
    await js(`document.documentElement.scrollWidth>innerWidth`),
    false,
  );
  win.setContentSize(1586, 992);
  await js(`location.hash='settings'`);
  await waitFor(() => has("本地记录与备份"), "restore NAS preview theme");
  await selectOption("外观", "浅色");
  checks.push(
    "NAS admin creates an encrypted source with explicit department scope; employee browsing supports breadcrumbs, nested directories, metadata, name search and blocked links in light/dark narrow layouts; no NAS file content or model call",
  );
  await js(`location.hash='skills'`);
  await waitFor(() => has("导入技能"), "return to skills after NAS checks");
  await require("./verify-skill-import.cjs")({
    js,
    click,
    fill,
    waitFor,
    request,
    capture,
    checks,
    win,
    selectOption,
  });
  await js(`document.querySelector('[aria-label="设置"]').click()`);
  await waitFor(() => has("本地记录与备份"), "settings");
  await capture("employee-settings.png");
  await selectOption("外观", "深色");
  await openSelect("外观");
  await capture("dropdown-theme-dark.png");
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  await key("Escape");
  await selectOption("外观", "浅色");
  await selectOption("外观", "默认（浅色）");
  assert.equal(await js(`document.documentElement.dataset.theme`), "light");
  await waitFor(
    () =>
      js(
        `window.brainDesktop.readAppearance().then(theme => theme === 'default')`,
      ),
    "default startup appearance saved",
  );
  checks.push(
    "Default/light/dark appearance selection saves native startup preference; default remains light",
  );
  checks.push(
    "Theme dropdown updates local preferences and renders readable dark menu states",
  );
  assert.equal(await js(`document.documentElement.dataset.skin`), "claude");
  await click("选择皮肤");
  await waitFor(
    () => js(`document.querySelectorAll('.skin-card').length === 62`),
    "complete skin catalog",
  );
  await capture("skin-center-claude.png");
  win.setContentSize(900, 760);
  await capture("skin-center-narrow.png");
  assert.equal(
    await js(
      `document.documentElement.scrollWidth <= innerWidth && document.querySelector('.skin-center').scrollWidth <= document.querySelector('.skin-center').clientWidth`,
    ),
    true,
  );
  win.setContentSize(1586, 992);
  await fill('input[aria-label="搜索皮肤"]', "mint");
  assert.equal(await js(`document.querySelectorAll('.skin-card').length`), 1);
  await js(`document.querySelector('[data-skin-id="mint"]').click()`);
  await waitFor(() => has("全窗预览"), "skin detail");
  await click("全窗预览");
  await waitFor(
    () => js(`document.documentElement.dataset.skin === 'mint'`),
    "live skin preview",
  );
  assert.equal(
    (await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`))
      .settings.skin,
    "claude",
  );
  await click("取消预览");
  assert.equal(await js(`document.documentElement.dataset.skin`), "claude");
  await js(`document.querySelector('[data-skin-id="mint"]').click()`);
  await click("全窗预览");
  await key("Escape");
  await waitFor(
    () => js(`document.documentElement.dataset.skin === 'claude'`),
    "Escape cancels preview",
  );
  await fill('input[aria-label="搜索皮肤"]', "云轨");
  await js(`document.querySelector('[data-skin-id="future-window"]').click()`);
  await js(
    `document.querySelector('[role="dialog"] .skin-mode-switch button:last-child').click()`,
  );
  await click("全窗预览");
  await click("新建任务");
  await waitFor(
    () => js(`!!document.querySelector('.chat-welcome')`),
    "preview chat",
  );
  await capture("skin-future-window-dark.png");
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  await click("保存皮肤");
  await waitFor(
    async () =>
      (await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`))
        .settings.skin === "future-window",
    "skin written to native profile",
  );
  await js("location.reload()");
  await waitFor(
    () =>
      js(
        `document.documentElement.dataset.skin === 'future-window' && document.documentElement.dataset.theme === 'dark'`,
      ),
    "skin survives reload",
  );
  await js(`location.hash = 'skins'`);
  await waitFor(
    () => js(`document.querySelectorAll('.skin-card').length === 62`),
    "skin catalog after reload",
  );
  await click("恢复默认 Claude");
  await waitFor(
    () => js(`document.documentElement.dataset.skin === 'claude'`),
    "reset default skin",
  );
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  // Leave a distinct saved preference to verify the next employee gets their own default.
  await fill('input[aria-label="搜索皮肤"]', "mint");
  await js(`document.querySelector('[data-skin-id="mint"]').click()`);
  await click("使用这款");
  await click("返回设置");
  await waitFor(() => has("本地记录与备份"), "return from skin center");
  await selectOption("外观", "浅色");
  checks.push(
    "62 skins: search, live preview without persistence, cancel, artwork, dark mode, native save/reload, restore Claude default",
  );
  if (!web.debugger.isAttached()) web.debugger.attach("1.3");
  await web.debugger.sendCommand("DOM.enable");
  await web.debugger.sendCommand("CSS.enable");
  const fontDocument = await web.debugger.sendCommand("DOM.getDocument");
  const fontNode = await web.debugger.sendCommand("DOM.querySelector", {
    nodeId: fontDocument.root.nodeId,
    selector: ".settings-content",
  });
  const actualFonts = await web.debugger.sendCommand(
    "CSS.getPlatformFontsForNode",
    { nodeId: fontNode.nodeId },
  );
  await fs.writeFile(
    resolve(__dirname, "../artifacts/ui-fonts.json"),
    JSON.stringify(actualFonts, null, 2),
  );
  web.debugger.detach();
  await request("/model-services",{provider:"linoroute",name:"员工模型库验收",baseUrl:`http://127.0.0.1:${port}/image-skill-fixture`,apiKey:"synthetic-image-skill-ui-key",departments:[],models:[{model:"qa-text",kind:"chat"}]});
  await js(`document.querySelector('[aria-label="打开账号菜单"]').click()`);
  await click("退出登录");
  await waitFor(() => has("登录公司账号"), "logout");
  await verifyWindowControls("Logged-out login page");
  assert.equal(
    await js(`document.documentElement.scrollHeight <= innerHeight`),
    true,
    "Login title bar must fit without extra document scrolling",
  );
  await capture("client-login-window-controls.png");
  // Pause bootstrap so the loading UI can be inspected, then simulate an
  // unreadable server reply. The controls must survive both early returns.
  if (!web.debugger.isAttached()) web.debugger.attach("1.3");
  let pausedRequest;
  const interceptBootstrap = (_event, method, params) => {
    if (method === "Fetch.requestPaused") pausedRequest = params.requestId;
  };
  web.debugger.on("message", interceptBootstrap);
  await web.debugger.sendCommand("Fetch.enable", {
    patterns: [{ urlPattern: "*/api/bootstrap", requestStage: "Request" }],
  });
  web.reload();
  await waitFor(() => !!pausedRequest, "paused bootstrap request");
  await waitFor(
    () => has("正在连接公司工作空间"),
    "loading before authentication",
  );
  assert.equal(
    await js(`document.querySelector('.entry-experience')?.dataset.phase`),
    "connecting",
  );
  assert.equal(await js(`!!document.querySelector('.loading-screen')`), false);
  await verifyWindowControls("Connecting page");
  await web.debugger.sendCommand("Fetch.fulfillRequest", {
    requestId: pausedRequest,
    responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from("unreadable QA response").toString("base64"),
  });
  await web.debugger.sendCommand("Fetch.disable");
  web.debugger.removeListener("message", interceptBootstrap);
  await waitFor(() => has("暂时无法连接公司服务器"), "connection failure page");
  await verifyWindowControls("Connection failure page");
  await click("重新连接");
  await waitFor(() => has("登录公司账号"), "login after retry");
  await verifyWindowControls("Retried login page");
  checks.push(
    "Window controls persist after logout, during connection, after a failed response and after retry",
  );
  await fill("input[name=username]", employee.user.username);
  await fill("input[name=password]", employee.initialPassword);
  await click("登录");
  await waitFor(
    () => has("首次登录，请修改初始密码"),
    "forced password change",
  );
  const newPassword = `Employee-${randomBytes(16).toString("hex")}`;
  await fill("input[name=current]", employee.initialPassword);
  await fill("input[name=password]", newPassword);
  await click("保存并重新登录");
  await waitFor(() => has("登录公司账号"), "relogin after password change");
  await fill("input[name=username]", employee.user.username);
  await fill("input[name=password]", newPassword);
  await click("登录");
  await waitFor(() => has("今天，一起完成些什么"), "second employee");
  assert.equal(await js(`document.documentElement.dataset.skin`), "claude");
  checks.push(
    "Skin preferences are isolated per employee; new employee receives Claude default",
  );
  await click("选择技能");
  await waitFor(
    () => js(`!!document.querySelector('.skill-picker[data-open]')`),
    "new employee skills",
  );
  assert.equal(
    await js(`document.querySelectorAll('.skill-picker-item').length`),
    0,
    "another account's installed skills are not carried over",
  );
  assert.equal(
    await js(
      `document.querySelector('.skill-picker-auto').getAttribute('aria-checked')`,
    ),
    "true",
    "new employee uses automatic default",
  );
  await key("Escape");
  checks.push(
    "Skill installations and manual selection are isolated per employee; new account starts with empty installations and automatic mode",
  );
  assert.equal(await has("只在本机保存的集成验收记录"), false);
  assert.equal(
    (
      await js(
        `window.brainDesktop.readState(${JSON.stringify(employee.user.id)})`,
      )
    ).conversations.length,
    0,
  );
  const blocked = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)}).then(()=>false,()=>true)`,
  );
  assert.equal(blocked, true);
  checks.push(
    "First login change; second employee isolated; IPC rejects another employee profile",
  );
  await click("技能中心");
  await click("全公司");
  await waitFor(() => has("团队文案流程"), "second employee package");
  await click("安装");
  await waitFor(() => has("技能已安装到当前设备"), "second employee installed");
  checks.push(
    "Another employee installs the shared Skill without author history",
  );
  await require("./verify-personal-models.cjs")({js,click,fill,waitFor,request,selectOption,key,capture,checks,win});
  await require("./verify-chat-appearance.cjs")({js,click,waitFor,request,selectOption,capture,checks,win});
  for (const [page, label] of [
    ["projects", "项目"],
    ["knowledge", "公司知识"],
    ["settings", "个人设置"],
    ["models", "模型与服务"],
  ]) {
    await js(`location.hash=${JSON.stringify(page)}`);
    await waitFor(() => has(label), `page ${page}`);
    assert.equal(await js(`!!document.querySelector('.preview')`), false);
  }
  checks.push("Non-conversation screens do not open the far-right preview");
  win.setContentSize(900, 720);
  await js(`location.hash='chat'`);
  await waitFor(() => has("今天，一起完成些什么"), "narrow chat");
  await capture("employee-chat-narrow.png");
  assert.equal(
    await js(`document.documentElement.scrollWidth > innerWidth`),
    false,
  );
  checks.push("900px desktop viewport has no document overflow");
  await openSelect("项目权限");
  const bounds = await js(
    `(() => { const menu = document.querySelector('.select-popup[data-open]'); const r = menu.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; })()`,
  );
  assert.ok(
    bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right <= bounds.width &&
      bounds.bottom <= bounds.height,
    JSON.stringify(bounds),
  );
  await capture("dropdown-narrow.png");
  await key("Escape");
  checks.push(
    "Dropdown collision positioning stays inside a 900px desktop viewport",
  );
  await js("window.brainDesktop.changeServer()");
  await waitFor(
    () => BrowserWindow.getAllWindows().length === 2,
    "server setup window",
  );
  const setupWindow = BrowserWindow.getAllWindows().find(
    (window) => window !== win,
  );
  await waitFor(
    () =>
      setupWindow.webContents.executeJavaScript(
        '!!document.querySelector("#server-url")',
      ),
    "server setup form",
  );
  await setupWindow.webContents.executeJavaScript(
    "document.fonts.ready.then(() => true)",
  );
  await fs.writeFile(
    join(shots, "desktop-server-setup.png"),
    (await setupWindow.webContents.capturePage()).toPNG(),
  );
  const rejected = await setupWindow.webContents.executeJavaScript(
    `window.companyConnection.connect('http://untrusted.example.com')`,
  );
  assert.ok(rejected.error);
  await setupWindow.webContents.executeJavaScript(
    "window.companyConnection.showLegal()",
  );
  const legalWindow = BrowserWindow.getAllWindows().find((window) =>
    window.webContents.getURL().endsWith("/legal.html"),
  );
  assert.ok(legalWindow);
  await legalWindow.webContents.executeJavaScript(
    "document.fonts.ready.then(() => true)",
  );
  await legalWindow.webContents.executeJavaScript(
    "document.querySelectorAll('details')[1].open = true",
  );
  assert.equal(
    await legalWindow.webContents.executeJavaScript(
      "document.body.innerText.includes('MIT License') && document.body.innerText.includes('公司大脑隐私说明') && typeof window.require === 'undefined'",
    ),
    true,
  );
  await fs.writeFile(
    join(shots, "client-offline-legal.png"),
    (await legalWindow.webContents.capturePage()).toPNG(),
  );
  legalWindow.close();
  checks.push(
    "Online pre-login and offline company-connection windows expose original license and privacy policy with isolated local legal viewer",
  );
  const connected = await setupWindow.webContents.executeJavaScript(
    `window.companyConnection.connect(${JSON.stringify(process.env.BRAIN_APP_URL)})`,
  );
  assert.equal(connected.ok, true);
  await waitFor(() => win.isDestroyed(), "old company window replaced");
  checks.push(
    "Native company server setup rejects insecure remote HTTP and connects to the verified company API",
  );
  assert.deepEqual(errors, []);
  const report = {
    result: "passed",
    runtime: "Electron real window + real preload bridge",
    productionModelsCalled: false,
    database: "disposable in-memory",
    checks,
    consoleErrors: errors,
    screenshots: shots,
  };
  await fs.mkdir(resolve(__dirname, "../artifacts"), { recursive: true });
  await fs.writeFile(
    resolve(__dirname, "../artifacts/desktop-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  server.kill();
  app.exit(0);
})().catch(async (error) => {
  console.error(error.stack);
  const currentWindow = BrowserWindow.getAllWindows()[0];
  if (currentWindow) {
    console.error(
      await currentWindow.webContents
        .executeJavaScript(
          `JSON.stringify({ focus: document.activeElement?.outerHTML.slice(0,300), visibility: document.visibilityState, popups: Array.from(document.querySelectorAll('[data-overlay-popup]')).map(el=>({html:el.outerHTML.slice(0,600),opacity:getComputedStyle(el).opacity,animations:el.getAnimations().map(a=>({state:a.playState,time:a.currentTime}))})) })`,
        )
        .catch(() => "no diagnostic page"),
    );
  }
  if (server) server.kill();
  try {
    await fs.mkdir(resolve(__dirname, "../artifacts"), { recursive: true });
    await fs.writeFile(
      resolve(__dirname, "../artifacts/desktop-verification.json"),
      JSON.stringify(
        {
          result: "failed",
          checks,
          error: error.message,
          consoleErrors: errors,
        },
        null,
        2,
      ),
    );
  } catch {}
  app.exit(1);
});
