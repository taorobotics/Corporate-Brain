const assert = require("node:assert/strict");

// Runs against the real employee UI and native profile in the disposable QA service.
module.exports = async ({ js, click, waitFor, capture, win, checks }) => {
  const originalSize = win.getContentSize();
  const originalMinimum = win.getMinimumSize();
  const appearance = await js(
    `({skin:document.documentElement.dataset.skin, theme:document.documentElement.dataset.theme})`,
  );
  assert.equal(appearance.skin, "cloud");
  await waitFor(
    () => js(`document.fonts.ready.then(()=>true)`),
    "collaboration fonts loaded",
  );
  const shape = await js(`(() => {
    const app=document.querySelector('.employee-app');
    const rail=app.querySelector('.activity-rail').getBoundingClientRect();
    const side=app.querySelector('.sidebar').getBoundingClientRect();
    return {rail:rail.width,side:side.width,adjacent:Math.abs(rail.right-side.left)<2,
      headerBorder:getComputedStyle(app.querySelector('.chat-header')).borderBottomWidth,
      composerWidth:app.querySelector('.composer').getBoundingClientRect().width,
      font:getComputedStyle(app).fontFamily,
      fonts:[...document.fonts].filter(f=>f.family==='Noto Sans SC'&&f.status==='loaded').map(f=>({family:f.family,status:f.status})),
      nav:app.querySelectorAll('.activity-rail > button').length,
      automaticLabels:app.querySelectorAll('.composer-automatic').length};
  })()`);
  assert.equal(shape.rail, 62);
  assert.ok(shape.side >= 190 && shape.side <= 210);
  assert.equal(shape.adjacent, true);
  assert.equal(shape.headerBorder, "0px");
  assert.ok(shape.composerWidth >= 600, JSON.stringify(shape));
  assert.match(shape.font, /^"?Noto Sans SC"?,/);
  assert.ok(shape.fonts.length > 0, 'Visible UI uses the bundled Noto Sans SC subsets');
  assert.equal(shape.automaticLabels, 0);
  assert.equal(shape.nav, 6);
  await capture("collaboration-cloud-home.png");
  await require("./verify-sidebar-resize.cjs")({
    js,
    click,
    waitFor,
    capture,
    win,
    checks,
  });
  await require("./verify-settings-navigation.cjs")({
    js,
    click,
    waitFor,
    capture,
    win,
    checks,
  });
  try {
    await click("项目");
    await waitFor(
      () => js(`!!document.querySelector('.page')`),
      "rail opens real project list",
    );
    await capture("collaboration-cloud-projects.png");
    await click("新建对话");
    await waitFor(
      () => js(`!!document.querySelector('.chat-welcome')`),
      "new conversation from context sidebar",
    );
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 900);
    await capture("collaboration-cloud-narrow.png");
    assert.equal(
      await js(`document.documentElement.scrollWidth <= innerWidth`),
      true,
    );
    const composer = await js(
      `(() => {const c=document.querySelector('.composer').getBoundingClientRect();const s=document.querySelector('.send').getBoundingClientRect();return {right:c.right,send:s.right,width:innerWidth};})()`,
    );
    assert.ok(
      composer.right <= composer.width && composer.send <= composer.right,
    );
    const before = await js(`!!document.querySelector('.sidebar')`);
    await js(
      `document.querySelector('.desktop-bar button[aria-label="切换侧栏"]').click()`,
    );
    assert.notEqual(await js(`!!document.querySelector('.sidebar')`), before);
    assert.equal(await js(`!!document.querySelector('.activity-rail')`), true);
    await js(
      `document.querySelector('.desktop-bar button[aria-label="切换侧栏"]').click()`,
    );
  } finally {
    win.setMinimumSize(...originalMinimum);
    win.setContentSize(...originalSize);
  }
  checks.push(
    "Approved collaboration layout: Cloud palette, self-hosted Noto Sans SC Unicode subsets, separate activity rail, additive project navigation, compact composer, hidden redundant automatic label, borderless chat heading and real narrow window/rail collapse",
  );
};
