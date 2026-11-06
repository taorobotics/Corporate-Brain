const { contextBridge, ipcRenderer } = require("electron");
let expanded = false;
function applyWindowAppearance() {
  if (!document.documentElement) return;
  document.documentElement.dataset.desktop = process.platform;
  document.documentElement.dataset.windowExpanded = String(expanded);
}
ipcRenderer.on("window:appearance", (_event, state) => {
  expanded = state.expanded === true;
  applyWindowAppearance();
});
window.addEventListener("DOMContentLoaded", applyWindowAppearance, {
  once: true,
});
// Signal usable content without waiting for images, fonts or the load event.
// This also supports older company UIs during a rolling server/client update.
window.addEventListener(
  "DOMContentLoaded",
  () => {
    let signaled = false;
    const painted = () => {
      const root = document.getElementById("root");
      if (
        signaled ||
        (root ? !root.childElementCount : !document.body?.childElementCount)
      )
        return;
      signaled = true;
      observer.disconnect();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => ipcRenderer.send("startup:painted")),
      );
    };
    const observer = new MutationObserver(painted);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    painted();
  },
  { once: true },
);
contextBridge.exposeInMainWorld("brainDesktop", {
  retryStartup: () => ipcRenderer.invoke("startup:retry"),
  readAppearance: () => ipcRenderer.invoke("appearance:read"),
  entryContext: () => ipcRenderer.invoke("entry:context"),
  writeAppearance: (theme) => ipcRenderer.invoke("appearance:write", theme),
  previewStartup: () => ipcRenderer.invoke("startup:preview"),
  allowBootstrap: process.env.BRAIN_VERIFY === "1",
  canChangeServer:
    process.env.BRAIN_VERIFY === "1" || process.env.BRAIN_ADMIN_SETUP === "1",
  updates: {
    state: () => ipcRenderer.invoke("updates:state"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    cancel: () => ipcRenderer.invoke("updates:cancel"),
    install: () => ipcRenderer.invoke("updates:install"),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("updates:state", listener);
      return () => ipcRenderer.removeListener("updates:state", listener);
    },
  },
  edit: (action) => ipcRenderer.send("edit:action", action),
  production: {
    state: (id) => ipcRenderer.invoke("production:state", id),
    chooseDirectory: (id) => ipcRenderer.invoke("production:choose", id),
    collect: (id, task) => ipcRenderer.invoke("production:collect", id, task),
    preview: (id, task, path) =>
      ipcRenderer.invoke("production:preview", id, task, path),
    open: (id, task) => ipcRenderer.invoke("production:open", id, task),
    reveal: (id, task, path) =>
      ipcRenderer.invoke("production:reveal", id, task, path),
  },
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),
  readState: (id) => ipcRenderer.invoke("local:read", id),
  writeState: (id, data) => ipcRenderer.invoke("local:write", id, data),
  selectFiles: () => ipcRenderer.invoke("files:select"),
  selectDirectory: () => ipcRenderer.invoke("directory:select"),
  inspectWorkspace: (folder) => ipcRenderer.invoke("workspace:inspect", folder),
  changeServer: () => ipcRenderer.invoke("company:setup"),
  saveFile: (name, content, base64) =>
    ipcRenderer.invoke("file:save", name, content, base64),
  windowAction: (action) => ipcRenderer.send("window:action", action),
  onMenu: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },
});
