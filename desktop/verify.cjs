// Exercises the real Electron window and preload bridge against a disposable server.
const { app, BrowserWindow } = require("electron");
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
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
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
  web.on("console-message", (event) => {
    if (
      event.level === "error" &&
      !event.message.includes("Electron Security Warning")
    )
      errors.push(event.message);
  });
  const js = (code) => web.executeJavaScript(code, true);
  const has = (text) =>
    js(`document.body.innerText.includes(${JSON.stringify(text)})`);
  const click = (text) =>
    js(
      `(() => { const item = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!item) throw new Error('Button missing: ' + ${JSON.stringify(text)}); item.click(); })()`,
    );
  const fill = (selector, value) =>
    js(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Field missing: ' + ${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
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
  await waitFor(() => has("建立你的公司大脑"), "setup page");
  await fill("input[name=companyName]", "管理部");
  await fill("input[name=name]", "验收管理员");
  await fill("input[name=username]", "qa-admin");
  const password = `QA-${randomBytes(18).toString("hex")}`;
  await fill("input[name=password]", password);
  await click("创建并进入");
  await waitFor(() => has("今天，一起完成些什么"), "initialized workspace");
  checks.push("First administrator setup and login through UI");
  await capture("employee-chat.png");
  if (process.platform === "win32") {
    const cornerRadius = () =>
      js(`getComputedStyle(document.getElementById('root')).borderTopLeftRadius`);
    await waitFor(() => cornerRadius().then(value => value === "8px"), "normal window corners");
    win.maximize();
    await waitFor(() => win.isMaximized(), "native maximize");
    await waitFor(() => cornerRadius().then(value => value === "0px"), "maximized edge treatment");
    win.unmaximize();
    await waitFor(() => !win.isMaximized(), "native restore");
    await waitFor(() => cornerRadius().then(value => value === "8px"), "restored corner treatment");
    win.setFullScreen(true);
    await waitFor(() => win.isFullScreen(), "native fullscreen");
    await waitFor(() => cornerRadius().then(value => value === "0px"), "fullscreen edge treatment");
    win.setFullScreen(false);
    await waitFor(() => !win.isFullScreen(), "leave native fullscreen");
    await waitFor(() => cornerRadius().then(value => value === "8px"), "restored corners after fullscreen");
    win.setContentSize(1586, 992);
    checks.push("Native maximize and fullscreen use straight edges; restored windows recover small corners");
  }
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
  await capture("admin-users.png");
  await click("部门");
  await waitFor(() => has("设计部"), "department list");
  await capture("admin-departments.png");
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
  await js(
    `(() => {const el=document.querySelector('.modal select'); el.value='company';el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
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
  await js(`document.querySelector('[aria-label="设置"]').click()`);
  await waitFor(() => has("本地记录与备份"), "settings");
  await capture("employee-settings.png");
  web.debugger.attach('1.3');
  await web.debugger.sendCommand('DOM.enable'); await web.debugger.sendCommand('CSS.enable');
  const fontDocument = await web.debugger.sendCommand('DOM.getDocument');
  const fontNode = await web.debugger.sendCommand('DOM.querySelector',{nodeId:fontDocument.root.nodeId,selector:'.settings-content'});
  const actualFonts = await web.debugger.sendCommand('CSS.getPlatformFontsForNode',{nodeId:fontNode.nodeId});
  await fs.writeFile(resolve(__dirname,'../artifacts/ui-fonts.json'),JSON.stringify(actualFonts,null,2));
  web.debugger.detach();
  await js(`document.querySelector('[aria-label="打开账号菜单"]').click()`);
  await click("退出登录");
  await waitFor(() => has("欢迎回来"), "logout");
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
  await waitFor(() => has("欢迎回来"), "relogin after password change");
  await fill("input[name=username]", employee.user.username);
  await fill("input[name=password]", newPassword);
  await click("登录");
  await waitFor(() => has("今天，一起完成些什么"), "second employee");
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
    'document.fonts.ready.then(() => true)',
  );
  await fs.writeFile(
    join(shots, "desktop-server-setup.png"),
    (await setupWindow.webContents.capturePage()).toPNG(),
  );
  const rejected = await setupWindow.webContents.executeJavaScript(
    `window.companyConnection.connect('http://untrusted.example.com')`,
  );
  assert.ok(rejected.error);
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
