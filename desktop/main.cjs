const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  shell,
} = require("electron");
const { DesktopUpdates } = require("./updates.cjs");
const {
  loadCompanyWindow,
  isStartupSender,
  skipStartup,
  startupState,
  entryContext,
} = require("./startup.cjs");
const { readAppearance, writeAppearance } = require("./appearance.cjs");
const { basename, join, relative } = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { createHash } = require("node:crypto");
let win;
// Relaunching a packaged client restores its existing window instead of
// competing for the same local profile in a second hidden process.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on("second-instance", () => {
  const existing = win && !win.isDestroyed() ? win : setupWindow;
  if (!existing || existing.isDestroyed()) return;
  if (existing.isMinimized()) existing.restore();
  existing.show();
  existing.focus();
});
let updater,
  installing = false;
function readCompanyAddress(file) {
  try {
    const value = JSON.parse(fsSync.readFileSync(file, "utf8")).url;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}
let address = process.env.BRAIN_APP_URL || "";
if (!address)
  address = readCompanyAddress(
    join(app.getPath("userData"), "company-server.json"),
  );
if (!address && app.isPackaged)
  address = readCompanyAddress(
    join(process.resourcesPath, "company-server.json"),
  );
if (!address && !app.isPackaged) address = "http://127.0.0.1:4173";
function validateAddress(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("公司服务地址需要 HTTPS，本机服务可使用 HTTP");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("请填写公司服务根地址，不包含账号、路径或查询参数");
  return url.origin;
}
let origin = address ? validateAddress(address) : "";
let setupWindow;
let legalWindow;
ipcMain.handle("company:legal", (event) => {
  const expected = require("node:url").pathToFileURL(
    join(__dirname, "server-setup.html"),
  ).href;
  if (
    !setupWindow ||
    event.sender !== setupWindow.webContents ||
    event.senderFrame !== setupWindow.webContents.mainFrame ||
    event.senderFrame.url !== expected
  )
    throw new Error("未授权窗口");
  if (legalWindow && !legalWindow.isDestroyed()) {
    legalWindow.focus();
    return;
  }
  legalWindow = new BrowserWindow({
    width: 850,
    height: 700,
    show: process.env.BRAIN_VERIFY !== "1",
    autoHideMenuBar: true,
    title: "隐私与许可",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: process.env.BRAIN_VERIFY === "1",
    },
  });
  legalWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  legalWindow.webContents.on("will-navigate", (event) =>
    event.preventDefault(),
  );
  return legalWindow.loadFile(join(__dirname, "legal.html"));
});
let lastVerifiedUser = null;
const writes = new Map();
const LOCAL_PROFILE_TIMEOUT_MS = 10_000;

function timeoutError(message) {
  return new Error(message);
}

function waitWithTimeout(promise, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(timeoutError(message)),
      LOCAL_PROFILE_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sender(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    !event.senderFrame ||
    event.senderFrame !== win.webContents.mainFrame ||
    new URL(event.senderFrame.url).origin !== origin
  )
    throw new Error("未授权窗口");
}
async function profile(event, userId) {
  sender(event);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("员工标识无效");
  let response;
  try {
    response = await win.webContents.session.fetch(`${origin}/api/auth/me`, {
      credentials: "include",
      signal: AbortSignal.timeout(LOCAL_PROFILE_TIMEOUT_MS),
    });
  } catch (error) {
    if (lastVerifiedUser !== userId)
      throw new Error(
        "公司服务器验证超时，本机记录未读取，请检查网络后重试。",
        {
          cause: error,
        },
      );
  }
  if (response) {
    if (!response.ok) {
      lastVerifiedUser = null;
      throw new Error("登录无效");
    }
    const actor = await response.json();
    if (actor.id !== userId) {
      lastVerifiedUser = null;
      throw new Error("账号与本地空间不匹配");
    }
    lastVerifiedUser = actor.id;
  }
  const accountDir = createHash("sha256")
    .update(`${origin}:${userId}`)
    .digest("hex");
  const dir = join(app.getPath("userData"), "profiles", accountDir);
  await fs.mkdir(dir, { recursive: true });
  return join(dir, "state.json");
}
ipcMain.handle("local:read", async (event, userId) => {
  const file = await profile(event, userId);
  await waitWithTimeout(
    writes.get(file) || Promise.resolve(),
    "本机记录仍在保存，请稍后重试。",
  );
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
});
ipcMain.handle("local:write", async (event, userId, data) => {
  const file = await profile(event, userId);
  if (
    !data ||
    !Array.isArray(data.conversations) ||
    !Array.isArray(data.drafts)
  )
    throw new Error("记录格式无效");
  const json = JSON.stringify({
    conversations: data.conversations,
    drafts: data.drafts,
    projects: data.projects,
    installed: data.installed,
    settings: data.settings,
  });
  if (Buffer.byteLength(json) > 50 * 1024 * 1024)
    throw new Error("本地记录超过当前容量限制，请导出归档");
  const pending = (writes.get(file) || Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const temp = `${file}.tmp`;
      await fs.writeFile(temp, json, { mode: 0o600 });
      await fs.rename(temp, file);
    });
  writes.set(file, pending);
  await pending;
});
ipcMain.handle("files:select", async (event) => {
  sender(event);
  const selected = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "文本与图片",
        extensions: ["txt", "md", "csv", "json", "png", "jpg", "jpeg", "webp"],
      },
    ],
  });
  if (selected.canceled) return [];
  const files = [];
  for (const path of selected.filePaths.slice(0, 8)) {
    const stat = await fs.stat(path);
    if (stat.size > 2 * 1024 * 1024) throw new Error("单个文件请小于 2MB");
    const name = require("node:path").basename(path);
    if (!/\.(txt|md|csv|json|png|jpe?g|webp)$/i.test(name))
      throw new Error("该格式的解析尚未接通，请选择文本或图片文件");
    const imageType = /\.(png|jpe?g|webp)$/i.exec(name)?.[1];
    const bytes = await fs.readFile(path);
    files.push(
      imageType
        ? {
            name,
            content: "",
            image: `data:image/${imageType.toLowerCase() === "jpg" ? "jpeg" : imageType.toLowerCase()};base64,${bytes.toString("base64")}`,
          }
        : { name, content: bytes.toString("utf8") },
    );
  }
  return files;
});
ipcMain.handle("directory:select", async (event) => {
  sender(event);
  const selected = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
  });
  return selected.canceled ? null : selected.filePaths[0];
});
const workspaceText =
  /\.(?:txt|md|markdown|csv|json|ya?ml|js|jsx|ts|tsx|css|html?|xml|py|java|go|rs|sql|sh|ps1|toml|ini|conf|log)$/i;
