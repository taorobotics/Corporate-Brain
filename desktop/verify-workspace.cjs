const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { join } = require("node:path");
const { createServer } = require("node:http");
const { once } = require("node:events");

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
}) => {
  const folder = join(dir, "large-project-fixture");
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
      `(async()=>{const state=await window.brainDesktop.readState(${JSON.stringify(actor.id)});state.workspaces[0].folder=${JSON.stringify(folder)};state.activeWorkspaceId=state.workspaces[0].id;state.settings.model=${JSON.stringify(connection.id)};await window.brainDesktop.writeState(${JSON.stringify(actor.id)},state)})()`,
    );
    await js("location.reload()");
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('目录长度验收')`,
        ),
      "large folder model ready",
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
    await capture("workspace-large-folder.png");
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
