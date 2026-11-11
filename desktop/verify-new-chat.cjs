const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");

module.exports = async ({
  js,
  click,
  fill,
  waitFor,
  request,
  capture,
  win,
  checks,
}) => {
  const titles = [
    "今天想完成什么？",
    "有什么需要我处理？",
    "这次从哪里开始？",
    "现在想做些什么？",
    "今天有什么新想法？",
    "有什么问题想解决？",
    "想先聊聊什么？",
    "想把哪个想法做出来？",
    "接下来有什么安排？",
    "准备好开始了吗？",
  ];
  const title = () =>
    js(`document.querySelector('[data-chat-headline]')?.textContent`);
  const actor = await request("/auth/me");
  const saved = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
  );
  const size = win.getContentSize(),
    minimum = win.getMinimumSize();
  const appearance = await js(`document.documentElement.dataset.theme`);
  let connection, finishReply;
  const requests = [];
  const provider = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "这是居中布局的隔离验收回复。" } }] })}\n\n`,
    );
    finishReply = () => {
      if (!res.writableEnded) res.end("data: [DONE]\n\n");
    };
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  try {
    await click("新建对话");
    let previous = await title();
    assert.ok(titles.includes(previous));
    for (let i = 0; i < 20; i++) {
      await click("新建对话");
      await waitFor(
        async () => (await title()) !== previous,
        "new chat picks a different single headline",
      );
      const current = await title();
      assert.ok(titles.includes(current));
      previous = current;
    }
    assert.equal(
      await js(`document.querySelectorAll('.chat-welcome h1').length`),
      1,
    );
    assert.equal(
      await js(
        `document.querySelectorAll('.chat-welcome :is(p,button,img,.welcome-greeting,.suggestions),.chat.is-empty .composer-note').length`,
      ),
      0,
    );
    const centered = await js(
      `(()=>{const chat=document.querySelector('.chat').getBoundingClientRect(),header=document.querySelector('.chat-header').getBoundingClientRect(),headline=document.querySelector('.chat-welcome').getBoundingClientRect(),composer=document.querySelector('.composer-wrap').getBoundingClientRect();return {offset:(headline.top+composer.bottom)/2-(header.bottom+chat.bottom)/2,gap:composer.top-headline.bottom,inputWidth:document.querySelector('.composer').getBoundingClientRect().width}})()`,
    );
    assert.ok(Math.abs(centered.offset) < 45, JSON.stringify(centered));
    assert.ok(
      centered.gap >= 20 && centered.gap <= 36,
      JSON.stringify(centered),
    );
    await fill('[aria-label="任务输入"]', "标题稳定性验收草稿");
    assert.equal(await title(), previous);
    await js(`location.hash='settings'`);
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.settings-layout')||document.body.innerText.includes('本地记录与备份')`,
        ),
      "settings opens",
    );
    await js(`location.hash='chat'`);
    await waitFor(
      () => js(`!!document.querySelector('[data-chat-headline]')`),
      "draft returns",
    );
    assert.equal(await title(), previous);
    assert.equal(
      await js(`document.querySelector('[aria-label="任务输入"]').value`),
      "标题稳定性验收草稿",
    );
    await fill('[aria-label="任务输入"]', "");
    await capture("new-chat-centered-light.png");
    await js(`location.reload()`);
    await waitFor(
      () =>
        js(
          `!!document.querySelector('[data-chat-headline]')&&!document.querySelector('.entry-experience')`,
        ),
      "new chat reload ready",
    );
    assert.ok(titles.includes(await title()));
    assert.notEqual(await title(), previous);
    connection = await request("/connections", {
      name: "新对话布局验收",
      model: "deepseek-flash",
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
      kind: "chat",
      apiKey: "synthetic-new-chat-fixture",
    });
    await js(
      `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)});s.settings.model=${JSON.stringify(connection.id)};s.settings.skillMode='manual';s.settings.skillIds=[];await window.brainDesktop.writeState(${JSON.stringify(actor.id)},s)})()`,
    );
    await js(`location.reload()`);
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="选择模型"]')?.textContent.includes('新对话布局验收')&&!document.querySelector('.entry-experience')`,
        ),
      "synthetic new chat model ready",
    );
    await fill('[aria-label="任务输入"]', "你好");
    await click("发送任务");
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.chat-loading')&&!document.querySelector('.chat.is-empty')`,
        ),
      "first message moves composer into conversation layout",
    );
    const bottom = await js(
      `(()=>{const chat=document.querySelector('.chat').getBoundingClientRect(),composer=document.querySelector('.composer-wrap').getBoundingClientRect();return chat.bottom-composer.bottom})()`,
    );
    assert.ok(bottom >= -1 && bottom < 5, String(bottom));
    await waitFor(() => !!finishReply, "synthetic streamed reply started");
    finishReply();
    await waitFor(
      () =>
        js(
          `!document.querySelector('.chat-loading')&&document.body.innerText.includes('这是居中布局的隔离验收回复')`,
        ),
      "actual streamed reply completes",
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].messages.at(-1).content, "你好");
    for (const text of titles)
      assert.ok(
        !JSON.stringify(requests[0]).includes(text),
        "display headline never becomes a model instruction",
      );
    await capture("new-chat-conversation-bottom.png");
    await click("新建对话");
    assert.ok(titles.includes(await title()));
    assert.equal(await js(`!!document.querySelector('.chat.is-empty')`), true);
    win.setMinimumSize(600, 500);
    win.setContentSize(700, 600);
    await js(
      `(async()=>{const s=await window.brainDesktop.readState(${JSON.stringify(actor.id)});s.settings.theme='dark';await window.brainDesktop.writeState(${JSON.stringify(actor.id)},s)})()`,
    );
    await js(`location.reload()`);
    await waitFor(
      () =>
        js(
          `!!document.querySelector('[data-chat-headline]')&&document.documentElement.dataset.theme==='dark'&&!document.querySelector('.entry-experience')`,
        ),
      "actual dark preference loaded",
    );
    await capture("new-chat-centered-dark-narrow.png");
    assert.equal(
      await js(`document.documentElement.scrollWidth<=innerWidth`),
      true,
    );
    const fits = await js(
      `(()=>{const c=document.querySelector('.chat').getBoundingClientRect(),h=document.querySelector('[data-chat-headline]').getBoundingClientRect(),p=document.querySelector('.composer').getBoundingClientRect();return h.top>=c.top&&p.bottom<=c.bottom&&p.right<=c.right})()`,
    );
    assert.equal(fits, true);
    checks.push(
      "Centered new chat: exactly one of ten approved comma-free headlines; 20 explicit new chats avoid the preceding title, typing/settings navigation preserves it, reload avoids it, no recommendations or extra welcome text; real first-message streaming moves input to bottom, title never enters model context, new chat restores centered layout; dark narrow window fits",
    );
  } finally {
    finishReply?.();
    win.setMinimumSize(...minimum);
    win.setContentSize(...size);
    await js(
      `document.documentElement.dataset.theme=${JSON.stringify(appearance)}`,
    );
    await js(
      `window.brainDesktop.writeState(${JSON.stringify(actor.id)},${JSON.stringify(saved)})`,
    );
    if (connection)
      await request(`/connections/${connection.id}`, {}, "DELETE");
    provider.closeAllConnections();
    provider.close();
  }
  await js(`location.reload()`);
  await waitFor(
    () =>
      js(
        `!!document.querySelector('[data-chat-headline]')&&!document.querySelector('.entry-experience')`,
      ),
    "original new chat state restored",
  );
};
