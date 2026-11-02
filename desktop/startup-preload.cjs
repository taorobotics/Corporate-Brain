const { contextBridge, ipcRenderer } = require("electron");
window.addEventListener(
  "DOMContentLoaded",
  () => {
    document.documentElement.dataset.desktop = process.platform;
  },
  { once: true },
);
contextBridge.exposeInMainWorld("startup", {
  retry: () => ipcRenderer.invoke("startup:retry"),
  skip: () => ipcRenderer.send("startup:skip"),
  action: (action) => ipcRenderer.send("window:action", action),
  onState: (callback) =>
    ipcRenderer.on("startup:state", (_event, state) => callback(state)),
});
