const assert = require("node:assert/strict");
module.exports = async function ({
  js,
  click,
  request,
  waitFor,
  capture,
  key,
  checks,
  win,
  service,
}) {
  const models = [
    ...service.models,
    ...Array.from({ length: 28 }, (_, i) => ({
      model: `synthetic-picker-${String(i + 1).padStart(2, "0")}`,
      kind: "chat",
    })),
  ];
  const save = (items) =>
    request("/model-services", {
      provider: service.provider,
      name: service.name,
      baseUrl: service.baseUrl,
      serviceId: service.id,
      departments: service.departments,
      models: items,
    });
  const open = async () => {
    await click("选择模型");
    await waitFor(
      () => js(`!!document.querySelector('.model-picker-popup[data-open]')`),
      "provider menu open",
    );
  };
  try {
    await save(models);
    await js(`location.hash='chat';location.reload()`);
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.composer')&&!document.querySelector('.entry-experience')`,
        ),
      "picker chat ready",
    );
    await open();
    assert.equal(
      await js(
        `document.querySelectorAll('[data-provider-id="provider:linoroute"]').length`,
      ),
      1,
    );
    const point = await js(
      `(()=>{const r=document.querySelector('[data-provider-id="provider:linoroute"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point,
    });
    await waitFor(
      () => js(`!!document.querySelector('.model-picker-submenu[data-open]')`),
      "hover opens model submenu",
    );
    const wide = await js(
      `(()=>{const p=document.querySelector('.model-picker-popup').getBoundingClientRect(),s=document.querySelector('.model-picker-submenu').getBoundingClientRect();return {right:p.right,left:s.left,scrollable:document.querySelector('.model-picker-submenu .select-list').scrollHeight>document.querySelector('.model-picker-submenu .select-list').clientHeight}})()`,
    );
    assert.ok(wide.left >= wide.right - 2, JSON.stringify(wide));
    assert.equal(wide.scrollable, true);
    await capture("model-picker-provider-light.png");
    const connections = (await request("/connections")).filter(
      (c) => c.serviceId === service.id && c.enabled,
    );
    const chosen = connections.find((c) => c.model === service.models[1].model);
    await js(
      `document.querySelector('[data-connection-id="${chosen.id}"]').click()`,
    );
    await waitFor(
      () => js(`!document.querySelector('.model-picker-popup')`),
      "submenu selection closes menu",
    );
    await js(`location.reload()`);
    await waitFor(
      () =>
        js(
          `document.querySelector('[aria-label="选择模型"]')?.title===${JSON.stringify(chosen.name)}&&!document.querySelector('.entry-experience')`,
        ),
      "provider choice persists",
    );
    await open();
    await js(
      `document.querySelector('[data-provider-id="provider:linoroute"]').focus()`,
    );
    await key("ArrowRight");
    await waitFor(
      () => js(`!!document.querySelector('.model-picker-submenu[data-open]')`),
      "keyboard opens submenu",
    );
    assert.equal(
      await js(
        `document.querySelector('[data-connection-id="${chosen.id}"]').getAttribute('aria-checked')`,
      ),
      "true",
    );
    await key("Escape");
    await key("Escape");
    win.setContentSize(900, 760);
    await open();
    await js(
      `document.querySelector('[data-provider-id="provider:linoroute"]').click()`,
    );
    await waitFor(
      () => js(`!!document.querySelector('.model-picker-submenu[data-open]')`),
      "click opens narrow submenu",
    );
    await capture("model-picker-provider-narrow.png");
    assert.equal(
      await js(
        `[...document.querySelectorAll('.model-picker-popup,.model-picker-submenu')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})`,
      ),
      true,
    );
    await key("Escape");
    await key("Escape");
    await require("./verify-model-services.cjs")({
      js,
      waitFor,
      capture,
      key,
      checks,
      win,
      request,
      service,
      models,
    });
    checks.push(
      "Provider model menu: one LinoRoute row, real pointer hover opens right submenu, 30-model list scrolls, chosen connection persists with radio mark, keyboard and click opening work, narrow collision stays inside viewport",
    );
  } finally {
    win.setContentSize(1586, 992);
    await save(service.models);
    await js(`location.hash='admin-models';location.reload()`);
    await waitFor(
      () =>
        js(
          `!!document.querySelector('.model-service-list')&&!document.querySelector('.entry-experience')`,
        ),
      "picker fixture restored",
    );
  }
};
