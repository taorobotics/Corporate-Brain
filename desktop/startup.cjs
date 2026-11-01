const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const page = join(__dirname, "startup.html");
const pageUrl = pathToFileURL(page).href;
const attempts = new WeakMap();

function isStartupSender(owner, event) {
  return (
    !!owner &&
    !owner.isDestroyed() &&
    event.sender === owner.webContents &&
    event.senderFrame === owner.webContents.mainFrame &&
    event.senderFrame.url.split("?")[0] === pageUrl
  );
}

async function loadCompanyWindow(owner, address, { timeoutMs = 15000 } = {}) {
  const attempt = {};
  attempts.set(owner, attempt);
  const active = () => !owner.isDestroyed() && attempts.get(owner) === attempt;
  let timer;
  const closed = () => clearTimeout(timer);
  owner.once("closed", closed);
  try {
    // A local page paints immediately and remains visible while the remote
    // navigation waits for the company server. No artificial splash delay.
    await owner.loadFile(page);
    if (!active()) return;
    // Commit one local frame before starting navigation, so even a cold
    // Chromium renderer has something to display while the network waits.
    let paintTimer;
    await Promise.race([
      owner.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
      ),
      new Promise((resolve) => {
        paintTimer = setTimeout(resolve, 250);
      }),
    ]).finally(() => clearTimeout(paintTimer));
    if (!active()) return;
    await Promise.race([
      owner.loadURL(address),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Company connection timed out")),
          timeoutMs,
        );
      }),
    ]);
  } catch {
    if (active()) {
      owner.webContents.stop();
      await owner.loadFile(page, { query: { state: "error" } }).catch(() => {});
    }
  } finally {
    clearTimeout(timer);
    owner.removeListener("closed", closed);
  }
}
module.exports = { loadCompanyWindow, isStartupSender };
