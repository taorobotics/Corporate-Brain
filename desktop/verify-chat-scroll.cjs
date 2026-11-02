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
    async () => (await metrics()).height > 1800,
    "long reasoning rendered",
  );
  await atEnd();
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.reasoning-text')).every(el => el.scrollHeight <= el.clientHeight + 1)`,
    ),
    true,
  );
  await emit({ type: "text", text: paragraph.repeat(25) });
  await waitFor(
    () =>
      js(
        `document.querySelector('.streaming-answer')?.textContent.length > 800`,
      ),
    "long answer rendered",
  );
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
    "Chat follows streamed reasoning and answer text, delayed image sizing and window resizing; wheel and keyboard history navigation pause following, with a return-to-latest button and manual near-bottom resume; no nested reasoning scrollbars",
  );
};
