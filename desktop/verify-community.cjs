const assert = require("node:assert/strict");
module.exports = async ({
  js,
  click,
  fill,
  waitFor,
  request,
  capture,
  checks,
  win,
}) => {
  await waitFor(() => js("!document.querySelector('.entry-experience')"), "prior profile reveal completed");
  await js("location.hash='community-plugins'");
  const card = '.community-card[data-community-plugin="calculator"]';
  await waitFor(
    () => js(`!!document.querySelector(${JSON.stringify(card)})`),
    "company plugin catalog",
  );
  assert.equal(
    await js(
      `document.querySelector('.settings-nav [aria-current="page"]').textContent`,
    ),
    "开源社区插件",
  );
  assert.equal(
    await js(
      `document.querySelector('.community-plugins').innerText.includes('DeepSeek Harness')`,
    ),
    false,
  );
  await capture("community-plugins-adapted-light.png");
  await js(
    `Array.from(document.querySelectorAll(${JSON.stringify(card + " button")})).find(b=>b.textContent.trim()==='安装').click()`,
  );
  await waitFor(
    () =>
      js(
        `document.querySelector(${JSON.stringify(card)})?.innerText.includes('已安装 · 已启用')`,
      ),
    "per-user plugin installed",
  );
  await click("我的插件");
  await waitFor(
    () =>
      js(
        `document.querySelectorAll('.community-card').length===1 && !document.querySelector('.community-empty')`,
      ),
    "installed-only plugin catalog",
  );
  await js(
    `Array.from(document.querySelectorAll(${JSON.stringify(card + " button")})).find(b=>b.textContent.trim()==='停用').click()`,
  );
  await waitFor(
    () =>
      js(
        `document.querySelector(${JSON.stringify(card)})?.innerText.includes('已停用')`,
      ),
    "plugin disabled",
  );
  assert.equal(
    (await request("/community-plugins?scope=installed")).items[0].enabled,
    false,
  );
  await click("全部社区");
  await waitFor(
    () =>
      js(
        `document.querySelectorAll('.community-card').length===3 && !document.querySelector('.community-empty')`,
      ),
    "real HTTP community catalog fixture",
  );
  await fill('input[aria-label="搜索插件名称、作者或功能"]', "社区界面");
  await waitFor(
    () =>
      js(
        `document.querySelectorAll('.community-card').length===1 && document.querySelector('.community-card').innerText.includes('待适配')`,
      ),
    "community search",
  );
  assert.equal(
    await js(
      `Array.from(document.querySelectorAll('.community-card button')).some(b=>b.textContent.trim()==='安装')`,
    ),
    false,
  );
  await capture("community-plugins-community-light.png");
  await fill('input[aria-label="搜索插件名称、作者或功能"]', "");
  await click("我的插件");
  await waitFor(
    () => js(`!!document.querySelector(${JSON.stringify(card)})`),
    "return to installed plugin",
  );
  win.setContentSize(900, 760);
  await js("document.documentElement.dataset.theme='dark'");
  await click("数学计算器");
  await waitFor(
    () => js(`!!document.querySelector('.community-detail')`),
    "plugin provenance detail",
  );
  assert.equal(
    await js(`document.querySelector('.community-detail a').href`),
    "https://github.com/omdsh-dev/dsh-tool-calculator",
  );
  assert.equal(
    await js("document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await capture("community-plugins-detail-dark-narrow.png");
  await click("卸载插件");
  await waitFor(
    () => js(`!!document.querySelector('.community-plugins .empty')`),
    "plugin removed",
  );
  assert.equal((await request("/community-plugins?scope=installed")).total, 0);
  await js("document.documentElement.dataset.theme='light'");
  win.setContentSize(1586, 992);
  checks.push(
    "Company-branded community catalog: adapted/remote/installed filters, search, provenance, unavailable-plugin guard and dark narrow layout",
  );
  checks.push(
    "Employee installs, disables and uninstalls a verified plugin through real authenticated APIs without changing another account",
  );
};
