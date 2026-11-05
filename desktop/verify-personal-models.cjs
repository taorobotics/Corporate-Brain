const assert = require("node:assert/strict");
module.exports = async function ({
  js,
  click,
  fill,
  waitFor,
  request,
  selectOption,
  key,
  capture,
  checks,
  win,
}) {
  const actor = await request("/auth/me");
  assert.equal(actor.role, "employee");
  await js("location.hash='models';location.reload()");
  await waitFor(
    () => js(`!!document.querySelector('.personal-model-services')`),
    "employee personal model entry",
  );
  await click("自定义配置");
  await waitFor(
    () => js(`!!document.querySelector('.modal')`),
    "employee personal API dialog",
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.modal input[name="departments"]').length`,
    ),
    0,
  );
  assert.equal(
    await js(
      `document.querySelector('.modal').innerText.includes('允许使用的部门')`,
    ),
    false,
  );
  await js(
    `Array.from(document.querySelectorAll('.provider-option')).at(-1).click()`,
  );
  await fill('.modal input[name="name"]', "员工个人模型验收");
  await fill(
    '.modal input[name="baseUrl"]',
    "https://personal-ui.invalid/image-skill-fixture",
  );
  await fill('.modal input[name="apiKey"]', "synthetic-image-skill-ui-key");
  await click("获取 / 刷新模型");
  await waitFor(
    () => js(`document.querySelectorAll('.model-catalog-row').length===3`),
    "personal real fixture catalog",
  );
  await js(
    `Array.from(document.querySelectorAll('.model-catalog-row')).filter(el=>el.innerText.includes('qa-text')&&!el.innerText.includes('alt')).forEach(el=>el.querySelector('input').click())`,
  );
  await capture("employee-personal-model-config.png");
  await js(`document.documentElement.dataset.theme='dark'`);
  win.setContentSize(600, 850);
  await capture("employee-personal-model-dark-narrow.png");
  assert.equal(
    await js(`document.documentElement.scrollWidth<=innerWidth`),
    true,
  );
  win.setContentSize(1586, 992);
  await js(`document.documentElement.dataset.theme='light'`);
  await click("保存配置");
  await waitFor(
    () =>
      js(
        `!document.querySelector('.modal')&&document.querySelector('.personal-model-services').innerText.includes('员工个人模型验收')`,
      ),
    "private model saved",
  );
  const service = (await request("/my-model-services")).find(
    (s) => s.name === "员工个人模型验收",
  );
  assert.equal(service.personal, true);
  assert.deepEqual(service.departments, []);
  const own = (await request("/connections")).find(
    (c) => c.serviceId === service.id,
  );
  assert.equal(own.personal, true);
  await click("浏览 / 选择模型");
  await waitFor(
    () =>
      js(`document.querySelectorAll('.modal .model-catalog-row').length===3`),
    "company catalog opens full returned list",
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.modal input[name="apiKey"],.modal input[name="departments"]').length`,
    ),
    0,
  );
  await fill('input[aria-label="搜索模型标识"]', "qa-text-alt");
  assert.equal(
    await js(`document.querySelectorAll('.model-catalog-row').length`),
    1,
  );
  await js(`document.querySelector('.model-catalog-row input').click()`);
  await capture("employee-linoroute-catalog.png");
  await click("保存配置");
  await waitFor(
    () => js(`!document.querySelector('.modal')`),
    "personal company catalog choice saved",
  );
  const borrowed = (await request("/connections")).find(
    (c) => c.sourceServiceId && c.model === "qa-text-alt",
  );
  assert.ok(borrowed);
  assert.equal(borrowed.personal, true);
  await js("location.hash='chat'");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
    "employee chat ready",
  );
  await selectOption("选择模型", borrowed.name);
  await fill('textarea[aria-label="任务输入"]', "员工私有模型：普通问答验收");
  await js(`document.querySelector('[aria-label="发送任务"]').click()`);
  const saved = () =>
    js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`);
  await waitFor(
    async () =>
      (await saved()).conversations.some((c) =>
        c.messages.some(
          (m) =>
            m.role === "assistant" &&
            m.connectionId === borrowed.id &&
            m.content.includes("隔离验收文字回复"),
        ),
      ),
    "borrowed company model used through real chat server",
    20000,
  );
  await js("location.hash='models';location.reload()");
  await waitFor(
    () => js(`!!document.querySelector('.personal-model-services')`),
    "personal model state restored",
  );
  assert.equal(
    (await request("/connections")).find((c) => c.id === own.id).personal,
    true,
  );
  checks.push(
    "Actual employee account can configure a private encrypted API with provider presets, fetch/search/select models and save/reload; no department/share controls in light or dark narrow layout; authorized LinoRoute catalog exposes additional models without a key input, personal selection reaches chat through the real server (local fixture, no paid calls)",
  );
  for (const s of await request("/my-model-services"))
    await request("/my-model-services/" + s.id, {}, "DELETE");
  await js("location.hash='chat';location.reload()");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
    "personal model fixture cleanup",
  );
  await click("新建任务");
};
