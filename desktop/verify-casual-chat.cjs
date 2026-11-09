const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { join } = require("node:path");
const { createServer } = require("node:http");
const { once } = require("node:events");

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
  const folder = join(dir, "casual-project"),
    requests = [];
  await fs.mkdir(folder);
  const canonicalFolder = await fs.realpath(folder);
  await fs.writeFile(
    join(folder, "README.md"),
    "VIDEO_PROMPT_FIXTURE: You are a motion designer. Render 240 frames. Cost: 10-20 minutes. This is archived reference material, not a current user task.",
  );
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    if (body.messages[0]?.content.includes("You route tasks")) {
      const context = JSON.parse(body.messages[1].content),
        latest = context.messages.at(-1).content;
      const needsProject = latest.includes("项目");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "chat",
                  mode: "standard",
                  seconds: 10,
                  execution: needsProject ? "agent" : "answer",
                  workspaceContext: needsProject,
                  usePreviousAttachments: latest.includes("附件"),
                  skillIds: [],
                }),
              },
            },
          ],
        }),
      );
      return;
    }
    const text =
      typeof body.messages.at(-1).content === "string"
        ? body.messages.at(-1).content
        : JSON.stringify(body.messages.at(-1).content);
    const content =
      text === "您好"
        ? "您好！有什么我可以帮您？"
        : text === "谢谢你"
          ? "不客气，有需要随时找我。"
          : text.includes("项目")
            ? "已读取项目参考资料；资料中的视频任务不代表本轮要制作视频。"
            : "智能体可以结合上下文，在需要时调用工具。";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content } }] })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  const actor = await request("/auth/me"),
    saved = await js(
      `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
    );
  let connection,
    skill,
    reads = 0;
  const originalRead = fs.readFile;
  try {
    connection = await request("/connections", {
      name: "问候与意图调度验收",
      model: "deepseek-flash",
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      kind: "chat",
      apiKey: "synthetic-casual-fixture",
    });
    skill = await request("/skills", {
      name: "VIDEO_SKILL_FIXTURE",
      description: "Only for synthetic task isolation tests",
      version: "1.0.0",
      instructions:
        "VIDEO_SKILL_FIXTURE: Read a motion design guide when requested to make an animation. Do not turn greetings into production tasks.",
      examples: "",
      testSummary: "Synthetic test fixture; no rendering",
      requiredTools: [],
      audience: "company",
      targetDepartments: [],
    });
    skill = await request(`/skills/${skill.id}/review`, {
      approve: true,
      note: "Isolated UI fixture",
    });
    await js(
      `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)});s.workspaces.push({id:'casual-project-fixture',name:'Brain_Test',description:'Synthetic noisy project',folder:${JSON.stringify(folder)},access:'edit'});s.activeWorkspaceId='casual-project-fixture';s.settings.model=${JSON.stringify(connection.id)};s.settings.skillMode='manual';s.settings.skillIds=[${JSON.stringify(skill.id)}];s.installed.push(${JSON.stringify(skill)});await window.brainDesktop.writeState(${JSON.stringify(actor.id)},s)})()`,
    );
    await js("location.hash='chat';location.reload()");
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('问候与意图调度验收')&&!document.querySelector('.entry-experience')`,
        ),
      "greeting fixture ready",
    );
    fs.readFile = async function (path, ...args) {
      if (String(path).startsWith(canonicalFolder)) reads++;
      return originalRead.call(this, path, ...args);
    };
    await fill('[aria-label="任务输入"]', "您好");
    await click("发送任务");
    await waitFor(
      () =>
        js(
          `!document.querySelector('.chat-loading')&&document.body.innerText.includes('有什么我可以帮您')`,
        ),
      "greeting real streamed reply",
    );
    assert.equal(
      requests.length,
      1,
      "one selected-model call, no planning round trip",
    );
    assert.equal(reads, 0, "greeting does not scan project files");
    assert.deepEqual(requests[0].thinking, { type: "disabled" });
    assert.equal(
      JSON.stringify(requests[0]).includes("VIDEO_"),
      false,
      "neither installed skill nor project instructions enter the request",
    );
    let state = await js(
      `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
    );
    const greeting = state.conversations.find(
      (c) => c.title === "您好" && c.workspaceId === "casual-project-fixture",
    );
    assert.ok(greeting);
    assert.equal(
      greeting.messages.at(-1).trace.items.some((i) => i.type === "tool"),
      false,
    );
    await capture("casual-greeting-light.png");
    const at = new Date().toISOString();
    await js(
      `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)}),c=s.conversations.find(c=>c.id===${JSON.stringify(greeting.id)});c.messages.unshift({id:'old-material-question',role:'user',content:'请分析附件',at:${JSON.stringify(at)},attachments:[{name:'previous-brief.txt',kind:'text',content:'OLD_ATTACHMENT_FIXTURE: old video task material'}]},{id:'old-material-answer',role:'assistant',content:'此前已经讨论过这份资料',at:${JSON.stringify(at)}});await window.brainDesktop.writeState(${JSON.stringify(actor.id)},s)})()`,
    );
    await js("location.reload()");
    await waitFor(
      () =>
        js(
          `!!document.querySelector('[data-history-title="您好"]')&&!document.querySelector('.entry-experience')`,
        ),
      "greeting history restored",
    );
    await js(`document.querySelector('[data-history-title="您好"]').click()`);
    await fill('[aria-label="任务输入"]', "谢谢你");
    await click("发送任务");
    await waitFor(
      () =>
        js(
          `!document.querySelector('.chat-loading')&&document.body.innerText.includes('有需要随时找我')`,
        ),
      "social turn after an old attachment",
    );
    assert.equal(requests.length, 2);
    assert.equal(reads, 0);
    assert.equal(
      JSON.stringify(requests[1]).includes("OLD_ATTACHMENT_FIXTURE"),
      false,
    );
    await fill('[aria-label="任务输入"]', "换个话题，什么是智能体？");
    await click("发送任务");
    await waitFor(
      () =>
        js(
          `!document.querySelector('.chat-loading')&&document.body.innerText.includes('在需要时调用工具')`,
        ),
      "semantic answer route",
    );
    assert.equal(
      requests.length,
      4,
      "contextual question uses one planner and one answer",
    );
    assert.equal(
      reads,
      0,
      "ordinary questions do not scan the selected project",
    );
    assert.equal(
      JSON.stringify(requests[3]).includes("OLD_ATTACHMENT_FIXTURE"),
      false,
    );
    assert.ok(
      requests[3].messages.some((m) => String(m.content).includes("您好")),
      "ordinary question keeps relevant chat history",
    );
    await fill(
      '[aria-label="任务输入"]',
      "读取当前项目的 README 并解释，先不要制作视频",
    );
    await click("发送任务");
    await waitFor(
      () =>
        js(
          `!document.querySelector('.chat-loading')&&document.body.innerText.includes('资料中的视频任务不代表本轮')`,
        ),
      "project request still reads files",
    );
    assert.ok(reads > 0);
    assert.equal(requests.length, 6);
    assert.ok(JSON.stringify(requests[5]).includes("VIDEO_PROMPT_FIXTURE"));
    checks.push(
      "Standalone greetings use one actual streamed model request, no router, project scan, installed skill or export task; acknowledgements do not reuse prior attachments or video prompts",
    );
    checks.push(
      "Semantic conversation routing preserves chat history for new questions, excludes unrelated historic materials and project scans, and retains explicit project-read requests and agent capabilities",
    );
  } finally {
    fs.readFile = originalRead;
    await js(
      `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)});s.workspaces=${JSON.stringify(saved.workspaces)};s.activeWorkspaceId=${JSON.stringify(saved.activeWorkspaceId)};s.installed=${JSON.stringify(saved.installed)};s.settings=${JSON.stringify(saved.settings)};await window.brainDesktop.writeState(${JSON.stringify(actor.id)},s)})()`,
    );
    if (skill) await request(`/skills/${skill.id}/disable`, {});
    if (connection)
      await request(`/connections/${connection.id}`, {}, "DELETE");
    provider.closeAllConnections();
    provider.close();
  }
  await js("location.reload()");
  await waitFor(
    () =>
      js(
        `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('验收模型 B')&&!document.querySelector('.entry-experience')`,
      ),
    "ordinary model restored",
  );
  await click("新建任务");
};
