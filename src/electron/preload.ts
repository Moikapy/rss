import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  refreshFeeds: () => ipcRenderer.send("refresh-feeds"),
  onRefreshFeeds: (callback: () => void) => {
    ipcRenderer.on("refresh-feeds", callback);
    return () => ipcRenderer.removeListener("refresh-feeds", callback);
  },
  platform: process.platform,
  isElectron: true,
});