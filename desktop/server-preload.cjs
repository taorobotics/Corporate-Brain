const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("companyConnection", {
  connect: (url) => ipcRenderer.invoke("company:connect", url),
});
