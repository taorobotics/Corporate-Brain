// Exercises the real Electron window and preload bridge against a disposable server.
const { app, BrowserWindow, ipcMain } = require("electron");
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
  const has = (text) =>
    js(`document.body.innerText.includes(${JSON.stringify(text)})`);
  const click = (text) =>
    js(
      `(() => { const item = Array.from(document.querySelectorAll('button,[role="menuitem"]')).find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!item) throw new Error('Button missing: ' + ${JSON.stringify(text)}); item.click(); })()`,
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
  const key = async (keyCode) => {
    const keys = {
      Escape: ["Escape", 27],
      End: ["End", 35],
      Home: ["Home", 36],
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
    await js(
      `(() => { const option = Array.from(document.querySelectorAll('.select-popup[data-open] [role="option"]')).find(el => el.querySelector('.select-option-label')?.textContent === ${JSON.stringify(text)}); if (!option) throw new Error('Missing option: ' + ${JSON.stringify(text)}); option.click(); })()`,
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
  checks.push("First administrator setup and login through UI");
  const workspaceFixture = join(dir, "workspace-fixture");
  await fs.mkdir(join(workspaceFixture, "node_modules"), { recursive: true });
  await fs.writeFile(
    join(workspaceFixture, "README.md"),
    "# Local workspace\nThis file is visible to the read-only workspace scanner.\n",
  );
  await fs.writeFile(join(workspaceFixture, "node_modules", "ignored.txt"), "ignore");
  const workspaceSnapshot = await js(
    `window.brainDesktop.inspectWorkspace(${JSON.stringify(workspaceFixture)})`,
  );
  assert.equal(workspaceSnapshot.root, "workspace-fixture");
  assert.ok(workspaceSnapshot.files.some((file) => file.name === "README.md"));
  assert.ok(!workspaceSnapshot.files.some((file) => file.name.includes("node_modules")));
  checks.push("Desktop workspace scanner reads text files and excludes dependency directories");
  await capture("employee-chat.png");
  await waitFor(() => has("有可用更新"), "automatic update discovery");
  await capture("client-update-sidebar.png");
  await js("document.querySelector('.sidebar-update').click()");
  await waitFor(() => has("让工作空间保持最新"), "update details dialog");
  await capture("client-update-dialog.png");
  assert.ok((await js("window.brainDesktop.updates.state()")).release.version);
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
    await js("window.brainDesktop.updates.install().then(()=>false,()=>true)"),
    true,
    "Development QA never executes the inert installer",
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
  await openSelect("任务类型");
  assert.equal(
    await js(`document.querySelector('.select-popup[data-open]').dataset.side`),
    "top",
  );
  await capture("dropdown-task-type.png");
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
    "escape closes task select",
  );
  await waitFor(
    () =>
      js(`document.activeElement.getAttribute('aria-label') === '任务类型'`),
    "Escape restores select trigger focus",
  );
  await selectOption("任务类型", "图片");
  assert.equal(
    await js(
      `document.querySelector('[aria-label="任务类型"]').textContent.includes('图片')`,
    ),
    true,
  );
  await selectOption("任务类型", "对话");
  await openSelect("DSH 模式");
  await key("End");
  await key("Return");
  await waitFor(
    () =>
      js(
        `document.querySelector('[aria-label="DSH 模式"]').textContent.includes('创造模式')`,
      ),
    "keyboard selects last mode",
  );
  await selectOption("DSH 模式", "标准模式");
  await openSelect("工作区");
  assert.equal(await has("默认工作区"), true);
  await key("Escape");
  await selectOption("工作区权限", "仅可查看");
  assert.equal(
    await js(
      `document.querySelector('[aria-label="工作区权限"]').textContent.includes('仅可查看')`,
    ),
    true,
  );
  await selectOption("工作区权限", "工作区内修改");
  checks.push(
    "Custom composer selects workspaces, DSH modes and permission levels with keyboard and pointer",
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
      `document.querySelectorAll('.select-popup[data-open] [role="option"]').length`,
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
  await selectOption("任务类型", "图片");
  await openSelect("选择模型");
  assert.equal(
    await js(
      `document.querySelectorAll('.select-popup[data-open] [role="option"]').length`,
    ),
    1,
  );
  await key("Escape");
  await selectOption("任务类型", "对话");
  for (const fixture of modelFixtures)
    await request(`/connections/${fixture.id}`, {}, "DELETE");
  await js(`location.reload()`);
  await waitFor(
    () => has("未配置模型"),
    "removed fixtures leave unconfigured state",
  );
  checks.push(
    "Configured model picker filters by task kind and persists selection; QA fixtures never call a model",
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
  await waitFor(() => has("添加模型连接"), "admin model connections");
  await click("添加模型连接");
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
  await key("Escape");
  await waitFor(
    () => js(`!document.querySelector('.modal')`),
    "model connection dialog close",
  );
  checks.push(
    "Company model authorization shows department names and keeps checkboxes at their intended size",
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
  await js(`document.querySelector('[aria-label="设置"]').click()`);
  await waitFor(() => has("本地记录与备份"), "settings");
  await capture("employee-settings.png");
  await selectOption("外观", "深色");
  await openSelect("外观");
  await capture("dropdown-theme-dark.png");
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  await key("Escape");
  await selectOption("外观", "浅色");
  checks.push(
    "Theme dropdown updates local preferences and renders readable dark menu states",
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
  await js(`document.querySelector('[aria-label="打开账号菜单"]').click()`);
  await click("退出登录");
  await waitFor(() => has("登录公司账号"), "logout");
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
  await openSelect("DSH 模式");
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
  await legalWindow.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
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
