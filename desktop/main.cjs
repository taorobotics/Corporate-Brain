const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const { join } = require("node:path");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
let win;
let address = process.env.BRAIN_APP_URL || "";
if (!address) {
  try {
    address = JSON.parse(
      require("node:fs").readFileSync(
        join(app.getPath("userData"), "company-server.json"),
        "utf8",
      ),
    ).url;
  } catch {}
}
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
let lastVerifiedUser = null;
const writes = new Map();
function sender(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    !event.senderFrame ||
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
    });
  } catch (error) {
    if (lastVerifiedUser !== userId) throw error;
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
  await writes.get(file);
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
  sender(event);
  if (action === "minimize") win.minimize();
  else if (action === "maximize")
    win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === "close") win.close();
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
  openServerSetup();
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
    backgroundColor: "#fbfaf8",
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
  const publishWindowAppearance = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("window:appearance", {
      expanded: win.isMaximized() || win.isFullScreen(),
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
    if (new URL(next).origin !== origin) event.preventDefault();
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
          label: "使用帮助",
          click: () => win.webContents.send("menu:action", "help"),
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
  win.loadURL(address);
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
