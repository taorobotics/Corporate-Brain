const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { join } = require("node:path");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { dialog } = require("electron");

// Real native scan -> renderer -> authenticated HTTP API -> synthetic model.
// No renderer fetch replacement and no access to company models or employee files.
module.exports = async ({
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
}) => {
  const folder = join(
    dir,
    "示例研发项目-资料与视频制作-项目文件夹-用于长路径显示验收",
  );
  await fs.mkdir(folder);
  await fs.writeFile(
    join(folder, "README.md"),
    "LARGE-FOLDER-UI-FIXTURE: isolated sample project",
  );
  await fs.writeFile(
    join(folder, "package-lock.json"),
    "LOCK-FIXTURE ".repeat(100000),
  );
  await fs.writeFile(
    join(folder, "generated.ts"),
    "GENERATED-FIXTURE ".repeat(70000),
  );
  const requests = [];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: body.stream
                ? "大目录读取验收成功，已收到说明文档和有范围标记的节选。"
                : JSON.stringify({
                    kind: "chat",
                    mode: "standard",
                    seconds: 10,
                    skillIds: [],
                  }),
            },
          },
        ],
      }),
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  let connection;
  const actor = await request("/auth/me");
  const saved = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
  );
  const originalDialog = dialog.showOpenDialog;
  const size = win.getContentSize();
  const minimumSize = win.getMinimumSize();
  const restoreFolder = async () => {
    await js(
      `(async()=>{const state=await window.brainDesktop.readState(${JSON.stringify(actor.id)});state.workspaces=${JSON.stringify(saved.workspaces)};state.activeWorkspaceId=${JSON.stringify(saved.activeWorkspaceId)};state.settings.model=${JSON.stringify(saved.settings.model)};await window.brainDesktop.writeState(${JSON.stringify(actor.id)},state)})()`,
    );
  };
  try {
    connection = await request("/connections", {
      name: "目录长度验收（合成模型）",
      kind: "chat",
      model: "qa-large-workspace",
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      apiKey: "qa-placeholder-not-a-secret",
      departments: [],
    });
    const native = await js(
      `window.brainDesktop.inspectWorkspace(${JSON.stringify(folder)})`,
    );
    assert.ok(
      native.files.reduce((sum, f) => sum + f.content.length, 0) > 2000000,
    );
    await js(
      `(async()=>{const state=await window.brainDesktop.readState(${JSON.stringify(actor.id)});state.workspaces[0].folder=null;state.activeWorkspaceId=state.workspaces[0].id;state.settings.model=${JSON.stringify(connection.id)};await window.brainDesktop.writeState(${JSON.stringify(actor.id)},state)})()`,
    );
    await js("location.reload()");
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('目录长度验收')`,
        ),
      "large folder model ready",
    );
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.workspace-start-controls')&&!document.querySelector('.entry-experience')`,
        ),
      "workspace picker on new chat",
    );
    await capture("workspace-new-chat-light.png");
    let picked = folder,
      selections = 0;
    dialog.showOpenDialog = async (_window, options) => {
      assert.deepEqual(options.properties, ["openDirectory"]);
      selections++;
      return picked
        ? { canceled: false, filePaths: [picked] }
        : { canceled: true, filePaths: [] };
    };
    await click("工作区");
    await click("新建工作区…");
    await waitFor(
      async () =>
        (
          await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`)
        ).workspaces.some((w) => w.folder === folder),
      "native folder creates workspace",
    );
    const created = (
      await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`)
    ).workspaces.find((w) => w.folder === folder);
    assert.equal(created.name, require("node:path").basename(folder));
    assert.equal(
      await js(`document.body.innerText.includes(${JSON.stringify(folder)})`),
      false,
    );
    await capture("workspace-folder-selected-light.png");
    picked = null;
    await click("新建工作区");
    await waitFor(() => selections === 2, "cancel native folder dialog");
    assert.equal(
      (await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`))
        .workspaces.length,
      saved.workspaces.length + 1,
    );
    picked = folder;
    await click("新建工作区");
    await waitFor(() => selections === 3, "existing folder reselected");
    assert.equal(
      (await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`))
        .workspaces.length,
      saved.workspaces.length + 1,
    );
    picked = dir;
    await click("新建工作区");
    await waitFor(
      async () =>
        (
          await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`)
        ).workspaces.some((w) => w.folder === dir),
      "second workspace created",
    );
    await selectOption("工作区", created.name);
    await js("location.reload()");
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="工作区"]')?.textContent.includes(${JSON.stringify(created.name)})&&!document.querySelector('.entry-experience')`,
        ),
      "workspace restored on reload",
    );
    await js("location.hash='settings'");
    await waitFor(
      () => js(`document.body.innerText.includes('本地记录与备份')`),
      "workspace dark settings",
    );
    await selectOption("外观", "深色");
    await js("location.hash='chat'");
    await waitFor(
      () => js(`!!document.querySelector('.workspace-start-controls')`),
      "workspace dark new chat",
    );
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 900);
    await capture("workspace-new-chat-dark-narrow.png");
    const layout = await js(
      `(() => { const r=document.querySelector('.workspace-start-controls').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,visible:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,theme:document.documentElement.dataset.theme}; })()`,
    );
    assert.equal(layout.overflow, false);
    assert.equal(layout.visible, true);
    assert.equal(layout.theme, "dark");
    await js("location.hash='settings'");
    await waitFor(
      () => js(`document.body.innerText.includes('本地记录与备份')`),
      "restore workspace theme",
    );
    await selectOption("外观", "默认（浅色）");
    win.setMinimumSize(...minimumSize);
    win.setContentSize(...size);
    await js("location.hash='chat'");
    await waitFor(
      () => js(`!!document.querySelector('.workspace-start-controls')`),
      "restore workspace chat",
    );
    await fill(
      'textarea[aria-label="任务输入"]',
      "目录长度回归验收：请分析当前工作区的文件内容",
    );
    await click("发送任务");
    await waitFor(
      () =>
        js(
          `!document.querySelector('.chat-loading') && document.body.innerText.includes('大目录读取验收成功')`,
        ),
      "large folder real HTTP reply",
      20000,
    );
    assert.equal(await js(`!!document.querySelector('.task-error')`), false);
    assert.equal(requests.length, 2);
    const text = requests[1].messages.find((m) => m.role === "user").content[0]
      .text;
    assert.match(text, /LARGE-FOLDER-UI-FIXTURE/);
    assert.match(text, /正文节选/);
    assert.match(text, /剩余正文未读取/);
    assert.ok(text.length < 121000);
    await js(`document.querySelector('.thinking-toggle').click()`);
    await waitFor(
      () => js(`document.body.innerText.includes('已读取本地目录')`),
      "honest directory progress",
    );
    assert.equal(
      await js(
        `!!document.querySelector('.workspace-start-controls, .project-folder, .chat-header .workspace-controls')`,
      ),
      false,
    );
    const owned = (
      await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`)
    ).conversations.find((c) =>
      c.messages.some((m) => m.content.includes("大目录读取验收成功")),
    );
    assert.equal(owned.workspaceId, created.id);
    const other = (
      await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`)
    ).workspaces.find((w) => w.folder === dir);
    await click("打开工作区 " + other.name);
    await waitFor(
      () => js(`!!document.querySelector('.workspace-start-controls')`),
      "new chat in other workspace",
    );
    assert.equal(
      await js(
        `document.querySelector('[data-workspace-id="'+${JSON.stringify(created.id)}+'"] [data-history-title]')?.textContent`,
      ),
      owned.title,
    );
    await click(owned.title);
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.message.assistant')&&!document.querySelector('.workspace-start-controls')`,
        ),
      "old chat retains workspace and hides picker",
    );
    await capture("workspace-conversation-light.png");
    checks.push(
      "Workspace groups: native folder creation, cancel, deduplication, picker only on new chat, no persistent path card, conversation ownership and reopening, actual dark 700px layout; synthetic files only",
    );
    await waitFor(async () => {
      const state = await js(
        `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
      );
      return state.conversations.some((c) =>
        c.messages.some((m) => m.content.includes("大目录读取验收成功")),
      );
    }, "workspace reply persisted");
    checks.push(
      "Multi-megabyte directory: real native read, bounded prioritized excerpts, actual router/chat HTTP, model receipt, successful reply and visible read-scope progress; no company models called",
    );
  } finally {
    dialog.showOpenDialog = originalDialog;
    win.setMinimumSize(...minimumSize);
    win.setContentSize(...size);
    await restoreFolder();
    if (connection)
      await request(`/connections/${connection.id}`, {}, "DELETE");
    provider.closeAllConnections();
    provider.close();
  }
  await js("location.reload()");
  await waitFor(
    () =>
      js(
        `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('验收模型 B')`,
      ),
    "restore ordinary QA model",
  );
  await click("新建任务");
};
