export interface DesktopAPI {
  getBackendURL(): string;
  setBackendURL(url: string): void;
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  deleteToken(): Promise<void>;
  selectFile(): Promise<{ path: string; content: string } | null>;
  saveFile(file: { name: string; content: string }): Promise<boolean>;
  openExternal(url: string): void;
  getAppVersion(): string;
}

export const IPC_CHANNELS = {
  GET_BACKEND_URL: 'config:getBackendURL',
  SET_BACKEND_URL: 'config:setBackendURL',
  GET_TOKEN: 'secure:getToken',
  SET_TOKEN: 'secure:setToken',
  DELETE_TOKEN: 'secure:deleteToken',
  SELECT_FILE: 'dialog:selectFile',
  SAVE_FILE: 'dialog:saveFile',
  OPEN_EXTERNAL: 'shell:openExternal',
  GET_APP_VERSION: 'app:getVersion'
} as const;

declare global {
  interface Window {
    xensembleDesktopAPI: DesktopAPI;
  }
}

export {};
