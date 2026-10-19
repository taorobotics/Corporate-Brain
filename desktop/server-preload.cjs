const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("companyConnection", {
  showLegal: () => ipcRenderer.invoke("company:legal"),
  connect: (url) => ipcRenderer.invoke("company:connect", url),
});