const workspaceImage = /\.(png|jpe?g|webp|gif)$/i;
const ignoredWorkspaceDirectories = new Set([
  ".git",
  ".cache",
  ".data",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "release",
]);
const WORKSPACE_MAX_FILES = 48;
const WORKSPACE_MAX_TEXT_BYTES = 1_600_000;
const WORKSPACE_MAX_IMAGE_BYTES = 1_000_000;
const WORKSPACE_MAX_TOTAL_BYTES = 3_500_000;
async function inspectWorkspace(rootPath) {
  if (typeof rootPath !== "string" || !rootPath.trim())
    throw new Error("工作区目录无效，请重新选择目录");
  const root = await fs.realpath(rootPath);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory())
    throw new Error("工作区路径不是目录，请重新选择");
  const files = [];
  let totalBytes = 0;
  let skipped = 0;
  let truncated = false;
  async function walk(current) {
    if (
      files.length >= WORKSPACE_MAX_FILES ||
      totalBytes >= WORKSPACE_MAX_TOTAL_BYTES
    ) {
      truncated = true;
      return;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (
        files.length >= WORKSPACE_MAX_FILES ||
        totalBytes >= WORKSPACE_MAX_TOTAL_BYTES
      ) {
        truncated = true;
        return;
      }
      if (entry.name === "." || entry.name === "..") continue;
      if (entry.isDirectory()) {
        if (
          ignoredWorkspaceDirectories.has(entry.name) ||
          entry.name.startsWith(".")
        ) {
          skipped += 1;
          continue;
        }
        await walk(join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        skipped += 1;
        continue;
      }
      const fullPath = join(current, entry.name);
      const name = relative(root, fullPath).replaceAll("\\", "/");
      const imageMatch = workspaceImage.exec(entry.name);
      if (!workspaceText.test(entry.name) && !imageMatch) {
        skipped += 1;
        continue;
      }
      const stat = await fs.stat(fullPath);
      const limit = imageMatch
        ? WORKSPACE_MAX_IMAGE_BYTES
        : WORKSPACE_MAX_TEXT_BYTES;
      if (
        stat.size > limit ||
        totalBytes + stat.size > WORKSPACE_MAX_TOTAL_BYTES
      ) {
        skipped += 1;
        truncated = true;
        continue;
      }
      const bytes = await fs.readFile(fullPath);
      totalBytes += bytes.length;
      if (imageMatch) {
        const extension = imageMatch[1].toLowerCase();
        const mime =
          extension === "jpg" || extension === "jpeg" ? "jpeg" : extension;
        files.push({
          name,
          size: bytes.length,
          content: "",
          image: `data:image/${mime};base64,${bytes.toString("base64")}`,
        });
      } else {
        files.push({
          name,
          size: bytes.length,
          content: bytes.toString("utf8"),
        });
      }
    }
  }
  await walk(root);
  return { root: basename(root), files, skipped, truncated };
}
ipcMain.handle("workspace:inspect", async (event, rootPath) => {
  sender(event);
  return inspectWorkspace(rootPath);
});
ipcMain.handle("file:save", async (event, name, content, base64) => {
  sender(event);
  if (
    typeof content !== "string" ||
    content.length > 80 * 1024 * 1024 ||
    typeof name !== "string"
  )
    throw new Error("保存内容无效或过大");
  const selected = await dialog.showSaveDialog(win, {
    defaultPath: name.replace(/[\\/:*?"<>|]/g, "_"),
  });
  if (selected.canceled || !selected.filePath) return false;
  await fs.writeFile(
    selected.filePath,
    base64 ? Buffer.from(content, "base64") : content,
  );
  return true;
});
ipcMain.on("window:action", (event, action) => {
  if (!isStartupSender(win, event)) sender(event);
  if (action === "minimize") win.minimize();
  else if (action === "maximize") {
    if (win.isFullScreen()) win.setFullScreen(false);
    else win.isMaximized() ? win.unmaximize() : win.maximize();
  } else if (action === "close") win.close();
});
ipcMain.handle("startup:retry", (event) => {
  if (!isStartupSender(win, event)) throw new Error("未授权窗口");
  if (startupState(win)?.phase !== "error") return;
  void loadCompanyWindow(win, address).catch(console.error);
});
ipcMain.on("startup:skip", (event) => {
  if (isStartupSender(win, event)) skipStartup(win);
});
ipcMain.handle("appearance:read", (event) => {
  sender(event);
  return readAppearance(origin);
});
ipcMain.handle("entry:context", (event) => {
  sender(event);
  return entryContext(win);
});
ipcMain.handle("appearance:write", (event, theme) => {
  sender(event);
  writeAppearance(origin, theme);
});
ipcMain.handle("startup:preview", (event) => {
  sender(event);
  return loadCompanyWindow(win, address, { preview: true });
});
ipcMain.on("edit:action", (event, action) => {
  sender(event);
  const commands = {
    undo: () => win.webContents.undo(),
    redo: () => win.webContents.redo(),
    cut: () => win.webContents.cut(),
    copy: () => win.webContents.copy(),
    paste: () => win.webContents.paste(),
    selectAll: () => win.webContents.selectAll(),
  };
  if (Object.hasOwn(commands, action)) commands[action]();
});
ipcMain.handle("company:setup", (event) => {
  sender(event);
  if (process.env.BRAIN_VERIFY !== "1" && process.env.BRAIN_ADMIN_SETUP !== "1")
    throw new Error("公司服务器由管理员统一配置");
  openServerSetup();
});
for (const [channel, method] of [
  ["state", "snapshot"],
  ["check", "check"],
  ["download", "download"],
  ["cancel", "cancel"],
]) {
  ipcMain.handle(`updates:${channel}`, (event) => {
    sender(event);
    if (installing) throw new Error("安装程序正在准备，请稍后");
    return updater[method]();
  });
}
ipcMain.handle("updates:install", async (event) => {
  sender(event);
  if (installing) return false;
  if (!app.isPackaged)
    throw new Error("开发预览中不运行安装程序，请使用已打包客户端");
  if (updater.state.status !== "ready") throw new Error("请先下载并校验更新");
  installing = true;
  const owner = win,
    updates = updater,
    company = origin;
  try {
    const { response } = await dialog.showMessageBox(owner, {
      type: "question",
      title: "更新公司大脑",
      message: `安装 v${updates.state.release.version}？`,
      detail:
        process.platform === "darwin"
          ? "将打开已校验的 DMG。请退出公司大脑后，将新版拖入 Applications 替换。本地对话与个人草稿保留在原设备。"
          : "本地记录保存完成后将退出客户端并打开安装向导。请按向导完成更新，再重新打开公司大脑。",
      buttons: [
        process.platform === "darwin" ? "打开安装包" : "退出并安装",
        "稍后",
      ],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return false;
    if (win !== owner || origin !== company)
      throw new Error("公司连接已变化，请重新下载更新");
    const actor = await owner.webContents.session.fetch(
      `${company}/api/auth/me`,
      {
        credentials: "include",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!actor.ok) throw new Error("请重新登录后安装更新");
    await Promise.all([...writes.values()]);
    const path = await updates.verify();
    const error = await shell.openPath(path);
    if (error) throw new Error("系统未能打开安装包，请稍后重试");
    if (process.platform === "win32") app.quit();
    return true;
  } finally {
    installing = false;
  }
});
function createMainWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 820,
    minHeight: 640,
    show: process.env.BRAIN_VERIFY !== "1",
    frame: process.platform !== "win32",
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: readAppearance(origin) === "dark" ? "#0b0b0c" : "#e5e3df",
    title: "公司大脑",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: process.env.BRAIN_VERIFY === "1",
      devTools: !app.isPackaged,
    },
  });
  const owner = win,
    company = origin;
  updater = new DesktopUpdates({
    version: require("./package.json").version,
    platform: process.platform,
    arch: process.arch,
    directory: join(app.getPath("userData"), "updates"),
    request: (path, options) =>
      owner.webContents.session.fetch(`${company}${path}`, {
        ...options,
        credentials: "include",
        redirect: "error",
      }),
    notify: (state) => {
      if (win === owner && !owner.isDestroyed())
        owner.webContents.send("updates:state", state);
    },
  });
  const publishWindowAppearance = () => {
    if (owner.isDestroyed()) return;
    owner.webContents.send("window:appearance", {
      expanded: owner.isMaximized() || owner.isFullScreen(),
    });
  };
  win.webContents.on("did-finish-load", publishWindowAppearance);
  for (const event of [
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
  ]) {
    win.on(event, publishWindowAppearance);
  }
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, next) => {
    if (new URL(next).origin !== company) event.preventDefault();
  });
  win.webContents.on("will-redirect", (event, next) => {
    if (new URL(next).origin !== company) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  const menu = [
    {
      label: "文件",
      submenu: [
        {
          label: "新建任务",
          accelerator: "CmdOrCtrl+N",
          click: () => win.webContents.send("menu:action", "new"),
        },
        {
          label: "导出本地记录",
          click: () => win.webContents.send("menu:action", "export"),
        },
        {
          label: "导入本地记录",
          click: () => win.webContents.send("menu:action", "import"),
        },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        {
          label: "切换侧栏",
          click: () => win.webContents.send("menu:action", "sidebar"),
        },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "检查更新…",
          click: () => win.webContents.send("menu:action", "updates"),
        },
        {
          label: "使用帮助",
          click: () => win.webContents.send("menu:action", "help"),
        },
        {
          label: "隐私与许可",
          click: () => win.webContents.send("menu:action", "legal"),
        },
      ],
    },
  ];
  if (process.platform === "darwin")
    menu.unshift({
      label: "公司大脑",
      submenu: [{ role: "about" }, { role: "quit" }],
    });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  if (process.platform === "win32") win.setMenuBarVisibility(false);
  void loadCompanyWindow(win, address).catch(console.error);
}
function openServerSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 540,
    height: 560,
    show: process.env.BRAIN_VERIFY !== "1",
    resizable: false,
    roundedCorners: true,
    autoHideMenuBar: true,
    title: "连接公司大脑",
    backgroundColor: "#f4f2ed",
    webPreferences: {
      preload: join(__dirname, "server-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: process.env.BRAIN_VERIFY === "1",
    },
  });
  setupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  setupWindow.webContents.on("will-navigate", (event) =>
    event.preventDefault(),
  );
  setupWindow.loadFile(join(__dirname, "server-setup.html"));
}
ipcMain.handle("company:connect", async (event, value) => {
  if (process.env.BRAIN_VERIFY !== "1" && process.env.BRAIN_ADMIN_SETUP !== "1")
    throw new Error("请使用管理员预配置的安装包");
  if (
    !setupWindow ||
    event.sender !== setupWindow.webContents ||
    event.senderFrame.url !==
      require("node:url").pathToFileURL(join(__dirname, "server-setup.html"))
        .href
  )
    throw new Error("未授权配置窗口");
  try {
    if (typeof value !== "string" || value.length > 300)
      throw new Error("服务地址无效");
    const nextOrigin = validateAddress(value);
    const response = await require("electron").net.fetch(
      `${nextOrigin}/api/health`,
      { signal: AbortSignal.timeout(10000), redirect: "error" },
    );
    const health = await response.json();
    if (!response.ok || health.chatStorage !== "device-only")
      throw new Error("地址不是可用的公司大脑服务器");
    if (installing) throw new Error("安装程序正在准备，请稍后切换公司服务器");
    await updater?.cancel();
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await fs.writeFile(
      join(app.getPath("userData"), "company-server.json"),
      JSON.stringify({ url: nextOrigin }),
      { mode: 0o600 },
    );
    const previous = win;
    address = nextOrigin;
    origin = nextOrigin;
    lastVerifiedUser = null;
    // Let the setup renderer receive its IPC reply before replacing the window.
    const configuredWindow = setupWindow;
    setTimeout(() => {
      createMainWindow();
      previous?.close();
      if (!configuredWindow.isDestroyed()) configuredWindow.close();
    }, 200);
    return { ok: true };
  } catch (error) {
    return { error: error.message || "连接失败，请检查地址或网络" };
  }
});
app.whenReady().then(() => (address ? createMainWindow() : openServerSetup()));
app.on("window-all-closed", () => app.quit());
