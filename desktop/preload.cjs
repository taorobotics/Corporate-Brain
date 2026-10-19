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
contextBridge.exposeInMainWorld("brainDesktop", {
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
  readState: (id) => ipcRenderer.invoke("local:read", id),
  writeState: (id, data) => ipcRenderer.invoke("local:write", id, data),
  selectFiles: () => ipcRenderer.invoke("files:select"),
  selectDirectory: () => ipcRenderer.invoke("directory:select"),
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
