const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("forzaDash", {
  getLatestTelemetry: () => ipcRenderer.invoke("telemetry:getLatest"),
  onTelemetry: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("telemetry:update", listener);
    return () => ipcRenderer.removeListener("telemetry:update", listener);
  },
});
