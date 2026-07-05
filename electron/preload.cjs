const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pyquest", {
  loadProgress: () => ipcRenderer.invoke("progress:load"),
  saveProgress: (data) => ipcRenderer.invoke("progress:save", data),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  provideStdinLine: (id, text) => ipcRenderer.invoke("stdin:provide", { id, text }),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  openReleasePage: () => ipcRenderer.invoke("update:openReleasePage"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateProgress: (callback) => {
    const listener = (_evt, data) => callback(data);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
});
