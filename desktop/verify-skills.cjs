const assert = require("node:assert/strict");

// Runs inside verify.cjs with a disposable company and disposable local profiles.
module.exports = async function ({
  js,
  click,
  fill,
  waitFor,
  request,
  key,
  win,
  capture,
  checks,
  revealed,
  selectOption,
}) {
  const create = async (name) => {
    const skill = await request("/skills", {
      name,
      description: "用于组合技能的隔离界面验收",
      version: "1.0.0",
      instructions: "根据用户目标整理清晰的标题层级并检查结果。",
      examples: "合成示例",
      testSummary: "隔离界面验收，无真实模型调用",
      requiredTools: [],
      audience: "company",
      targetDepartments: [],
    });
    await request(`/skills/${skill.id}/review`, {
      approve: true,
      note: "合成验收",
    });
    return skill;
  };
  const second = await create("组合排版验收");
  const uninstalled = await create("未安装技能验收");
  await js("location.reload()");
  await waitFor(
    () =>
      js(
        `!!document.querySelector('.skill-filters') || [...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='全公司')`,
      ),
    "skill catalog reloaded",
  );
  await click("全公司");
  await revealed();
  await waitFor(
    () =>
      js(
        `!![...document.querySelectorAll('.skill-card')].find(el=>el.textContent.includes('组合排版验收'))`,
      ),
    "second published skill",
  );
  await js(
    `[...document.querySelectorAll('.skill-card')].find(el=>el.textContent.includes('组合排版验收')).querySelector('footer button').click()`,
  );
  await waitFor(
    () =>
      js(
        `[...document.querySelectorAll('.skill-card')].find(el=>el.textContent.includes('组合排版验收')).textContent.includes('使用')`,
      ),
    "second skill installed",
  );
  const connection = await request("/connections", {
    name: "多技能界面验收",
    kind: "chat",
    model: "qa-no-generation",
    baseUrl: "https://qa.invalid/v1",
    apiKey: "qa-placeholder-not-a-secret",
    departments: [],
  });
  await js("location.hash='chat'; location.reload()");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="选择技能"]')`),
    "chat skill trigger",
  );
  await revealed();
  await click("选择技能");
  await waitFor(
    () => js(`!!document.querySelector('.skill-picker[data-open]')`),
    "skills open upward",
  );
  assert.equal(
    await js(
      `document.querySelector('.skill-picker-auto').getAttribute('aria-checked')`,
    ),
    "true",
  );
  assert.equal(
    await js(`document.querySelector('[aria-label="选择技能"]').type`),
    "button",
  );
  assert.deepEqual(
    await js(
      `[...document.querySelectorAll('.skill-picker-item strong')].map(el=>el.textContent).sort()`,
    ),
    ["团队文案流程", "组合排版验收"].sort(),
  );
  assert.equal(
    await js(
      `(()=>{const p=document.querySelector('.skill-picker').getBoundingClientRect(),b=document.querySelector('[aria-label="选择技能"]').getBoundingClientRect();return p.bottom<=b.top && p.top>=0 && p.right<=innerWidth})()`,
    ),
    true,
    "popover should fit above its trigger",
  );
  await fill('input[aria-label="搜索已安装技能"]', "排版");
  assert.equal(
    await js(`document.querySelectorAll('.skill-picker-item').length`),
    1,
  );
  await js(`document.querySelector('.skill-picker-item').click()`);
  await fill('input[aria-label="搜索已安装技能"]', "");
  await js(
    `[...document.querySelectorAll('.skill-picker-item')].find(el=>el.textContent.includes('团队文案流程')).click()`,
  );
  assert.equal(
    await js(
      `document.querySelectorAll('.skill-picker-item[aria-checked=true]').length`,
    ),
    2,
    "multi-select stays open",
  );
  await capture("skills-multi-select-light.png");
  await js(
    `document.querySelector('.skill-picker-item').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`,
  );
  assert.equal(
    await js(
      `document.activeElement===document.querySelectorAll('.skill-picker-item')[1]`,
    ),
    true,
  );
  await key("Escape");
  await waitFor(
    () => js(`!document.querySelector('.skill-picker[data-open]')`),
    "close skills with Escape",
  );
  await waitFor(
    () =>
      js(
        `document.activeElement===document.querySelector('[aria-label="选择技能"]')`,
      ),
    "skill trigger focus restored",
  );
  assert.equal(
    await js(`document.querySelectorAll('[aria-label^="移除技能 "]').length`),
    2,
  );
  await js("location.reload()");
  await waitFor(
    () =>
      js(`document.querySelectorAll('[aria-label^="移除技能 "]').length===2`),
    "multi-skill preference persists",
  );
  const selected = await js(
    `document.querySelector('[aria-label="选择技能"]').textContent`,
  );
  assert.ok(selected.includes("2"));
  await revealed();
  await js("location.hash='settings'");
  await waitFor(
    () => js(`!!document.querySelector('.settings-content')`),
    "settings theme controls",
  );
  await selectOption("外观", "深色");
  await js("location.hash='chat'");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="选择技能"]')`),
    "dark chat",
  );
  win.setContentSize(900, 720);
  await click("选择技能");
  await waitFor(
    () =>
      js(
        `(()=>{const p=document.querySelector('.skill-picker').getBoundingClientRect();return p.left>=0 && p.top>=0 && p.right<=innerWidth && p.bottom<=innerHeight})()`,
      ),
    "narrow dark skill picker fits",
  );
  await capture("skills-multi-select-dark-narrow.png");
  assert.equal(await js(`document.documentElement.dataset.theme`), "dark");
  await key("Escape");
  win.setContentSize(1586, 992);
  await js("location.hash='settings'");
  await waitFor(
    () => js(`!!document.querySelector('.settings-content')`),
    "restore theme controls",
  );
  await selectOption("外观", "浅色");
  await js("location.hash='chat'");
  await waitFor(
    () => js(`!!document.querySelector('[aria-label="选择技能"]')`),
    "light chat restored",
  );
  checks.push(
    "Installed-skill popover opens upward, defaults automatic, filters only this account's installed skills, searches and retains multiple selections; keyboard, reload, dark and narrow layouts pass",
  );
  const installed = await request("/skills");
  const first = installed.find((skill) => skill.name === "团队文案流程");
  await js(
    `(()=>{window.__skillsFetch=window.fetch;window.__skillRequests=[];window.fetch=(input,options)=>{const path=String(input);if(!['/api/generate/plan','/api/generate/chat'].includes(path))return window.__skillsFetch(input,options);const body=JSON.parse(options.body);window.__skillRequests.push({path,body});if(path.endsWith('/plan'))return Promise.resolve(Response.json({kind:'chat',mode:'standard',seconds:10,connectionId:${JSON.stringify(connection.id)},skillIds:body.skillMode==='auto'?[${JSON.stringify(first.id)},${JSON.stringify(second.id)}]:body.skillIds}));return Promise.resolve(new Response(JSON.stringify({type:'done',content:'多技能隔离验收已完成。'})+'\\n',{headers:{'Content-Type':'application/x-ndjson'}}));}})()`,
  );
  const send = async (text) => {
    await fill('textarea[aria-label="任务输入"]', text);
    await js(`document.querySelector('[aria-label="发送任务"]').click()`);
    await waitFor(
      () =>
        js(
          `!document.querySelector('.chat-loading') && window.__skillRequests.at(-1)?.path==='/api/generate/chat'`,
        ),
      "skill chat request complete",
    );
  };
  await send("多技能界面验收：使用选中的写作与排版流程");
  let sent = await js("window.__skillRequests.slice(-2)");
  assert.equal(sent[0].body.skillMode, "manual");
  assert.deepEqual(sent[0].body.skillIds, [second.id, first.id]);
  assert.deepEqual(sent[1].body.skillIds, [second.id, first.id]);
  await click("选择技能");
  await js(`document.querySelector('.skill-picker-auto').click()`);
  await key("Escape");
  await send("多技能界面验收：自动选择合适技能");
  sent = await js("window.__skillRequests.slice(-2)");
  assert.equal(sent[0].body.skillMode, "auto");
  assert.deepEqual(
    [...sent[0].body.skillIds].sort(),
    [first.id, second.id].sort(),
  );
  assert.ok(!sent[0].body.skillIds.includes(uninstalled.id));
  assert.deepEqual(sent[1].body.skillIds, [first.id, second.id]);
  await js(
    `window.fetch=window.__skillsFetch;delete window.__skillsFetch;delete window.__skillRequests`,
  );
  await click("选择技能");
  await js(`document.querySelector('.skill-picker-item').click()`);
  await key("Escape");
  const chip = await js(
    `document.querySelector('[aria-label^="移除技能 "]').getAttribute('aria-label')`,
  );
  await click(chip);
  assert.equal(
    await js(`document.querySelectorAll('[aria-label^="移除技能 "]').length`),
    0,
  );
  assert.ok(
    (
      await js(`document.querySelector('[aria-label="选择技能"]').textContent`)
    ).includes("未选"),
    "removing all chips keeps explicit no-skill mode",
  );
  await click("选择技能");
  await js(
    `[...document.querySelectorAll('.skill-picker-item')].find(el=>el.textContent.includes('团队文案流程')).click()`,
  );
  await key("Escape");
  checks.push(
    "Manual multi-skill IDs reach both router and chat; automatic mode supplies only installed candidates and dispatches multiple selected skills; individual chips can be removed without silently re-enabling auto",
  );
  // Leave only the original shared fixture available for subsequent employee checks.
  await request(`/skills/${second.id}/disable`, {});
  await request(`/skills/${uninstalled.id}/disable`, {});
  await request(`/connections/${connection.id}`, {}, "DELETE");
};
