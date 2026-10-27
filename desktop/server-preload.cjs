const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("companyConnection", {
  canConfigure:
    process.env.BRAIN_VERIFY === "1" || process.env.BRAIN_ADMIN_SETUP === "1",
  showLegal: () => ipcRenderer.invoke("company:legal"),
  connect: (url) => ipcRenderer.invoke("company:connect", url),
});
