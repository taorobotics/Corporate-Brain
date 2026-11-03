const assert = require("node:assert/strict");

// Runs inside the existing disposable Electron stream fixture, with no model calls.
module.exports = async function verifyChatScroll({
  web,
  win,
  js,
  waitFor,
  capture,
  checks,
}) {
  const metrics = () =>
    js(`(() => {
    const el = document.querySelector('.messages');
    return {top:el.scrollTop,height:el.scrollHeight,gap:el.scrollHeight-el.clientHeight-el.scrollTop};
  })()`);
  const processMetrics = () =>
    js(
      `(() => { const el=document.querySelector('.chat-loading .thinking-scroll');return {top:el.scrollTop,height:el.scrollHeight,visible:el.clientHeight,gap:el.scrollHeight-el.clientHeight-el.scrollTop}; })()`,
    );
  const atEnd = async () => {
    await settle();
    await waitFor(
      async () => (await metrics()).gap <= 2,
      "chat follows latest rendered content",
    );
  };
  let answer = "";
  const emit = (event) => {
    // Text events carry the whole answer so far; reasoning may carry deltas.
    if (event.type === "text")
      event = { ...event, text: (answer += event.text) };
    return js(`window.__emitProgress(${JSON.stringify(event)})`);
  };
  const settle = () =>
    js(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 100))))`,
    );
  const paragraph =
    "【滚动隔离验收】这是一段持续到达的内容，用于检查新内容自动跟随，同时允许用户上翻阅读历史。\n\n";
  await emit({
    type: "reasoning",
    id: "scroll-reasoning",
    text: paragraph.repeat(35),
  });
  await waitFor(
    async () => (await processMetrics()).height > 1800,
    "long reasoning contained in process panel",
  );
  await atEnd();
  await waitFor(
    async () => (await processMetrics()).gap <= 2,
    "process follows incoming reasoning",
  );
  assert.ok((await processMetrics()).visible <= 220);
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.reasoning-text')).every(el => el.scrollHeight <= el.clientHeight + 1)`,
    ),
    true,
  );
  const outerBefore = await metrics();
  const processPoint = await js(
    `(() => {const r=document.querySelector('.chat-loading .thinking-scroll').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
  );
  await web.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...processPoint,
    deltaX: 0,
    deltaY: -140,
  });
  await waitFor(
    async () => (await processMetrics()).gap > 80,
    "wheel reads earlier reasoning inside panel",
  );
  await settle();
  const processPaused = await processMetrics();
  await emit({
    type: "reasoning",
    id: "scroll-reasoning",
    text: paragraph.repeat(8),
    append: true,
  });
  await waitFor(
    async () => (await processMetrics()).height > processPaused.height + 100,
    "reasoning grows inside fixed panel",
  );
  await settle();
  assert.ok(Math.abs((await processMetrics()).top - processPaused.top) <= 2);
  assert.ok(Math.abs((await metrics()).top - outerBefore.top) <= 2);
  assert.equal(await js(`!!document.querySelector('.thinking-follow')`), true);
  await js(`document.querySelector('.thinking-follow').click()`);
  await waitFor(
    async () => (await processMetrics()).gap <= 2,
    "resume process following",
  );
  await js(`document.querySelector('.chat-loading .thinking-scroll').focus()`);
  web.sendInputEvent({ type: "keyDown", keyCode: "PageUp" });
  web.sendInputEvent({ type: "keyUp", keyCode: "PageUp" });
  await waitFor(
    async () => (await processMetrics()).gap > 50,
    "keyboard scrolls within process",
  );
  await waitFor(async () => {
    const before = await processMetrics();
    await new Promise((resolve) => setTimeout(resolve, 150));
    return Math.abs((await processMetrics()).top - before.top) <= 2;
  }, "keyboard scrolling has settled");
  await js(`document.querySelector('.thinking-follow').click()`);
  await waitFor(
    async () => (await processMetrics()).gap <= 2,
    "resume after keyboard navigation",
  );
  await js(`document.querySelector('.chat-loading .thinking-scroll').blur()`);
  await capture("client-thinking-panel-light.png");
  await js(`document.documentElement.dataset.theme='dark'`);
  await capture("client-thinking-panel-dark.png");
  await js(`document.documentElement.dataset.theme='light'`);
  win.setContentSize(900, 760);
  await settle();
  assert.ok((await processMetrics()).visible <= 160);
  await capture("client-thinking-panel-narrow.png");
  win.setContentSize(1586, 992);
  await emit({ type: "text", text: paragraph.repeat(25) });
  await waitFor(
    () =>
      js(
        `document.querySelector('.streaming-answer')?.textContent.length > 800`,
      ),
    "long answer rendered",
  );
  await waitFor(
    () =>
      js(`document.querySelector('.chat-loading .thinking-details').hidden`),
    "first answer text automatically collapses the process",
  );
  await atEnd();
  await js(`document.querySelector('.chat-loading .thinking-toggle').click()`);
  await emit({ type: "text", text: paragraph });
  await settle();
  assert.equal(
    await js(
      `document.querySelector('.chat-loading .thinking-details').hidden`,
    ),
    false,
    "manual reopening survives later answer chunks",
  );
  await js(`document.querySelector('.chat-loading .thinking-toggle').click()`);
  await atEnd();

  const point = await js(
    `(() => {const r=document.querySelector('.messages').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`,
  );
  await web.debugger.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    ...point,
    deltaX: 0,
    deltaY: -350,
  });
  await waitFor(
    async () => (await metrics()).gap > 150,
    "wheel pauses following",
  );
  await settle();
  const paused = await metrics();
  await emit({ type: "text", text: paragraph.repeat(12) });
  await waitFor(
    async () => (await metrics()).height > paused.height + 200,
    "answer grows while reading history",
  );
  await settle();
  assert.ok(
    Math.abs((await metrics()).top - paused.top) <= 2,
    "new tokens must not pull a reader away from history",
  );
  assert.equal(await js(`!!document.querySelector('.chat-jump-latest')`), true);
  await capture("client-chat-scroll-paused.png");
  await js(`document.querySelector('.chat-jump-latest').click()`);
  await atEnd();
  assert.equal(
    await js(`!!document.querySelector('.chat-jump-latest')`),
    false,
  );
  await emit({ type: "text", text: paragraph.repeat(4) });
  await atEnd();

  // Scrollbar/keyboard movement also pauses; scrolling down near the end resumes.
  await js(`document.querySelector('.messages').focus()`);
  web.sendInputEvent({ type: "keyDown", keyCode: "PageUp" });
  web.sendInputEvent({ type: "keyUp", keyCode: "PageUp" });
  await waitFor(
    async () => (await metrics()).gap > 100,
    "keyboard pauses following",
  );
  await settle();
  const keyboardPaused = await metrics();
  await emit({ type: "text", text: paragraph.repeat(4) });
  await waitFor(
    async () => (await metrics()).height > keyboardPaused.height,
    "tokens after keyboard navigation",
  );
  await settle();
  assert.ok(Math.abs((await metrics()).top - keyboardPaused.top) <= 2);
  await js(
    `const messages=document.querySelector('.messages');messages.scrollTop=messages.scrollHeight-messages.clientHeight-20;`,
  );
  await waitFor(
    () => js(`!document.querySelector('.chat-jump-latest')`),
    "near-bottom manual scroll resumes following",
  );
  const beforeResume = await metrics();
  await emit({ type: "text", text: paragraph.repeat(4) });
  await waitFor(
    async () => (await metrics()).height > beforeResume.height,
    "resumed stream grows",
  );
  await atEnd();

  // Image dimensions can change after React has finished rendering the message.
  await js(
    `(() => {const img=document.createElement('img');img.id='scroll-image-fixture';img.style.width='100%';document.querySelector('.streaming-answer').append(img);})()`,
  );
  await settle();
  const beforeImage = await metrics();
  await js(
    `document.querySelector('#scroll-image-fixture').src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#e8ddd2"/></svg>')`,
  );
  await waitFor(
    async () => (await metrics()).height > beforeImage.height + 100,
    "late image dimensions rendered",
  );
  await atEnd();
  await js(`document.querySelector('#scroll-image-fixture').remove()`);
  await atEnd();
  win.setContentSize(900, 760);
  await atEnd();
  await capture("client-chat-scroll-following.png");
  win.setContentSize(1586, 992);
  await atEnd();
  checks.push(
    "Process is bounded to 220px/160px, follows reasoning internally, pauses on wheel/keyboard and resumes without moving the outer chat; first answer collapses once and manual reopening persists; outer answer, images and resize follow while manual chat reading remains stable",
  );
};
