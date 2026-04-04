const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ramCleaner", {
  getRam: () => ipcRenderer.invoke("get-ram"),
  clearRamCache: () => ipcRenderer.invoke("clear-ram-cache"),
  getProcesses: () => ipcRenderer.invoke("get-processes"),
  endProcess: (pid) => ipcRenderer.invoke("end-process", pid),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (next) => ipcRenderer.invoke("set-settings", next),
});

contextBridge.exposeInMainWorld("windowControls", {
  minimize: () => ipcRenderer.invoke("win-minimize"),
  toggleMaximize: () => ipcRenderer.invoke("win-toggle-maximize"),
  close: () => ipcRenderer.invoke("win-close"),
  isMaximized: () => ipcRenderer.invoke("win-is-maximized"),
  onMaximizedChanged: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, maximized) => handler(Boolean(maximized));
    ipcRenderer.on("win-maximized-changed", listener);
    return () => ipcRenderer.removeListener("win-maximized-changed", listener);
  },
});
