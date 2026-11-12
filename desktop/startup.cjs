const { WebContentsView, ipcMain } = require("electron");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { readAppearance } = require("./appearance.cjs");
const page = join(__dirname, "startup.html");
const pageUrl = pathToFileURL(page).href;
const sessions = new WeakMap();
const entryContexts = new WeakMap();

function isStartupSender(owner, event) {
  const wc = sessions.get(owner)?.view.webContents;
  return (
    !!wc &&
    !wc.isDestroyed() &&
    event.sender === wc &&
    event.senderFrame === wc.mainFrame &&
    event.senderFrame.url.split("?")[0] === pageUrl
  );
}
function connectionFailure(error) {
  const code =
    String(`${error?.code || ""} ${error?.message || "ERR_FAILED"}`).match(
      /(?:ERR_[A-Z_]+|HTTP_\d{3})/,
    )?.[0] || "ERR_FAILED";
  if (/CERT|SSL/.test(code))
    return {
      code,
      retry: false,
      detail: "安全证书验证失败，请联系管理员检查服务器证书和电脑时间。",
    };
  if (/NAME_NOT_RESOLVED/.test(code))
    return {
      code,
      retry: true,
      detail: "无法解析公司服务地址，请检查网络、DNS 或代理连接。",
    };
  if (/INTERNET_DISCONNECTED/.test(code))
    return {
      code,
      retry: true,
      detail: "当前网络已断开，恢复连接后会再次尝试。",
    };
  if (/TIMED_OUT/.test(code))
    return {
      code,
      retry: true,
      detail: "连接等待超时，可能是网络较慢或服务暂时不可达。",
    };
  if (/HTTP_/.test(code))
    return {
      code,
      retry: !/HTTP_4/.test(code),
      detail: "公司服务器暂时无法提供页面，请稍后重试或联系管理员。",
    };
  return {
    code,
    retry: true,
    detail: "连接被中断或服务暂时不可达，请检查网络或代理后重试。",
  };
}

async function loadCompanyWindow(
  owner,
  address,
  {
    timeoutMs = 20000,
    maxAttempts = 3,
    retryDelayMs = 2000,
    preview = false,
  } = {},
) {
  sessions.get(owner)?.dispose();
  if (owner.isDestroyed()) return;
  // Ordinary launches have no intro, including when an older server is loaded.
  const context = { startedAt: Date.now(), skipped: !preview };
  entryContexts.set(owner, context);
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, "startup-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: process.env.BRAIN_VERIFY === "1",
      backgroundThrottling: false,
    },
  });
  const theme = readAppearance(address);
  view.setBackgroundColor(theme === "dark" ? "#0b0b0c" : "#e5e3df");
  let disposed = false,
    skipped = !preview,
    cancelAttempt,
    wakeDelay;
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const active = () => !disposed && !owner.isDestroyed();
  const send = (state) => {
    session.state = state;
    if (active() && !view.webContents.isDestroyed())
      view.webContents.send("startup:state", state);
  };
  const resize = () => {
    if (active()) {
      const [width, height] = owner.getContentSize();
      view.setBounds({ x: 0, y: 0, width, height });
    }
  };
  const session = {
    view,
    state: {},
    skip() {
      skipped = true;
      context.skipped = true;
      if (preview || session.state.phase === "ready") session.dispose();
      else send({ ...session.state, skipped: true });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      cancelAttempt?.();
      wakeDelay?.();
      owner.removeListener("resize", resize);
      owner.removeListener("closed", session.dispose);
      if (!owner.isDestroyed()) owner.contentView.removeChildView(view);
      if (!owner.isDestroyed()) owner.webContents.focus();
      if (!view.webContents.isDestroyed()) view.webContents.close();
      if (sessions.get(owner) === session) sessions.delete(owner);
    },
  };
  sessions.set(owner, session);
  owner.contentView.addChildView(view);
  resize();
  owner.on("resize", resize);
  owner.once("closed", session.dispose);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  try {
    await view.webContents.loadFile(page, {
      query: {
        theme,
        version: require("./package.json").version,
        startedAt: String(context.startedAt),
        preview: preview ? "1" : "0",
      },
    });
    if (!active()) return;
    view.setBackgroundColor("#00000000");
    view.webContents.focus();
    if (preview) {
      send({
        phase: "preview",
        detail: "启动动画预览 · 外观跟随你的设置",
        attempt: 0,
      });
      return;
    }
    for (let attempt = 1; active() && attempt <= maxAttempts; attempt++) {
      send({
        phase: "connecting",
        attempt,
        maxAttempts,
        skipped,
        detail: "正在建立安全连接，页面就绪后自动进入。",
      });
      try {
        await new Promise((resolve, reject) => {
          const wc = owner.webContents;
          let settled = false,
            committed = false;
          const finish = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            timers.delete(timer);
            ipcMain.removeListener("startup:painted", painted);
            wc.removeListener("did-fail-load", failed);
            wc.removeListener("did-navigate", navigated);
            cancelAttempt = null;
            error ? reject(error) : resolve();
          };
          const failed = (_event, _code, description, _url, main) => {
            if (main && description !== "ERR_ABORTED")
              finish(new Error(description));
          };
          const navigated = (_event, url, status) => {
            if (new URL(url).origin !== new URL(address).origin)
              finish(new Error("ERR_UNSAFE_REDIRECT"));
            else if (status >= 400) finish(new Error(`HTTP_${status}`));
            else committed = true;
          };
          const painted = (event) => {
            if (
              !committed ||
              event.sender !== wc ||
              event.senderFrame !== wc.mainFrame ||
              new URL(event.senderFrame.url).origin !== new URL(address).origin
            )
              return;
            finish();
          };
          const timer = later(
            () => finish(new Error("ERR_TIMED_OUT")),
            timeoutMs,
          );
          cancelAttempt = () => finish(new Error("ERR_ABORTED"));
          ipcMain.on("startup:painted", painted);
          wc.on("did-fail-load", failed);
          wc.on("did-navigate", navigated);
          wc.loadURL(address).catch(finish);
        });
        if (!active()) return;
        send({ phase: "ready", attempt, skipped, detail: "工作空间已就绪" });
        session.dispose();
        return;
      } catch (error) {
        if (!active()) return;
        owner.webContents.stop();
        const failure = connectionFailure(error);
        const retry = failure.retry && attempt < maxAttempts;
        send({
          phase: retry ? "retrying" : "error",
          attempt,
          maxAttempts,
          ...failure,
          skipped,
        });
        if (!retry) return;
        await new Promise((resolve) => {
          wakeDelay = resolve;
          later(resolve, retryDelayMs * attempt);
        });
        wakeDelay = null;
      }
    }
  } catch (error) {
    if (!active()) return;
    session.dispose();
    throw error;
  }
}
function skipStartup(owner) {
  sessions.get(owner)?.skip();
}
function startupState(owner) {
  return sessions.get(owner)?.state;
}
module.exports = {
  loadCompanyWindow,
  isStartupSender,
  skipStartup,
  startupState,
  connectionFailure,
  entryContext: (owner) =>
    entryContexts.get(owner) || { startedAt: Date.now(), skipped: false },
};
