const assert = require("node:assert/strict");

module.exports = async ({
  js,
  click,
  waitFor,
  capture,
  win,
  checks,
  request,
  selectOption,
}) => {
  const native = await js("window.brainDesktop.updates.state()");
  assert.equal(
    await js(
      "document.querySelectorAll('.activity-rail .account-trigger').length",
    ),
    1,
  );
  assert.equal(
    await js(
      "document.querySelectorAll('.sidebar .account-trigger, .rail-settings').length",
    ),
    0,
  );
  for (const status of [
    "idle",
    "checking",
    "current",
    "error",
    "unavailable",
  ]) {
    win.webContents.send("updates:state", { ...native, status, release: null });
    await waitFor(
      () => js("!document.querySelector('.sidebar-update')"),
      "no update indicator for " + status,
    );
  }
  await capture("account-rail-no-update.png");
  win.webContents.send("updates:state", native);
  await waitFor(
    () => js("!!document.querySelector('.rail-account .sidebar-update')"),
    "known update restored",
  );
  await click("切换侧栏");
  assert.equal(await js("!!document.querySelector('.sidebar')"), false);
  await click("打开账号菜单");
  await waitFor(
    () => js("!!document.querySelector('.account-menu-popup[data-open]')"),
    "avatar menu while history collapsed",
  );
  assert.deepEqual(
    await js(
      "[...document.querySelectorAll('.account-menu-popup [role=menuitem]')].map(e=>e.textContent.trim())",
    ),
    ["设置", "反馈", "退出登录"],
  );
  await capture("account-rail-menu.png");
  await click("反馈");
  await waitFor(
    () => js("!!document.querySelector('[aria-label=反馈内容]')"),
    "general feedback opens without a conversation",
  );
  assert.equal(
    await js("document.querySelector('.modal button[type=submit]').disabled"),
    true,
  );
  assert.equal(
    await js("!!document.querySelector('.feedback-consent')"),
    false,
  );
  const text = "整体界面反馈验收 <img src=x onerror=alert(1)>";
  await js(
    `(()=>{const e=document.querySelector('[aria-label=反馈内容]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await capture("general-feedback-light.png");
  await click("提交反馈");
  await waitFor(
    () => js("!document.querySelector('.modal')"),
    "general feedback submitted",
  );
  const list = await request("/admin/feedback?source=general");
  assert.equal(list.total, 1);
  assert.equal(list.rows[0].source, "general");
  const detail = await request("/admin/feedback/" + list.rows[0].id);
  assert.equal(detail.description, text);
  assert.equal(detail.context, null);
  await js("location.hash='admin-feedback';true");
  await waitFor(
    () =>
      js(
        "document.querySelector('.feedback-table')?.textContent.includes('整体界面反馈验收')",
      ),
    "same admin table receives general feedback",
  );
  assert.equal(
    await js("!!document.querySelector('.feedback-table img')"),
    false,
  );
  await capture("admin-general-feedback.png");
  await js("location.hash='chat';true");
  await waitFor(
    () => js("!!document.querySelector('.rail-account')"),
    "back to employee view",
  );
  await click("切换侧栏");

  const originalSize = win.getContentSize();
  const originalMinimum = win.getMinimumSize();
  await click("打开账号菜单");
  await click("设置");
  await waitFor(
    () => js("!!document.querySelector('[aria-label=外观]')"),
    "appearance settings",
  );
  await selectOption("外观", "深色");
  win.setMinimumSize(600, 600);
  win.setContentSize(700, 700);
  await click("打开账号菜单");
  await waitFor(
    () => js("!!document.querySelector('.account-menu-popup[data-open]')"),
    "dark narrow account menu",
  );
  assert.equal(
    await js(
      "(()=>{const r=document.querySelector('.account-menu-popup').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()",
    ),
    true,
  );
  await capture("account-rail-dark-narrow.png");
  await click("反馈");
  await waitFor(
    () => js("!!document.querySelector('[aria-label=反馈内容]')"),
    "dark general feedback",
  );
  await capture("general-feedback-dark-narrow.png");
  await click("取消");
  await selectOption("外观", "默认（浅色）");
  win.setMinimumSize(...originalMinimum);
  win.setContentSize(...originalSize);
  await click("对话");
  checks.push(
    "Left rail retains avatar and available-only update indicator when history is collapsed; idle/checking/current/error/unavailable without a release show no icon; avatar menu has exactly settings, feedback and logout; blank feedback is blocked, literal UI report is stored without chat context and safely appears in the same administrator table",
  );
};
