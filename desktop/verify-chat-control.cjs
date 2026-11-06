const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

function fixture() {
  const calls = [],
    closed = [];
  function handle(res, payload) {
    if (!payload.messages) return false;
    const system =
      typeof payload.messages[0].content === "string"
        ? payload.messages[0].content
        : "";
    const router = system.startsWith("You route tasks");
    const raw = router
      ? JSON.parse(payload.messages[1].content).messages.at(-1).content
      : payload.messages.at(-1).content;
    const latest =
      typeof raw === "string"
        ? raw
        : raw
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n");
    if (!latest.includes("合成控制")) return false;
    if (system.startsWith("Plan the production")) return false;
    const name = latest.includes("合成控制制作")
      ? "production"
      : latest.includes("合成控制调度")
        ? "routing"
        : "chat";
    if (router && name !== "routing") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: name === "production" ? "code" : "chat",
                  mode: "standard",
                  seconds: 2,
                }),
              },
            },
          ],
        }),
      );
      return true;
    }
    calls.push({ name, messages: payload.messages });
    res.once("close", () => {
      if (!res.writableEnded) closed.push(name);
    });
    if (router) return true;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const content = latest.startsWith("合成控制继续")
      ? "已按补充要求继续。"
      : "这是中止前已经收到的部分内容。";
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "隔离控制验收。", content } }] })}\n\n`,
    );
    if (latest.startsWith("合成控制继续"))
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    return true;
  }
  return { handle, calls, closed };
}

async function verify({
  js,
  click,
  fill,
  wait,
  capture,
  checks,
  win,
  controls,
}) {
  const input = '[aria-label="任务输入"]';
  const start = async (text) => {
    await wait(
      () => js(`!document.querySelector('.entry-experience')`),
      "startup reveal before controls",
    );
    await click("新建任务");
    await fill(input, text, "HTMLTextAreaElement");
    await click("发送任务");
  };
  const idle = () =>
    wait(
      () =>
        js(
          `!document.querySelector('.chat-loading')&&!document.querySelector('.composer [aria-label="中止回复"],.composer [aria-label="正在中止"]')`,
        ),
      "composer idle",
    );
  await start("合成控制对话：检查中止");
  await wait(
    () =>
      js(
        `document.querySelector('.chat-loading')?.textContent.includes('中止前已经收到')`,
      ),
    "real upstream partial",
  );
  assert.equal(
    await js(`document.querySelectorAll('.messages .thinking-stop').length`),
    0,
  );
  assert.equal(
    await js(
      `document.querySelector('.composer [aria-label="中止回复"]').disabled`,
    ),
    false,
  );
  await fs.writeFile(
    "artifacts/screenshots/chat-control-running-light.png",
    (await capture()).toPNG(),
  );
  await click("中止回复");
  await idle();
  await wait(() => controls.closed.includes("chat"), "upstream chat closed");
  assert.equal(
    await js(
      `document.querySelector('.message.assistant').textContent.includes('中止前已经收到')&&!!document.querySelector('[data-status="stopped"]')`,
    ),
    true,
  );
  assert.equal(
    await js(
      `Math.abs(document.querySelector('.composer-actions').getBoundingClientRect().right-document.querySelector('.composer-tools').getBoundingClientRect().right)<2`,
    ),
    true,
  );
  await fill(input, "合成控制继续：接着上面的内容回答", "HTMLTextAreaElement");
  await click("发送任务");
  await wait(
    () =>
      js(
        `document.body.textContent.includes('已按补充要求继续。')&&!document.querySelector('.chat-loading')`,
      ),
    "continue after stop",
  );
  assert.ok(
    controls.calls
      .at(-1)
      .messages.some(
        (m) => m.role === "assistant" && m.content.includes("中止前已经收到"),
      ),
  );
  checks.push(
    "Composer stop: real chat upstream aborts, partial text and stopped trace persist, idle send returns and same-conversation continuation receives the partial history; no message-body stop controls",
  );

  await start("合成控制引导：执行中补充要求");
  await wait(
    () =>
      js(
        `document.querySelector('.chat-loading')?.textContent.includes('中止前已经收到')`,
      ),
    "steering partial",
  );
  await fill(
    input,
    "合成控制继续：改成米白色并缩短文字",
    "HTMLTextAreaElement",
  );
  const size = win.getContentSize(),
    min = win.getMinimumSize();
  win.setMinimumSize(600, 600);
  win.setContentSize(700, 900);
  await js(`document.documentElement.dataset.theme='dark'`);
  assert.equal(
    await js(
      `document.documentElement.scrollWidth<=innerWidth&&document.querySelectorAll('.composer .send').length===2`,
    ),
    true,
  );
  await fs.writeFile(
    "artifacts/screenshots/chat-control-steering-dark-narrow.png",
    (await capture()).toPNG(),
  );
  await click("发送补充要求");
  await wait(
    () =>
      js(
        `document.body.textContent.includes('已按补充要求继续。')&&!document.querySelector('.chat-loading')`,
      ),
    "steered answer",
  );
  assert.ok(
    controls.calls
      .at(-1)
      .messages.some(
        (m) => m.role === "assistant" && m.content.includes("中止前已经收到"),
      ),
  );
  assert.equal(
    await js(`document.querySelectorAll('.message.user').length`),
    2,
  );
  win.setMinimumSize(...min);
  win.setContentSize(...size);
  await js(`document.documentElement.dataset.theme='light'`);
  checks.push(
    "Composer steering: running input sends once after confirmed stop, retains partial context, exposes distinct stop/send controls and fits dark 700px; synthetic provider only",
  );

  await start("合成控制调度：在识别能力时中止");
  await wait(
    () => controls.calls.some((c) => c.name === "routing"),
    "routing held",
  );
  await click("中止回复");
  await idle();
  await wait(
    () => controls.closed.includes("routing"),
    "routing upstream closed",
  );

  await start("合成控制制作：中止后台代码生成");
  await wait(
    () =>
      js(
        `document.querySelector('.chat-production')?.dataset.status==='generating'&&!!document.querySelector('.composer [aria-label="中止回复"]')`,
      ),
    "background generation",
  );
  const original = await js(
    `document.querySelector('.chat-header strong').textContent`,
  );
  await click("新建任务");
  assert.equal(await js(`!!document.querySelector('.composer .stop')`), false);
  await click(original);
  await wait(
    () => js(`!!document.querySelector('.composer .stop')`),
    "return to active conversation",
  );
  assert.equal(
    await js(
      `document.querySelector('.chat-production').textContent.includes('停止任务')`,
    ),
    false,
  );
  await fill(input, "合成控制继续：中止失败时不能发送", "HTMLTextAreaElement");
  await js(
    `window.__controlsFetch=window.fetch;window.fetch=(url,init)=>String(url).endsWith('/cancel')?Promise.reject(Error('Synthetic offline cancellation')):window.__controlsFetch(url,init);true`,
  );
  await click("发送补充要求");
  await wait(
    () => js(`!document.querySelector('.composer textarea').disabled`),
    "cancel failure unlocks input",
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.message.user').length===1&&document.querySelector('.composer textarea').value.includes('不能发送')`,
    ),
    true,
  );
  await js(`window.fetch=window.__controlsFetch;delete window.__controlsFetch`);
  await click("中止回复");
  await wait(
    () =>
      js(
        `document.querySelector('.chat-production')?.dataset.status==='cancelled'&&!document.querySelector('.composer .stop')`,
      ),
    "server task cancelled",
  );
  await wait(
    () => controls.closed.includes("production"),
    "production upstream closed",
  );
  assert.equal(
    await js(`document.querySelectorAll('.message.user').length`),
    1,
  );
  checks.push(
    "Composer production control: aborts routing and background generation, scopes stop to the visible conversation, preserves draft and prevents follow-up on cancellation failure; confirmed retry cancels the actual server task",
  );
}
module.exports = { fixture, verify };
