const form = document.querySelector("#server-form");
const locked = document.querySelector("#locked-setup");
const adminButton = document.querySelector("#show-admin");
const connectButton = document.querySelector("#connect-button");
const error = document.querySelector(".error");

document
  .querySelector("#show-legal")
  .addEventListener("click", () => window.companyConnection.showLegal());

if (window.companyConnection.canConfigure === true) {
  adminButton.hidden = false;
  adminButton.addEventListener("click", () => {
    locked.hidden = true;
    adminButton.hidden = true;
    form.hidden = false;
    document.querySelector("#server-url").focus();
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  connectButton.disabled = true;
  connectButton.textContent = "正在检查公司入口…";
  try {
    const result = await window.companyConnection.connect(
      document.querySelector("#server-url").value,
    );
    if (result.error) error.textContent = result.error;
  } catch {
    error.textContent = "连接失败，请检查地址或网络。";
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = "保存公司入口";
  }
});
