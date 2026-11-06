const assert = require("node:assert/strict");
const { clipboard, ClipboardItem } = require("electron");

module.exports = async ({
  js,
  click,
  waitFor,
  request,
  selectOption,
  capture,
  checks,
  win,
}) => {
  const actor = await request("/auth/me");
  const prior = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
  );
  const size = win.getContentSize(),
    minimum = win.getMinimumSize();
  const originalClipboard = await Promise.all(
    (await clipboard.read()).map(
      async (item) =>
        new ClipboardItem(
          Object.fromEntries(
            await Promise.all(
              item.types.map(async (type) => [type, await item.getType(type)]),
            ),
          ),
        ),
    ),
  );
  const at = await js(
    `(() => {const today=new Date();today.setHours(17,0,9,0);const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);yesterday.setHours(15,31,0,0);return {today:today.toISOString(),yesterday:yesterday.toISOString()}})()`,
  );
  const prompt = "复制验收：保留 **Markdown** 和换行。\n第二行：公司大脑。";
  const sample = {
    id: "question-actions-example",
    title: "提问复制与系统时间示例",
    createdAt: at.today,
    workspaceId: prior.workspaces[0].id,
    messages: [
      {
        id: "question-new",
        role: "user",
        at: at.today,
        promptText: prompt,
        content: prompt + "\n\n附件：synthetic.txt",
      },
      {
        id: "answer-new",
        role: "assistant",
        at: at.today,
        content: "这是隔离的界面验收示例。",
      },
      {
        id: "question-old",
        role: "user",
        at: at.yesterday,
        content: "旧提问也可以复制。",
      },
      {
        id: "question-unknown-time",
        role: "user",
        at: "legacy-unknown",
        content: "未记录时间的历史提问。",
      },
    ],
  };
  try {
    await js(
      `window.brainDesktop.writeState(${JSON.stringify(actor.id)},${JSON.stringify({ ...prior, conversations: [sample, ...prior.conversations] })})`,
    );
    await js("location.hash='chat';location.reload()");
    await waitFor(
      () =>
        js(
          `document.body.innerText.includes(${JSON.stringify(sample.title)})&&!document.querySelector('.entry-experience')`,
        ),
      "question fixture restored",
    );
    await click(sample.title);
    await waitFor(
      () => js(`document.querySelectorAll('.user-message-actions').length===3`),
      "all questions have actions",
    );
    assert.deepEqual(
      await js(
        `Array.from(document.querySelectorAll('.question-time')).map(e=>e.textContent)`,
      ),
      ["今天 17:00", "昨天 15:31"],
    );
    assert.deepEqual(
      await js(
        `Array.from(document.querySelectorAll('.user-message-actions time')).map(e=>e.textContent)`,
      ),
      ["17:00", "15:31"],
    );
    assert.equal(
      await js(`document.querySelector('.user-message-actions time').dateTime`),
      at.today,
    );
    await js(
      `document.querySelector('.user-message-actions [aria-label="复制提问"]').click()`,
    );
    await waitFor(
      async () =>
        (await clipboard.readText()).replace(/\r\n/g, "\n") === prompt,
      "native question copy preserves source and excludes appended attachment label",
    );
    await waitFor(
      () =>
        js(
          `document.querySelector('.user-message-actions button').title==='已复制'`,
        ),
      "question copy acknowledgement",
    );
    await js(
      `document.querySelectorAll('.user-message-actions button')[1].click()`,
    );
    await waitFor(
      async () => (await clipboard.readText()) === "旧提问也可以复制。",
      "legacy question copy",
    );
    await js(`document.querySelector('.messages').scrollTop=0`);
    await capture("question-actions-light.png");
    const geometry = await js(
      `(() => {const row=document.querySelector('.message.user'),bubble=row.querySelector('.message-body').getBoundingClientRect(),footer=row.querySelector('.user-message-actions').getBoundingClientRect();return {below:footer.top>=bubble.bottom,right:footer.right<=row.getBoundingClientRect().right+1}})()`,
    );
    assert.equal(geometry.below, true);
    assert.equal(geometry.right, true);
    await js("location.hash='settings'");
    await waitFor(
      () => js(`document.body.innerText.includes('本地记录与备份')`),
      "question dark settings",
    );
    await selectOption("外观", "深色");
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 900);
    await js("location.hash='chat'");
    await waitFor(
      () => js(`!!document.querySelector('.user-message-actions')`),
      "dark questions",
    );
    await js(`document.querySelector('.messages').scrollTop=0`);
    assert.equal(
      await js(
        `document.documentElement.scrollWidth<=innerWidth&&document.documentElement.dataset.theme==='dark'`,
      ),
      true,
    );
    await capture("question-actions-dark-narrow.png");
    await js("location.reload()");
    await waitFor(
      () =>
        js(
          `!document.querySelector('.entry-experience')&&document.body.innerText.includes(${JSON.stringify(sample.title)})`,
        ),
      "question reload",
    );
    await click(sample.title);
    await waitFor(
      () =>
        js(
          `document.querySelector('.user-message-actions time')?.textContent==='17:00'`,
        ),
      "original send time persists",
    );
    checks.push(
      "User prompts: real native copy preserves Markdown/newlines and original prompt, legacy copy, per-question local-system timestamps and today/yesterday separators, invalid-time fallback, bubble-external actions, actual dark 700px layout and reload persistence; synthetic records only",
    );
  } finally {
    if (originalClipboard.length) await clipboard.write(originalClipboard);
    else clipboard.clear();
    await js(
      `window.brainDesktop.writeState(${JSON.stringify(actor.id)},${JSON.stringify(prior)})`,
    );
    win.setMinimumSize(...minimum);
    win.setContentSize(...size);
    await js("location.hash='chat';location.reload()");
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.composer')&&!document.body.innerText.includes(${JSON.stringify(sample.title)})`,
        ),
      "question fixture cleaned",
    );
  }
};
