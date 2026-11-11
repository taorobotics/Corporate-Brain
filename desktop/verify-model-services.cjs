const assert = require("node:assert/strict");

module.exports = async ({
  js,
  waitFor,
  capture,
  checks,
  win,
  request,
  service,
  models,
}) => {
  const minimum = win.getMinimumSize();
  const actor = await request("/auth/me");
  const prior = await js(
    `window.brainDesktop.readState(${JSON.stringify(actor.id)})`,
  );
  const setTheme = async (label, expected) => {
    await js(`location.hash='settings'`);
    await waitFor(
      () => js(`!!document.querySelector('[aria-label="外观"]')`),
      "appearance settings",
    );
    await js(`document.querySelector('[aria-label="外观"]').click()`);
    await waitFor(
      () => js(`!!document.querySelector('.select-popup[data-open]')`),
      "appearance options",
    );
    await js(
      `[...document.querySelectorAll('.select-popup[data-open] [role="option"]')].find(e=>e.querySelector('.select-option-label')?.textContent===${JSON.stringify(label)}).click()`,
    );
    await waitFor(
      () =>
        js(
          `document.documentElement.dataset.theme===${JSON.stringify(expected)}&&!document.querySelector('.select-popup[data-open]')`,
        ),
      "actual settings appearance applied",
    );
  };
  const group = `.provider-connection-group[data-provider-id="provider:linoroute"]`;
  const openPage = async () => {
    await js(`location.hash='models'`);
    await waitFor(
      () => js(`!!document.querySelector(${JSON.stringify(group)})`),
      "provider settings list",
    );
    assert.equal(
      await js(
        `document.querySelectorAll('.provider-connection-group[open]').length`,
      ),
      0,
    );
    assert.equal(
      await js(`document.querySelectorAll(${JSON.stringify(group)}).length`),
      1,
    );
    assert.equal(
      await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(group)});return Math.round(e.getBoundingClientRect().height-e.querySelector('summary').getBoundingClientRect().height)})()`,
      ),
      2,
    );
    assert.equal(
      await js(
        `document.querySelectorAll(${JSON.stringify(group + " .connection-card")}).length`,
      ),
      models.length,
    );
    assert.equal(
      await js(
        `document.querySelectorAll('.service-model-details[open]').length`,
      ),
      0,
    );
  };
  try {
    win.setContentSize(1586, 992);
    await openPage();
    await capture("model-services-providers-collapsed.png");
    await js(
      `document.querySelector(${JSON.stringify(group + " > summary")}).focus()`,
    );
    for (const type of ["keyDown", "keyUp"])
      await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        ...(type === "keyDown" ? { text: "\r" } : {}),
      });
    await waitFor(
      () => js(`document.querySelector(${JSON.stringify(group)}).open`),
      "keyboard expands provider",
    );
    await capture("model-services-provider-expanded.png");
    const chosen = (await request("/connections")).find(
      (c) => c.serviceId === service.id && c.model === service.models[0].model,
    );
    await js(
      `document.querySelector(${JSON.stringify(group + ' [data-connection-id="' + chosen.id + '"] button')}).click()`,
    );
    await waitFor(
      async () =>
        (await js(`window.brainDesktop.readState(${JSON.stringify(actor.id)})`))
          .settings.model === chosen.id,
      "settings model choice saved",
    );
    await js(`location.hash='chat'`);
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="选择模型"]')?.title===${JSON.stringify(chosen.name)}`,
        ),
      "settings choice used by chat",
    );
    await setTheme("深色", "dark");
    await openPage();
    win.setMinimumSize(600, 600);
    win.setContentSize(700, 900);
    await js(
      `document.querySelector(${JSON.stringify(group + " > summary")}).click()`,
    );
    await waitFor(
      () => js(`document.querySelector(${JSON.stringify(group)}).open`),
      "pointer expands dark narrow provider",
    );
    assert.equal(
      await js(
        `document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.settings-page').scrollWidth<=document.querySelector('.settings-page').clientWidth`,
      ),
      true,
    );
    await capture("model-services-provider-dark-narrow.png");
    await js(
      `document.querySelector(${JSON.stringify(group + " > summary")}).click()`,
    );
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(group)}).open`),
      false,
    );
    checks.push(
      "Model services: supplier rows start collapsed with all 30 models preserved; keyboard and pointer expand/collapse, selection persists and is used in chat; personal model tags collapsed, dark 700px settings has no horizontal overflow; image skill selection covered separately",
    );
  } finally {
    await setTheme(
      prior.settings.theme === "dark"
        ? "深色"
        : prior.settings.theme === "light"
          ? "浅色"
          : "默认（浅色）",
      prior.settings.theme === "dark" ? "dark" : "light",
    );
    win.setMinimumSize(...minimum);
    win.setContentSize(1586, 992);
  }
};
