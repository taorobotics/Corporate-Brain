const assert = require("node:assert/strict");

// Real browser, preload and server flow; provider replies are isolated local fixtures.
module.exports = async function ({
  js,
  click,
  fill,
  waitFor,
  request,
  selectOption,
  key,
  checks,
  capture,
  port,
}) {
  const service = await request("/model-services", {
    provider: "custom",
    name: "图片技能验收",
    baseUrl: `http://127.0.0.1:${port}/image-skill-fixture`,
    apiKey: "synthetic-image-skill-ui-key",
    departments: [],
    models: [
      { model: "qa-text", kind: "chat" },
      { model: "qa-image", kind: "image" },
    ],
  });
  const connections = (await request("/connections")).filter(
    (c) => c.serviceId === service.id,
  );
  const image = connections.find((c) => c.kind === "image");
  const chat = connections.find((c) => c.kind === "chat");
  const actor = await request("/auth/me");
  const saved = () =>
    js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`);
  const stats = () =>
    js(`fetch('/image-skill-fixture/stats').then(r=>r.json())`);
  await js("location.hash='skills';location.reload()");
  await waitFor(
    () =>
      js(
        `!![...document.querySelectorAll('.tabs button')].find(el=>el.textContent.trim()==='全公司')`,
      ),
    "skill center loaded",
  );
  await click("全公司");
  await waitFor(
    () =>
      js(
        `!![...document.querySelectorAll('.skill-card')].find(el=>el.textContent.includes('图片生成 · 图片技能验收'))`,
      ),
    "configured image automatically becomes company skill",
  );
  await click("已安装");
  await waitFor(
    () =>
      js(
        `!![...document.querySelectorAll('.skill-card')].find(el=>el.textContent.includes('图片生成 · 图片技能验收'))`,
      ),
    "image skill ready without manual download",
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.skill-card')).find(el=>el.textContent.includes('图片生成 · 图片技能验收')).innerText.includes('移除')`,
    ),
    false,
  );
  await capture("image-skill-catalog.png");
  await js("location.hash='models'");
  await waitFor(
    () =>
      js(
        `!![...document.querySelectorAll('.connection-card')].find(el=>el.textContent.includes('qa-image'))`,
      ),
    "employee image service",
  );
  const beforeModel = (await saved()).settings.model;
  await js(
    `Array.from(document.querySelectorAll('.connection-card')).find(el=>el.textContent.includes('qa-image')).querySelector('button').click()`,
  );
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
    "image skill use opens chat",
  );
  await waitFor(
    async () => (await saved()).settings.skillIds.includes(image.id),
    "image skill selection persisted",
  );
  assert.equal(
    (await saved()).settings.model,
    beforeModel,
    "using image skill never replaces chat model",
  );
  await selectOption("选择模型", chat.name);
  await click("选择技能");
  await waitFor(
    () => js(`!!document.querySelector('.skill-picker[data-open]')`),
    "image available in skill picker",
  );
  assert.equal(
    await js(
      `document.querySelector('.skill-picker').innerText.includes('图片生成 · 图片技能验收')`,
    ),
    true,
  );
  await key("Escape");
  await fill(
    'textarea[aria-label="任务输入"]',
    "隔离验收：写一段介绍并生成配图",
  );
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  await waitFor(
    async () =>
      (await saved()).conversations.some((c) =>
        c.messages.some(
          (m) =>
            m.role === "assistant" &&
            m.image &&
            m.content.includes("隔离验收文字回复"),
        ),
      ),
    "same response stores text and image",
    20000,
  );
  const state = await saved();
  const conversation = state.conversations.find((c) =>
    c.messages.some((m) => m.image && m.content.includes("隔离验收文字回复")),
  );
  const answer = conversation.messages.find(
    (m) => m.image && m.content.includes("隔离验收文字回复"),
  );
  assert.equal(answer.connectionId, chat.id);
  assert.equal(answer.modelName, chat.name);
  assert.equal(answer.trace.status, "done");
  assert.equal((await stats()).images, 1);
  assert.equal(
    await js(`!!document.querySelector('.generated-image img')`),
    true,
  );
  await capture("image-skill-chat-response.png");
  await js("location.reload()");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
    "reloaded chat ready",
  );
  await click(conversation.title);
  await waitFor(
    () =>
      js(
        `!!document.querySelector('[aria-label="任务输入"]') && document.body.innerText.includes('隔离验收文字回复')`,
      ),
    "combined reply restored after reload",
  );
  assert.equal(
    (await saved()).conversations
      .find((c) => c.id === conversation.id)
      .messages.find((m) => m.id === answer.id).image,
    answer.image,
  );
  await fill(
    'textarea[aria-label="任务输入"]',
    "隔离验收：普通问答，介绍一下可用工具",
  );
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  await waitFor(
    async () =>
      (await saved()).conversations
        .find((c) => c.id === conversation.id)
        .messages.filter((m) => m.role === "assistant").length === 2,
    "ordinary chat with image skill selected",
  );
  assert.equal(
    (await stats()).images,
    1,
    "ordinary chat never calls image provider",
  );
  assert.equal(
    (await saved()).conversations
      .find((c) => c.id === conversation.id)
      .messages.at(-1).image,
    undefined,
  );
  checks.push(
    "Configured image API becomes an automatically ready company skill; image selection preserves chat model; one real server request streams text and a generated-image fixture into the same locally saved reply; reload retains both; ordinary chat with image skill selected performs zero extra image calls (isolated upstream, no paid model calls)",
  );
  await waitFor(
    () => js(`!document.querySelector('[aria-label="选择技能"]').disabled`),
    "skill picker enabled after reply",
  );
  await click("选择技能");
  await waitFor(
    () => js(`!!document.querySelector('.skill-picker[data-open]')`),
    "restore automatic skill mode",
  );
  await js(`document.querySelector('.skill-picker-auto').click()`);
  await key("Escape");
  await waitFor(
    async () => (await saved()).settings.skillMode === "auto",
    "automatic mode durably restored",
  );
  for (const c of connections)
    await request(`/connections/${c.id}`, {}, "DELETE");
  await js("location.hash='chat';location.reload()");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
    "image QA cleanup",
  );
  await click("新建对话");
};
