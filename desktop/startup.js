const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme =
  query.get("theme") === "dark" ? "dark" : "light";
const root = document.getElementById("dsh-startup-root");
const byId = (id) => document.getElementById(id);
byId("version").textContent = `REV ${query.get("version") || ""}`;
let lastState = {};
window.startup.onState((state) => {
  lastState = state;
  root.dataset.phase = state.phase;
  if (state.skipped) root.classList.add("skipped");
  const titles = {
    connecting: "正在打开公司大脑",
    retrying: "连接中断，正在自动重试",
    error: "暂时无法连接公司服务器",
    ready: "工作空间已就绪",
    preview: "欢迎进入公司大脑",
  };
  byId("title").textContent = titles[state.phase] || titles.connecting;
  byId("detail").textContent = state.detail;
  byId("phase").textContent = {
    connecting: "SECURE CONNECTION",
    retrying: "RECONNECTING",
    error: "CONNECTION PAUSED",
    ready: "WORKSPACE READY",
    preview: "STARTUP PREVIEW",
  }[state.phase];
  byId("step").textContent =
    state.phase === "ready" ? "[ 02 / 02 ] READY" : "[ 01 / 02 ] CONNECTING";
  byId("attempt").textContent = state.attempt
    ? `连接尝试 ${state.attempt} / ${state.maxAttempts || state.attempt}`
    : "预览 · 随时跳过";
  byId("error-code").textContent = state.code ? `连接信息：${state.code}` : "";
  byId("actions").hidden = state.phase !== "error";
  byId("retry").disabled = false;
  byId("skip").hidden = state.phase === "error" || !!state.skipped;
});
byId("retry").addEventListener("click", async () => {
  byId("retry").disabled = true;
  try {
    await window.startup.retry();
  } catch {
    byId("retry").disabled = false;
  }
});
byId("skip").addEventListener("click", () => {
  root.classList.add("skipped");
  byId("skip").hidden = true;
  window.startup.skip();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") byId("skip").click();
});
window.addEventListener("online", () => {
  if (lastState.phase === "error" && lastState.retry) byId("retry").click();
});
for (const action of ["minimize", "maximize", "close"])
  byId(action).addEventListener("click", () => window.startup.action(action));
