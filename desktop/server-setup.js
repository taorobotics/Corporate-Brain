document.querySelector("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("button");
  const error = document.querySelector(".error");
  error.textContent = "";
  button.disabled = true;
  try {
    const result = await window.companyConnection.connect(
      document.querySelector("input").value,
    );
    if (result.error) error.textContent = result.error;
  } catch {
    error.textContent = "连接失败，请检查地址或网络。";
  } finally {
    button.disabled = false;
  }
});
