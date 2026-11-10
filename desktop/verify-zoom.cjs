const assert = require("node:assert/strict");

module.exports = async ({ js, win, waitFor, checks, selector, context }) => {
  const web = win.webContents;
  const modifier = process.platform === "darwin" ? 4 : 2;
  const original = await js(
    `document.querySelector(${JSON.stringify(selector)}).value`,
  );
  async function press(key, code, virtual, modifiers = modifier) {
    const names = [
      [1, "alt"],
      [2, "control"],
      [4, "meta"],
      [8, "shift"],
    ]
      .filter(([flag]) => modifiers & flag)
      .map(([, name]) => name);
    const keyCode =
      { NumpadAdd: "numadd", NumpadSubtract: "numsub", Numpad0: "num0" }[
        code
      ] || key;
    if (code.startsWith("Numpad")) names.push("iskeypad", "numlock");
    // DevTools key dispatch bypasses Electron's before-input-event. Exercise
    // the native input route, including application accelerators, instead.
    web.sendInputEvent({ type: "keyDown", keyCode, modifiers: names });
    web.sendInputEvent({ type: "keyUp", keyCode, modifiers: names });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const reset = async () => {
    await press("0", "Digit0", 48);
    await waitFor(
      async () => Math.abs(web.getZoomFactor() - 1) < 0.001,
      "reset actual page zoom",
    );
  };
  await js(`document.querySelector(${JSON.stringify(selector)}).focus();true`);
  try {
    await reset();
    const initial = await js(`({ratio:devicePixelRatio,width:innerWidth})`);
    for (const [key, code, vk, extra] of [
      ["=", "Equal", 187, 0],
      ["+", "Equal", 187, 8],
      ["+", "NumpadAdd", 107, 0],
    ]) {
      await press(key, code, vk, modifier + extra);
      await waitFor(
        async () => web.getZoomFactor() > 1,
        "native zoom-in shortcut",
      );
      assert.ok(
        web.getZoomFactor() < 1.11,
        "each keypress zooms once without the menu applying a second step",
      );
      await waitFor(
        () =>
          js(
            `devicePixelRatio > ${initial.ratio} && innerWidth < ${initial.width}`,
          ),
        "whole page actually scales",
      );
      await reset();
    }
    for (const [key, code, vk] of [
      ["-", "Minus", 189],
      ["-", "NumpadSubtract", 109],
    ]) {
      await press(key, code, vk);
      await waitFor(
        async () => web.getZoomFactor() < 1,
        "native zoom-out shortcut",
      );
      assert.ok(web.getZoomFactor() > 0.9);
      await press("0", "Numpad0", 96);
      await waitFor(
        async () => Math.abs(web.getZoomFactor() - 1) < 0.001,
        "keypad zero resets zoom",
      );
    }
    if (process.platform === "darwin") {
      await press("=", "Equal", 187, 2);
      await waitFor(
        async () => web.getZoomFactor() > 1,
        "Mac also accepts requested Control alias",
      );
      await reset();
    }
    await press("=", "Equal", 187, modifier + 1);
    assert.ok(
      Math.abs(web.getZoomFactor() - 1) < 0.001,
      "Alt/AltGr combinations are not intercepted",
    );
    assert.equal(
      await js(`document.querySelector(${JSON.stringify(selector)}).value`),
      original,
      "zoom shortcuts preserve focused input",
    );
    checks.push(
      `Native page zoom (${context}): actual Control/Command + Plus, Equal, Minus, keypad add/subtract/zero and reset; page pixel ratio/viewport scale, exactly one step per key, focused input preserved, AltGr excluded`,
    );
  } finally {
    await reset();
  }
};
