const assert = require("node:assert/strict");

module.exports = async ({ js, click, waitFor, capture, win, checks }) => {
  const web = win.webContents,
    originalSize = win.getContentSize(),
    originalMinimum = win.getMinimumSize();
  const width = () =>
    js(
      `Math.round(document.querySelector('.employee-app .sidebar').getBoundingClientRect().width)`,
    );
  const readyWidth = (n) =>
    waitFor(
      async () => Math.abs((await width()) - n) <= 1,
      `sidebar width ${n}`,
    );
  const handle = () =>
    js(
      `(()=>{const r=document.querySelector('.sidebar-resize-handle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+200};})()`,
    );
  const mouse = (type, x, y, options = {}) =>
    web.debugger.sendCommand("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      ...options,
    });
  async function dragTo(target, cancel = false) {
    const p = await handle(),
      start = await width();
    await mouse("mouseMoved", p.x, p.y);
    await mouse("mousePressed", p.x, p.y, {
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await waitFor(
      () => js(`!!document.querySelector('.sidebar[data-resizing]')`),
      "real pointer starts resize",
    );
    await mouse("mouseMoved", p.x + target - start, p.y, {
      button: "left",
      buttons: 1,
    });
    if (cancel)
      await js(
        `document.querySelector('.sidebar-resize-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true`,
      );
    await mouse("mouseReleased", p.x + target - start, p.y, {
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await waitFor(
      () =>
        js(`!document.documentElement.classList.contains('sidebar-resizing')`),
      "resize releases pointer and selection",
    );
  }
  const key = (key) =>
    js(
      `document.querySelector('.sidebar-resize-handle').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}));true`,
    );
  async function menu(label) {
    await click("视图");
    await waitFor(
      () => js(`!!document.querySelector('.top-menu-popup[data-open]')`),
      "view menu open",
    );
    await click(label);
    await waitFor(
      () => js(`!document.querySelector('.top-menu-popup[data-open]')`),
      "view menu closed",
    );
  }
  const actor = await js(`fetch('/api/auth/me').then(r=>r.json())`);
  try {
    await js(
      `(()=>{const e=document.querySelector('[aria-label="任务输入"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'调整侧栏时保留这段草稿');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
    await dragTo(320);
    await readyWidth(320);
    assert.equal(
      await js(`document.querySelector('[aria-label="任务输入"]').value`),
      "调整侧栏时保留这段草稿",
    );
    assert.equal(
      await js(
        `document.querySelector('.sidebar-resize-handle').getAttribute('aria-valuenow')`,
      ),
      "320",
    );
    await dragTo(390, true);
    await readyWidth(320);
    await dragTo(100);
    await readyWidth(170);
    await dragTo(600);
    await readyWidth(420);
    await key("ArrowLeft");
    await readyWidth(410);
    await key("ArrowRight");
    await readyWidth(420);
    await key("Home");
    await readyWidth(170);
    await key("End");
    await readyWidth(420);
    await key("Enter");
    await readyWidth(198);
    await menu("加宽对话侧栏");
    await readyWidth(222);
    await menu("缩窄对话侧栏");
    await readyWidth(198);
    await dragTo(320);
    await readyWidth(320);
    const p = await handle();
    for (const count of [1, 2]) {
      await mouse("mousePressed", p.x, p.y, {
        button: "left",
        buttons: 1,
        clickCount: count,
      });
      await mouse("mouseReleased", p.x, p.y, {
        button: "left",
        buttons: 0,
        clickCount: count,
      });
    }
    await readyWidth(198);
    await dragTo(320);
    await readyWidth(320);
    await capture("sidebar-resized-wide.png");
    await waitFor(
      () =>
        js(
          `window.brainDesktop.readState(${JSON.stringify(actor.id)}).then(s=>s.settings.sidebarWidth===320)`,
        ),
      "width saved in current native account profile",
    );
    web.reload();
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.sidebar-resize-handle')&&!document.querySelector('.entry-experience')`,
        ),
      "profile reloaded",
    );
    await readyWidth(320);
    await key("End");
    await readyWidth(420);
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 900);
    await waitFor(
      () =>
        js(
          `document.querySelector('.sidebar-resize-handle').getAttribute('aria-valuemax')==='286'`,
        ),
      "narrow width limit updates",
    );
    await readyWidth(286);
    assert.equal(
      await js(
        `document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.main-content').getBoundingClientRect().width>=360`,
      ),
      true,
    );
    await capture("sidebar-resized-narrow.png");
    win.setContentSize(...originalSize);
    await readyWidth(420);
    await menu("恢复侧栏默认宽度");
    await readyWidth(198);
    await waitFor(
      () =>
        js(
          `window.brainDesktop.readState(${JSON.stringify(actor.id)}).then(s=>s.settings.sidebarWidth===undefined)`,
        ),
      "default sidebar width persisted",
    );
    checks.push(
      "Resizable conversation sidebar: real captured pointer drags beyond handle, min/max limits, Escape rollback, double-click reset, keyboard and single-click menu alternatives, input draft preserved, native per-account preference survives reload, narrow window clamps without overwriting wide preference",
    );
  } finally {
    win.setMinimumSize(...originalMinimum);
    win.setContentSize(...originalSize);
  }
};
