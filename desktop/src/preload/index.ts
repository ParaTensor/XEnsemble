import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';

contextBridge.exposeInMainWorld('xensembleDesktopAPI', {
  getBackendURL: () => ipcRenderer.sendSync(IPC_CHANNELS.GET_BACKEND_URL),
  setBackendURL: (url: string) => ipcRenderer.send(IPC_CHANNELS.SET_BACKEND_URL, url),
  getToken: () => ipcRenderer.invoke(IPC_CHANNELS.GET_TOKEN),
  setToken: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_TOKEN, token),
  deleteToken: () => ipcRenderer.invoke(IPC_CHANNELS.DELETE_TOKEN),
  selectFile: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FILE),
  saveFile: (file: { name: string; content: string }) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FILE, file),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  getAppVersion: () => ipcRenderer.sendSync(IPC_CHANNELS.GET_APP_VERSION)
});
