const assert = require("node:assert/strict");

// A synthetic, local-only conversation exercises the real Markdown renderer.
module.exports = async function ({
  js,
  click,
  waitFor,
  request,
  selectOption,
  capture,
  checks,
  win,
}) {
  const actor = await request("/auth/me");
  const minimumSize = win.getMinimumSize();
  const prior = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
  );
  const at = new Date().toISOString();
  const sample = {
    id: "chat-appearance-example",
    title: "排版示例 · 项目周报",
    createdAt: at,
    messages: [
      {
        id: "appearance-request",
        role: "user",
        at,
        content: "帮我整理一份清晰的项目周报，突出本周进展和接下来的安排。",
      },
      {
        id: "appearance-answer",
        role: "assistant",
        at,
        content:
          "这是一份**界面排版示例**，用于展示文字、段落与列表的阅读效果。\n\n## 本周进展\n\n团队已完成需求梳理，核心功能进入联调阶段。当前重点是让每一项工作都有清晰的负责人和交付时间。\n\n1. **产品设计**：完成主要页面，统一文字层级与交互细节。\n2. **研发协作**：打通关键流程，持续检查稳定性。\n3. **资料整理**：按部门归档，方便同事查阅和复用。\n\n## 下一步安排\n\n优先完成联调，再邀请同事试用。收集反馈后调整细节，让日常协作更加顺畅。",
      },
    ],
  };
  try {
    await js(
      `window.brainDesktop.writeState(${JSON.stringify(actor.id)},${JSON.stringify({ ...prior, conversations: [sample, ...(prior.conversations || [])] })})`,
    );
    await js("location.hash='chat';location.reload()");
    await waitFor(
      () =>
        js(`document.body.innerText.includes(${JSON.stringify(sample.title)})`),
      "appearance example restored",
    );
    await click(sample.title);
    await waitFor(
      () => js(`!!document.querySelector('.message.assistant h2')`),
      "appearance Markdown rendered",
    );
    await waitFor(
      () => js(`!document.querySelector('.entry-experience')`),
      "appearance workspace revealed",
    );
    await js(
      `document.documentElement.dataset.skin='claude';document.documentElement.dataset.theme='light'`,
    );
    win.setContentSize(1586, 1100);
    await js(`document.querySelector('.messages').scrollTop=0`);
    await capture("chat-appearance-ivory.png");
    const typography = await js(
      `(() => {const s=getComputedStyle(document.querySelector('.message.assistant .message-markdown'));return {font:s.fontFamily,size:parseFloat(s.fontSize),line:parseFloat(s.lineHeight),background:getComputedStyle(document.documentElement).backgroundColor}})()`,
    );
    assert.doesNotMatch(typography.font, /Newsreader|Songti|Noto Serif/i);
    assert.equal(typography.size, 18);
    assert.ok(typography.line >= 30);
    assert.equal(typography.background, "rgb(250, 249, 245)");
    await js(`location.hash='settings'`);
    await waitFor(
      () => js(`document.body.innerText.includes('本地记录与备份')`),
      "appearance settings",
    );
    await selectOption("外观", "深色");
    await js(`location.hash='chat'`);
    await waitFor(
      () => js(`!!document.querySelector('.message.assistant h2')`),
      "dark conversation",
    );
    assert.equal(
      await js(`getComputedStyle(document.documentElement).backgroundColor`),
      "rgb(24, 23, 21)",
    );
    await js(`document.querySelector('.messages').scrollTop=0`);
    await capture("chat-appearance-dark.png");
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 900);
    await js(`location.hash='settings'`);
    await waitFor(
      () => js(`document.body.innerText.includes('本地记录与备份')`),
      "narrow appearance settings",
    );
    await selectOption("外观", "默认（浅色）");
    await js(`location.hash='chat'`);
    await waitFor(
      () => js(`!!document.querySelector('.message.assistant h2')`),
      "narrow conversation",
    );
    await js(`document.querySelector('.messages').scrollTop=0`);
    await capture("chat-appearance-narrow.png");
    assert.equal(
      await js(`document.documentElement.scrollWidth<=innerWidth`),
      true,
    );
    assert.equal(
      await js(
        `parseFloat(getComputedStyle(document.querySelector('.message.assistant .message-markdown')).fontSize)`,
      ),
      16,
    );
    checks.push(
      "Synthetic conversation: consistent sans-serif reading type, 18px wide/16px narrow, ivory Claude surface, native light/dark screenshots and no narrow document overflow",
    );
  } finally {
    await js(
      `window.brainDesktop.writeState(${JSON.stringify(actor.id)},${JSON.stringify(prior)})`,
    );
    win.setMinimumSize(...minimumSize);
    win.setContentSize(1586, 992);
    await js("location.hash='chat';location.reload()");
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.composer')&&!document.body.innerText.includes(${JSON.stringify(sample.title)})`,
        ),
      "appearance sample cleaned",
    );
  }
};
