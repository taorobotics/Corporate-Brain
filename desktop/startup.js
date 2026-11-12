const query = new URLSearchParams(location.search);
const theme = query.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
const preview = query.get("preview") === "1";
let scene;
if (preview) {
  document.body.prepend(
    document.getElementById("animation-template").content.cloneNode(true),
  );
  scene = document.getElementById("scene");
  document.body.classList.add("animation-preview");
  document.getElementById("connection").hidden = true;
  document.getElementById("skip").hidden = false;
  scene.setAttribute("theme", theme);
  scene.addEventListener("entry-intro-end", () =>
    document.body.classList.add("intro-done"),
  );
  scene.start(
    Math.max(0, Date.now() - Number(query.get("startedAt") || Date.now())),
  );
}
let lastState = {},
  previewTimers = [];
function cancelPreview() {
  for (const timer of previewTimers) clearTimeout(timer);
  previewTimers = [];
}
window.startup.onState((state) => {
  lastState = state;
  // The underlying web UI continues the same timeline. A painted document is
  // not yet an authenticated workspace, so never show a fake success here.
  if (state.phase === "ready") return;
  cancelPreview();
  scene?.setAttribute(
    "phase",
    state.phase === "preview" ? "connecting" : state.phase,
  );
  scene?.setAttribute(
    "headline",
    state.phase === "connecting" ? "正在打开公司大脑" : "",
  );
  scene?.setAttribute("detail", state.detail || "");
  if (state.phase === "error" || state.skipped) scene?.skip();
  document.getElementById("connection-title").textContent =
    state.phase === "error" ? "暂时无法连接公司服务器" : "正在连接公司工作空间";
  document.getElementById("connection-detail").textContent = state.detail || "";
  document.getElementById("actions").hidden = state.phase !== "error";
  document.getElementById("retry").disabled = false;
  document.getElementById("error-code").textContent = state.code
    ? `连接信息：${state.code}`
    : "";
  document.getElementById("skip").hidden =
    !preview || state.phase === "error" || !!state.skipped;
  if (state.phase === "preview") {
    for (const [delay, phase, headline] of [
      [4400, "profile", "准备你的工作空间"],
      [6800, "ready", ""],
    ])
      previewTimers.push(
        setTimeout(() => {
          scene.setAttribute("phase", phase);
          scene.setAttribute("headline", headline);
          scene.setAttribute("detail", "动效预览 · 未进行账号验证");
        }, delay),
      );
  }
});
document.getElementById("retry").addEventListener("click", async () => {
  document.getElementById("retry").disabled = true;
  try {
    await window.startup.retry();
  } catch {
    document.getElementById("retry").disabled = false;
  }
});
document.getElementById("skip").addEventListener("click", () => {
  cancelPreview();
  scene?.skip();
  document.getElementById("skip").hidden = true;
  window.startup.skip();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && preview) document.getElementById("skip").click();
});
window.addEventListener("online", () => {
  if (lastState.phase === "error" && lastState.retry)
    document.getElementById("retry").click();
});
for (const action of ["minimize", "maximize", "close"])
  document
    .getElementById(action)
    .addEventListener("click", () => window.startup.action(action));
window.addEventListener("pagehide", cancelPreview);
