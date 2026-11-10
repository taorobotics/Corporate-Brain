const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const text = (content) =>
  typeof content === "string"
    ? content
    : content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");

function fixture() {
  const turns = new Map();
  function handle(res, payload) {
    if (!payload.messages) return false;
    const router = text(payload.messages[0].content).startsWith(
      "You route tasks",
    );
    const latest = router
      ? JSON.parse(payload.messages[1].content).messages.at(-1).content
      : text(payload.messages.at(-1).content);
    const label = latest.match(/合成并行([A-G])/)?.[1];
    if (!label) return false;
    if (router) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ kind: "chat", mode: "standard" }),
              },
            },
          ],
        }),
      );
      return true;
    }
    const turn = { res, messages: payload.messages, closed: false };
    if (!turns.has(label)) turns.set(label, []);
    turns.get(label).push(turn);
    res.on("close", () => {
      turn.closed = true;
    });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: label + " 的独立思考。", content: label + " 的独立回答。" } }] })}\n\n`,
    );
    return true;
  }
  const last = (label) => turns.get(label)?.at(-1);
  const emit = (label, content) =>
    last(label).res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    );
  const finish = (label) => {
    emit(label, label + " 已完成。");
    last(label).res.end(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  };
  const fail = (label) =>
    last(label).res.end(
      `data: ${JSON.stringify({ error: { message: "Synthetic stream failure" } })}\n\n`,
    );
  return { handle, turns, last, emit, finish, fail };
}

async function verify({
  js,
  click,
  fill,
  wait,
  capture,
  checks,
  win,
  concurrent,
  account,
}) {
  const input = '[aria-label="任务输入"]';
  const appearance = async (label, theme) => {
    await js(`location.hash='settings';true`);
    await wait(
      () =>
        js(`!!document.querySelector('.select-trigger[aria-label="外观"]')`),
      "appearance settings",
    );
    await click("外观");
    await wait(
      () => js(`!!document.querySelector('.select-popup[data-open]')`),
      "appearance picker",
    );
    await js(
      `[...document.querySelectorAll('[role="option"]')].find(e=>e.querySelector('.select-option-label')?.textContent===${JSON.stringify(label)}).click();true`,
    );
    await wait(
      () =>
        js(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`),
      "actual " + theme + " theme",
    );
  };
  await appearance("浅色", "light");
  const titles = {};
  const attach = async (label) => {
    await js(
      `(() => {const e=document.querySelector('[aria-label="选择附件"]'),d=new DataTransfer();d.items.add(new File([${JSON.stringify("素材" + label + "专属")}],'same-name.txt',{type:'text/plain'}));e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`,
    );
    await wait(
      () =>
        js(
          `document.querySelector('.composer').textContent.includes('same-name.txt')&&!document.querySelector('.attachment-reading')`,
        ),
      "attachment parsed for " + label,
    );
  };
  const open = async (label) => {
    await click(titles[label]);
    await wait(
      () =>
        js(
          `document.querySelector('.chat-header strong').textContent===${JSON.stringify(titles[label])}`,
        ),
      "open " + label,
    );
  };
  const start = async (label, attachment = false) => {
    await click("新建对话");
    await wait(
      () => js(`!document.querySelector('.entry-experience')`),
      "new chat reveal",
    );
    assert.equal(
      await js(`document.querySelector('.composer textarea').value`),
      "",
    );
    if (attachment) await attach(label);
    await fill(input, "合成并行" + label + "：独立执行", "HTMLTextAreaElement");
    assert.equal(
      await js(
        `document.querySelector('.composer [aria-label="发送任务"]').disabled`,
      ),
      false,
    );
    await js(
      `document.querySelector('.composer [aria-label="发送任务"]').click();document.querySelector('.composer [aria-label="发送任务"]')?.click();true`,
    );
    await wait(() => concurrent.last(label), "real stream " + label);
    await wait(
      () =>
        js(
          `document.querySelector('.chat-loading')?.textContent.includes(${JSON.stringify(label + " 的独立回答。")})`,
        ),
      "visible stream " + label,
    );
    titles[label] = await js(
      `document.querySelector('.chat-header strong').textContent`,
    );
    assert.equal(concurrent.turns.get(label).length, 1);
    assert.equal(
      await js(`document.querySelectorAll('.message.user').length`),
      1,
    );
  };
  await start("A", true);
  await start("B", true);
  await start("C");
  assert.equal(
    ["A", "B", "C"].filter((s) => !concurrent.last(s).closed).length,
    3,
  );
  for (const label of ["A", "B"]) {
    const context = concurrent
      .last(label)
      .messages.map((m) => text(m.content))
      .join("\n");
    assert.ok(context.includes("素材" + label + "专属"));
    assert.ok(!context.includes("素材" + (label === "A" ? "B" : "A") + "专属"));
  }
  await fill(input, "C 的未发送草稿", "HTMLTextAreaElement");
  await open("A");
  await fill(input, "A 的未发送草稿", "HTMLTextAreaElement");
  await open("B");
  await fill(input, "B 的未发送草稿", "HTMLTextAreaElement");
  await open("A");
  assert.equal(
    await js(`document.querySelector('.composer textarea').value`),
    "A 的未发送草稿",
  );
  concurrent.finish("C");
  await wait(() => concurrent.last("C").closed, "C completes in background");
  assert.equal(
    await js(
      `document.querySelector('.composer textarea').value==='A 的未发送草稿'&&!!document.querySelector('.chat-loading')`,
    ),
    true,
  );
  await js(`document.querySelector('[aria-label="关闭提示"]')?.click();true`);
  await fs.writeFile(
    "artifacts/screenshots/concurrent-chat-running-light.png",
    (await capture()).toPNG(),
  );
  await open("C");
  await wait(
    () =>
      js(
        `!document.querySelector('.chat-loading')&&document.querySelector('.messages').textContent.includes('C 已完成。')`,
      ),
    "C own completion",
  );
  assert.equal(
    await js(`document.querySelector('.composer textarea').value`),
    "C 的未发送草稿",
  );
  await open("A");
  await click("中止回复");
  await wait(
    () =>
      js(
        `!document.querySelector('.chat-loading')&&!!document.querySelector('[data-status="stopped"]')`,
      ),
    "only A stopped",
  );
  await wait(() => concurrent.last("A").closed, "A upstream aborted");
  assert.equal(concurrent.last("B").closed, false);
  concurrent.emit("B", "B 在 A 中止后仍继续。");
  await open("B");
  await wait(
    () =>
      js(
        `document.querySelector('.chat-loading')?.textContent.includes('B 在 A 中止后仍继续。')`,
      ),
    "B still streams",
  );
  assert.equal(
    await js(`document.querySelector('.composer textarea').value`),
    "B 的未发送草稿",
  );
  await open("A");
  await fill(input, "合成并行A：停止后再执行", "HTMLTextAreaElement");
  await click("发送任务");
  await wait(
    () => concurrent.turns.get("A").length === 2,
    "A resumed while B runs",
  );
  await fill(input, "合成并行A：补充要求在后台继续", "HTMLTextAreaElement");
  await js(
    `(() => {document.querySelector('[aria-label="发送补充要求"]').click();const b=[...document.querySelectorAll('[data-history-title]')].find(e=>e.dataset.historyTitle===${JSON.stringify(titles.B)});b.click();return true;})()`,
  );
  await wait(
    () => concurrent.turns.get("A").length === 3,
    "A steering stays on A after navigation",
  );
  assert.equal(
    await js(`document.querySelector('.chat-header strong').textContent`),
    titles.B,
  );
  assert.equal(
    await js(`document.querySelector('.composer textarea').value`),
    "B 的未发送草稿",
  );
  assert.equal(concurrent.last("B").closed, false);
  const historyA = concurrent
    .last("A")
    .messages.map((m) => text(m.content))
    .join("\n");
  assert.ok(historyA.includes("A 的独立回答。"));
  assert.ok(!historyA.includes("素材B专属"));
  concurrent.finish("A");
  concurrent.finish("B");
  await wait(
    () =>
      js(
        `!document.querySelector('.chat-loading')&&document.querySelector('.messages').textContent.includes('B 已完成。')`,
      ),
    "B own completion",
  );
  assert.equal(
    await js(`document.querySelector('.composer textarea').value`),
    "B 的未发送草稿",
  );
  checks.push(
    "Concurrent chats: three real upstream streams run together; distinct same-name attachments and drafts stay isolated, C completes out of order, A stop leaves B streaming, A follow-up after navigation stays on A and preserves its partial history; double-click sends once",
  );

  await start("D");
  await start("E");
  concurrent.fail("D");
  await wait(() => concurrent.last("D").closed, "D upstream failure");
  assert.equal(
    await js(
      `!document.querySelector('.task-error')&&!!document.querySelector('.chat-loading')`,
    ),
    true,
  );
  await open("D");
  await wait(
    () =>
      js(
        `!!document.querySelector('.task-error')&&!document.querySelector('.chat-loading')`,
      ),
    "D error isolated",
  );
  concurrent.finish("E");
  await open("E");
  await wait(
    () =>
      js(
        `!document.querySelector('.task-error')&&!document.querySelector('.chat-loading')&&document.querySelector('.messages').textContent.includes('E 已完成。')`,
      ),
    "E success isolated",
  );
  const size = win.getContentSize(),
    min = win.getMinimumSize();
  win.setMinimumSize(600, 600);
  win.setContentSize(700, 900);
  await appearance("深色", "dark");
  await open("A");
  assert.equal(
    await js(
      `document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.messages').textContent.includes('A 已完成。')`,
    ),
    true,
  );
  await fs.writeFile(
    "artifacts/screenshots/concurrent-chat-results-dark-narrow.png",
    (await capture()).toPNG(),
  );
  win.setMinimumSize(...min);
  win.setContentSize(...size);
  await js(`location.reload();true`);
  await wait(
    () =>
      js(
        `!document.querySelector('.entry-experience')&&!!document.querySelector('.sidebar')`,
      ),
    "parallel history reload",
  );
  for (const label of ["A", "B", "C", "D", "E"]) {
    await open(label);
    await wait(
      () => js(`document.querySelectorAll('.message.assistant').length>0`),
      "history " + label,
    );
    assert.equal(
      await js(
        `document.querySelector('.messages').textContent.includes(${JSON.stringify(label + " 的独立回答。")})`,
      ),
      true,
    );
    for (const other of ["A", "B", "C", "D", "E"].filter((s) => s !== label))
      assert.equal(
        await js(
          `document.querySelector('.messages').textContent.includes(${JSON.stringify(other + " 的独立回答。")})`,
        ),
        false,
      );
  }
  checks.push(
    "Concurrent chats: one stream failure leaves other streams usable, each answer/error trace survives reload in its original conversation, dark narrow results fit and background completion preserves the foreground input; synthetic provider only",
  );
  await start("F");
  await start("G");
  await click("打开账号菜单");
  await wait(
    () =>
      js(
        `[...document.querySelectorAll('[role="menuitem"]')].some(e=>e.textContent.trim()==='退出登录')`,
      ),
    "logout menu",
  );
  await js(
    `[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='退出登录').click();true`,
  );
  await wait(
    () => concurrent.last("F").closed && concurrent.last("G").closed,
    "logout aborts all live streams",
  );
  await wait(
    () =>
      js(
        `!!document.querySelector('[name=username]')&&!document.querySelector('.entry-form-stage[inert]')`,
      ),
    "login after parallel cleanup",
  );
  await fill("[name=username]", account.username);
  await fill("[name=password]", account.password);
  await js(`document.querySelector('form').requestSubmit();true`);
  await wait(
    () =>
      js(
        `!!document.querySelector('.sidebar')&&!document.querySelector('.entry-experience')`,
      ),
    "parallel login restored",
  );
  await click("新建对话");
  await fill(input, "重新登录后的草稿", "HTMLTextAreaElement");
  assert.equal(
    await js(
      `!document.querySelector('.chat-loading')&&!document.querySelector('.composer .stop')&&!document.querySelector('.composer [aria-label="发送任务"]').disabled`,
    ),
    true,
  );
  checks.push(
    "Concurrent chats: logout aborts both in-flight provider streams, relogin starts without stale pending requests or locks; only disposable account data used",
  );
}
module.exports = { fixture, verify };
