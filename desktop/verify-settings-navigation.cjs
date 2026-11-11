const assert = require("node:assert/strict");
const { app, dialog } = require("electron");
const fs = require("node:fs/promises");
const { join } = require("node:path");

module.exports = async ({ js, click, waitFor, capture, win, checks }) => {
  const originalSize = win.getContentSize(),
    originalMinimum = win.getMinimumSize();
  const actor = await js(`fetch('/api/auth/me').then(r=>r.json())`);
  const prior = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
  );
  const exportFile = join(
    app.getPath("userData"),
    "qa-settings-menu-export.json",
  );
  const originalSave = dialog.showSaveDialog;
  dialog.showSaveDialog = async (window, options) =>
    options?.defaultPath?.startsWith("公司大脑-本地记录-")
      ? { canceled: false, filePath: exportFile }
      : originalSave.call(dialog, window, options);
  const fillDraft = (value) =>
    js(
      `(()=>{const e=document.querySelector('[aria-label="任务输入"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return new Promise(r=>requestAnimationFrame(()=>r(true)))})()`,
    );
  const assertPage = async (id, label) => {
    await waitFor(
      () =>
        js(
          `location.hash===${JSON.stringify("#" + id)}&&document.querySelector('.settings-nav button[aria-current="page"]')?.textContent.trim()===${JSON.stringify(label)}`,
        ),
      "settings route " + id,
    );
    assert.equal(
      await js(`document.querySelectorAll('.settings-nav').length`),
      1,
    );
    assert.equal(
      await js(`document.querySelectorAll('.settings-nav button').length`),
      5,
    );
    assert.equal(
      await js(
        `document.querySelector('.rail-account .account-trigger').getAttribute('data-settings-active')`,
      ),
      "page",
    );
    assert.equal(
      await js(
        `document.querySelector('.settings-nav')===window.settingsNavigationNode`,
      ),
      true,
      "shared settings navigation remains mounted",
    );
    assert.equal(
      await js(`document.documentElement.scrollWidth<=innerWidth`),
      true,
      "settings page has no horizontal overflow",
    );
  };
  const go = async (id, label) => {
    await js(
      `[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click();true`,
    );
    await assertPage(id, label);
    await waitFor(
      () => js(`document.querySelector('.settings-page').scrollTop===0`),
      "new settings section starts at top",
    );
  };
  const theme = async (label) => {
    await click("外观");
    await waitFor(
      () => js(`!!document.querySelector('.select-popup[data-open]')`),
      "theme picker",
    );
    await js(
      `[...document.querySelectorAll('.select-popup[data-open] [role="option"]')].find(e=>e.querySelector('.select-option-label')?.textContent===${JSON.stringify(label)}).click();true`,
    );
    await waitFor(
      () => js(`!document.querySelector('.select-popup[data-open]')`),
      "theme selected",
    );
  };
  try {
    await fillDraft("切换模型和皮肤时保留这段草稿");
    await click("打开账号菜单");
    await click("设置");
    await waitFor(
      () => js(`!!document.querySelector('.settings-nav')`),
      "settings navigation",
    );
    await js(
      `window.settingsNavigationNode=document.querySelector('.settings-nav');true`,
    );
    await assertPage("settings", "账号与偏好");
    await go("models", "模型与服务");
    assert.equal(
      await js(
        `document.querySelector('.settings-content h1').textContent.trim()`,
      ),
      "模型与服务",
    );
    await capture("settings-navigation-models-light.png");
    await go("skins", "皮肤中心");
    await capture("settings-navigation-skins-light.png");
    await js(`document.querySelector('.settings-page').scrollTop=500;true`);
    await waitFor(
      () => js(`document.querySelector('.settings-page').scrollTop>=490`),
      "skin catalog scrolls",
    );
    assert.equal(
      await js(
        `(()=>{const n=document.querySelector('.settings-nav').getBoundingClientRect(),m=document.querySelector('.main-content').getBoundingClientRect();return n.top>=m.top-1&&n.top<=m.top+2;})()`,
      ),
      true,
      "navigation stays visible while catalog scrolls",
    );
    await js("history.back();true");
    await assertPage("models", "模型与服务");
    await js("history.forward();true");
    await assertPage("skins", "皮肤中心");
    await click("对话");
    await waitFor(
      () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
      "conversation retained",
    );
    assert.equal(
      await js(`document.querySelector('[aria-label="任务输入"]').value`),
      "切换模型和皮肤时保留这段草稿",
    );
    await fillDraft("");
    await click("打开账号菜单");
    await click("设置");
    await waitFor(
      () => js(`!!document.querySelector('.settings-nav')`),
      "reopen settings",
    );
    await js(
      `window.settingsNavigationNode=document.querySelector('.settings-nav');true`,
    );
    await go("skins", "皮肤中心");
    win.webContents.reload();
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.settings-nav')&&!document.querySelector('.entry-experience')`,
        ),
      "direct skins route after reload",
    );
    await js(
      `window.settingsNavigationNode=document.querySelector('.settings-nav');true`,
    );
    await assertPage("skins", "皮肤中心");
    await go("settings", "账号与偏好");
    await theme("深色");
    await waitFor(
      () => js(`document.documentElement.dataset.theme==='dark'`),
      "actual dark settings theme",
    );
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 900);
    await go("models", "模型与服务");
    await capture("settings-navigation-models-dark-narrow.png");
    await go("skins", "皮肤中心");
    await capture("settings-navigation-skins-dark-narrow.png");
    await go("settings", "账号与偏好");
    await theme(
      prior.settings.theme === "dark"
        ? "深色"
        : prior.settings.theme === "light"
          ? "浅色"
          : "默认（浅色）",
    );
    await js(
      `[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.trim()==='导出本地记录').click();true`,
    );
    await waitFor(async () => {
      try {
        return (
          JSON.parse(await fs.readFile(exportFile, "utf8")).format ===
          "corporate-brain-local-v1"
        );
      } catch {
        return false;
      }
    }, "native settings export");
    const exported = JSON.parse(await fs.readFile(exportFile, "utf8"));
    assert.equal(exported.format, "corporate-brain-local-v1");
    assert.deepEqual(exported.state.installed, []);
    assert.ok(Array.isArray(exported.state.conversations));
    await assertPage("settings", "账号与偏好");
    await click("对话");
    await waitFor(
      () => js(`!!document.querySelector('[aria-label="任务输入"]')`),
      "return to conversation",
    );
    checks.push(
      "Shared settings navigation: account/model/skin routes retain the same visible menu and active state; rail highlights all settings routes, long catalog keeps menu visible, history and direct reload work, nonempty conversation draft survives page switches, real native export produces a valid backup, dark 700px layouts fit; disposable fixtures only",
    );
  } finally {
    dialog.showSaveDialog = originalSave;
    await fs.rm(exportFile, { force: true });
    win.setMinimumSize(...originalMinimum);
    win.setContentSize(...originalSize);
  }
};
