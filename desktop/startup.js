const error = new URLSearchParams(location.search).get("state") === "error";
if (error) {
  document.getElementById("title").textContent =
    "客户端已打开，暂时无法连接公司服务器";
  document.getElementById("detail").textContent =
    "请检查网络后重新连接。你的本地对话和草稿仍保留在此设备。";
  document.getElementById("activity").hidden = true;
  document.getElementById("actions").hidden = false;
}
document.getElementById("retry").addEventListener("click", async (event) => {
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "正在连接…";
  try {
    await window.brainDesktop.retryStartup();
  } catch {
    const button = document.getElementById("retry");
    button.disabled = false;
    button.textContent = "重新连接";
  }
});
for (const [id, action] of [
  ["close", "close"],
  ["exit", "close"],
  ["minimize", "minimize"],
])
  document
    .getElementById(id)
    .addEventListener("click", () => window.brainDesktop.windowAction(action));
