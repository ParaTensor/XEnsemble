# XEnsembleDesktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Electron desktop client for XEnsemble that connects to a remote backend (`xensemble.dev` by default), reusing the existing XEnsemble React client code.

**Architecture:** An Electron shell with a minimal main process, a tiny preload bridge, and a renderer process that hosts the XEnsemble React UI. The renderer is adapted to read the configurable backend URL instead of hard-coded `localhost:3000`. No local server, no local database, no local PTY.

**Tech Stack:** Electron 39+, `electron-vite` 3+, TypeScript (main/preload), React 18 + Vite 5 + Tailwind 3 (renderer, reused from XEnsemble), `electron-builder` 26+, `electron-store` (config), Electron `safeStorage` (secure token storage).

---

## File Structure

```
XEnsembleDesktop/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── electron-builder.config.ts
├── README.md
├── resources/
│   ├── icon.icns
│   ├── icon.ico
│   └── icon.png
└── src/
    ├── main/
    │   ├── index.ts              # app bootstrap, single-instance, lifecycle
    │   ├── app/
    │   │   ├── window.ts         # BrowserWindow factory
    │   │   ├── menu.ts           # application menu
    │   │   └── protocol.ts       # app:// custom scheme
    │   ├── services/
    │   │   ├── config.ts         # backend URL + user settings
    │   │   └── secureStore.ts    # keychain token storage
    │   └── ipc/
    │       └── handlers.ts       # ipcMain handlers
    ├── preload/
    │   └── index.ts              # contextBridge API
    ├── renderer/
    │   ├── index.html            # entry HTML
    │   ├── main.tsx              # React mount
    │   ├── index.css             # Tailwind entry
    │   ├── lib/
    │   │   └── api.ts            # unified backend URL helpers
    │   ├── App.jsx               # copied from XEnsemble client
    │   ├── pages/                # copied from XEnsemble client
    │   ├── components/           # copied from XEnsemble client
    │   └── hooks/                # copied from XEnsemble client
    └── shared/
        └── ipc.ts                # typed IPC contracts
```

> **Note on client reuse:** The XEnsemble `client/` source is copied into `src/renderer/` for this first version. This lets us replace every hard-coded `http://localhost:3000` with a configurable backend URL without modifying the upstream XEnsemble repo. Future iterations can switch to a git submodule or shared package once the API surface is stable.

---

## Prerequisite

Confirm the XEnsemble backend is reachable. For local development:

```bash
cd /Users/xinference/github/XEnsemble/server
npm install
npm run dev
# backend should be running on http://localhost:3000
```

All `fetch` calls in this plan should ultimately point to the configured backend (default `https://xensemble.dev` in production, override to `http://localhost:3000` for dev).

---

## Task 1: Initialize `package.json`

**Files:**
- Create: `package.json`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "xensembledesktop",
  "version": "0.1.0",
  "description": "XEnsemble Desktop client",
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-builder",
    "package:dir": "electron-builder --dir",
    "postinstall": "electron-builder install-app-deps"
  },
  "dependencies": {
    "@base-ui/react": "^1.5.0",
    "@fontsource-variable/noto-sans": "^5.2.10",
    "@fontsource-variable/playfair-display": "^5.2.8",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/xterm": "^5.5.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "electron-store": "^10.0.0",
    "lucide-react": "^0.300.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.0",
    "shadcn": "^4.10.0",
    "tailwind-merge": "^3.6.0",
    "tw-animate-css": "^1.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "electron": "^39.0.0",
    "electron-builder": "^26.0.0",
    "electron-vite": "^3.0.0",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: initialize package.json for Electron desktop client"
```

---

## Task 2: Install Dependencies

**Files:**
- Modify: `package-lock.json` (generated)

- [ ] **Step 1: Install**

```bash
npm install
```

Expected: `node_modules/` created, no install errors.

- [ ] **Step 2: Verify Electron**

```bash
npx electron --version
```

Expected: `v35.x.y` or compatible.

- [ ] **Step 3: Commit lockfile**

```bash
git add package-lock.json
git commit -m "chore: install dependencies"
```

---

## Task 3: TypeScript and Vite Configuration

**Files:**
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`

- [ ] **Step 1: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/*"],
      "@main/*": ["src/main/*"],
      "@preload/*": ["src/preload/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Write `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/main/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'src/main'),
        '@shared': path.resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/preload/index.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared')
      }
    }
  },
  renderer: {
    root: path.resolve(__dirname, 'src/renderer'),
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer')
      }
    },
    server: {
      port: 5173
    }
  }
})
```

- [ ] **Step 3: Create Tailwind config placeholders**

Create `src/renderer/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Create `tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {}
  },
  plugins: [require('tw-animate-css')]
}
```

Create `postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json electron.vite.config.ts tailwind.config.js postcss.config.js src/renderer/index.css
git commit -m "chore: configure TypeScript, electron-vite, and Tailwind"
```

---

## Task 4: Copy XEnsemble Client Source

**Files:**
- Create: all files under `src/renderer/` (copied from XEnsemble `client/src/`)

- [ ] **Step 1: Copy source**

```bash
mkdir -p src/renderer
cp -R /Users/xinference/github/XEnsemble/client/src/* src/renderer/
```

- [ ] **Step 2: Verify structure**

```bash
ls src/renderer/
```

Expected: `App.jsx`, `main.jsx`, `index.css`, `pages/`, `components/`, `hooks/`, `lib/`.

- [ ] **Step 3: Commit**

```bash
git add src/renderer
git commit -m "chore: copy XEnsemble client source into renderer"
```

---

## Task 5: Create Unified API Module

**Files:**
- Create: `src/renderer/lib/api.ts`
- Delete: `src/renderer/lib/api.js` (replaced by `api.ts`)

- [ ] **Step 1: Write `src/renderer/lib/api.ts`**

```ts
const DEFAULT_BACKEND_URL = 'https://xensemble.dev';

export function getBackendURL(): string {
  if (typeof window !== 'undefined' && (window as any).xensembleDesktopAPI) {
    return (window as any).xensembleDesktopAPI.getBackendURL() || DEFAULT_BACKEND_URL;
  }
  const host = window.location.hostname || 'localhost';
  const protocol = window.location.protocol || 'http:';
  return `${protocol}//${host}:3000`;
}

export function getApiBase(): string {
  return getBackendURL();
}

export function getWsUrl(sessionId: string): string {
  const base = getBackendURL();
  const wsProtocol = base.startsWith('https:') ? 'wss:' : 'ws:';
  const httpProtocolRemoved = base.replace(/^https?:/, '');
  return `${wsProtocol}${httpProtocolRemoved}/ws/v1/terminal?sessionId=${encodeURIComponent(sessionId)}`;
}

export function apiFetch(path: string, token: string | null, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${getApiBase()}${path}`, { ...options, headers });
}

export function publicFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${getApiBase()}${path}`, options);
}
```

- [ ] **Step 2: Remove old `api.js`**

```bash
rm src/renderer/lib/api.js
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/lib/api.ts
git rm src/renderer/lib/api.js
git commit -m "feat(renderer): add configurable backend URL helpers"
```

---

## Task 6: Adapt `PreviewPanel.jsx`

**Files:**
- Modify: `src/renderer/components/PreviewPanel.jsx`

- [ ] **Step 1: Update import**

Replace:

```js
import { apiFetch } from '../lib/api';
```

with:

```js
import { apiFetch } from '../lib/api.ts';
```

- [ ] **Step 2: Verify no other `localhost:3000` remains in this file**

```bash
grep -n 'localhost:3000' src/renderer/components/PreviewPanel.jsx || echo 'clean'
```

Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/PreviewPanel.jsx
git commit -m "refactor(renderer): use configurable apiFetch in PreviewPanel"
```

---

## Task 7: Adapt `Console.jsx`

**Files:**
- Modify: `src/renderer/pages/Console.jsx`

- [ ] **Step 1: Add import**

At the top of `src/renderer/pages/Console.jsx`, add:

```js
import { getApiBase } from '../lib/api.ts';
```

- [ ] **Step 2: Replace all `http://localhost:3000` with `${getApiBase()}`**

Run a targeted replacement for this file:

```bash
sed -i '' "s|'http://localhost:3000'|getApiBase()|g" src/renderer/pages/Console.jsx
```

Then verify no raw string remains:

```bash
grep -n 'localhost:3000' src/renderer/pages/Console.jsx || echo 'clean'
```

Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/Console.jsx
git commit -m "refactor(renderer): use configurable API base in Console"
```

---

## Task 8: Adapt `Login.jsx`

**Files:**
- Modify: `src/renderer/pages/Login.jsx`

- [ ] **Step 1: Add import**

```js
import { getApiBase } from '../lib/api.ts';
```

- [ ] **Step 2: Replace hard-coded base**

Find the fetch call that uses `http://localhost:3000${endpoint}` and replace with:

```js
const res = await fetch(`${getApiBase()}${endpoint}`, {
```

If the original line is:

```js
const res = await fetch(`http://localhost:3000${endpoint}`, {
```

replace with:

```js
const res = await fetch(`${getApiBase()}${endpoint}`, {
```

- [ ] **Step 3: Verify**

```bash
grep -n 'localhost:3000' src/renderer/pages/Login.jsx || echo 'clean'
```

Expected: `clean`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/pages/Login.jsx
git commit -m "refactor(renderer): use configurable API base in Login"
```

---

## Task 9: Adapt `AgentsAdmin.jsx`

**Files:**
- Modify: `src/renderer/pages/AgentsAdmin.jsx`

- [ ] **Step 1: Replace API constant**

Find:

```js
const API = 'http://localhost:3000';
```

Replace with:

```js
import { getApiBase } from '../lib/api.ts';
const API = getApiBase();
```

- [ ] **Step 2: Verify**

```bash
grep -n 'localhost:3000' src/renderer/pages/AgentsAdmin.jsx || echo 'clean'
```

Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/AgentsAdmin.jsx
git commit -m "refactor(renderer): use configurable API base in AgentsAdmin"
```

---

## Task 10: Adapt `UsersAdmin.jsx`

**Files:**
- Modify: `src/renderer/pages/UsersAdmin.jsx`

- [ ] **Step 1: Replace API constant**

Find:

```js
const API = 'http://localhost:3000';
```

Replace with:

```js
import { getApiBase } from '../lib/api.ts';
const API = getApiBase();
```

- [ ] **Step 2: Verify**

```bash
grep -n 'localhost:3000' src/renderer/pages/UsersAdmin.jsx || echo 'clean'
```

Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/UsersAdmin.jsx
git commit -m "refactor(renderer): use configurable API base in UsersAdmin"
```

---

## Task 11: Adapt Secrets Hooks

**Files:**
- Modify: `src/renderer/hooks/useSecrets.js`
- Modify: `src/renderer/hooks/usePlatformSecrets.js`

- [ ] **Step 1: Update `useSecrets.js`**

Add import:

```js
import { getApiBase } from '../lib/api.ts';
```

Replace `http://localhost:3000/api/v1/secrets` with `${getApiBase()}/api/v1/secrets` in both fetch calls.

- [ ] **Step 2: Update `usePlatformSecrets.js`**

Find:

```js
const API = 'http://localhost:3000';
```

Replace with:

```js
import { getApiBase } from '../lib/api.ts';
const API = getApiBase();
```

- [ ] **Step 3: Verify both files**

```bash
grep -n 'localhost:3000' src/renderer/hooks/useSecrets.js src/renderer/hooks/usePlatformSecrets.js || echo 'clean'
```

Expected: `clean`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/useSecrets.js src/renderer/hooks/usePlatformSecrets.js
git commit -m "refactor(renderer): use configurable API base in secrets hooks"
```

---

## Task 12: Adapt Settings Components

**Files:**
- Modify: `src/renderer/components/settings/GatewaySettingsPanel.jsx`
- Modify: `src/renderer/components/settings/GeneralSettingsPanel.jsx`
- Modify: `src/renderer/components/settings/AgentSettingsPanel.jsx`
- Modify: `src/renderer/components/settings/QuotaSettingsPanel.jsx`

- [ ] **Step 1: Replace API constants**

In each file, find:

```js
const API = 'http://localhost:3000';
```

or inline `fetch('http://localhost:3000/api/v1/...')` and replace with:

```js
import { getApiBase } from '../../lib/api.ts';
const API = getApiBase();
```

or inline `${getApiBase()}/api/v1/...`.

- [ ] **Step 2: Verify**

```bash
grep -rn 'localhost:3000' src/renderer/components/settings/ || echo 'clean'
```

Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/
git commit -m "refactor(renderer): use configurable API base in settings panels"
```

---

## Task 13: Adapt `AgentConsole.jsx` WebSocket

**Files:**
- Modify: `src/renderer/components/AgentConsole.jsx`

- [ ] **Step 1: Add import**

```js
import { getWsUrl } from '../lib/api.ts';
```

- [ ] **Step 2: Replace WebSocket construction**

Find:

```js
const wsHost = window.location.hostname || 'localhost';
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(
    `${wsProtocol}//${wsHost}:3000/ws/v1/terminal?sessionId=${encodeURIComponent(sessionId)}`
);
```

Replace with:

```js
const ws = new WebSocket(getWsUrl(sessionId));
```

- [ ] **Step 3: Verify**

```bash
grep -n 'localhost:3000' src/renderer/components/AgentConsole.jsx || echo 'clean'
```

Expected: `clean`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/AgentConsole.jsx
git commit -m "refactor(renderer): use configurable backend URL for terminal WebSocket"
```

---

## Task 14: Global Check for Remaining Hard-coded URLs

**Files:**
- Modify: any remaining files with `localhost:3000`

- [ ] **Step 1: Search**

```bash
grep -rn 'localhost:3000' src/renderer/ || echo 'clean'
```

- [ ] **Step 2: Fix any remaining occurrences**

For each file found, replace `http://localhost:3000` with `getApiBase()` using the same pattern as above.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(renderer): remove all remaining localhost:3000 references"
```

---

## Task 15: Shared IPC Types

**Files:**
- Create: `src/shared/ipc.ts`

- [ ] **Step 1: Write `src/shared/ipc.ts`**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/ipc.ts
git commit -m "feat(shared): add typed IPC contracts"
```

---

## Task 16: Config Service

**Files:**
- Create: `src/main/services/config.ts`

- [ ] **Step 1: Write `src/main/services/config.ts`**

```ts
import Store from 'electron-store';

interface ConfigSchema {
  backendURL: string;
}

const DEFAULT_BACKEND_URL = 'https://xensemble.dev';

const store = new Store<ConfigSchema>({
  defaults: {
    backendURL: DEFAULT_BACKEND_URL
  }
});

export function getBackendURL(): string {
  return store.get('backendURL', DEFAULT_BACKEND_URL);
}

export function setBackendURL(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  store.set('backendURL', trimmed);
}

export function getDefaultBackendURL(): string {
  return DEFAULT_BACKEND_URL;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/config.ts
git commit -m "feat(main): add config service for backend URL"
```

---

## Task 17: Secure Token Store Service

**Files:**
- Create: `src/main/services/secureStore.ts`

- [ ] **Step 1: Write `src/main/services/secureStore.ts`**

```ts
import { safeStorage } from 'electron';
import Store from 'electron-store';

interface SecureStoreSchema {
  token: string | null;
}

const store = new Store<SecureStoreSchema>({
  defaults: { token: null }
});

export function getToken(): string | null {
  const encrypted = store.get('token', null);
  if (!encrypted) return null;
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

export function setToken(token: string): void {
  const encrypted = safeStorage.encryptString(token).toString('base64');
  store.set('token', encrypted);
}

export function deleteToken(): void {
  store.set('token', null);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/secureStore.ts
git commit -m "feat(main): add secure token storage via Electron safeStorage"
```

---

## Task 18: IPC Handlers

**Files:**
- Create: `src/main/ipc/handlers.ts`

- [ ] **Step 1: Write `src/main/ipc/handlers.ts`**

```ts
import { ipcMain, dialog, shell, app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc';
import * as config from '@main/services/config';
import * as secureStore from '@main/services/secureStore';

export function registerIPCHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GET_BACKEND_URL, () => config.getBackendURL());

  ipcMain.handle(IPC_CHANNELS.SET_BACKEND_URL, (_event, url: string) => {
    config.setBackendURL(url);
  });

  ipcMain.handle(IPC_CHANNELS.GET_TOKEN, () => secureStore.getToken());
  ipcMain.handle(IPC_CHANNELS.SET_TOKEN, (_event, token: string) => {
    secureStore.setToken(token);
  });
  ipcMain.handle(IPC_CHANNELS.DELETE_TOKEN, () => secureStore.deleteToken());

  ipcMain.handle(IPC_CHANNELS.SELECT_FILE, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];
    const content = await readFile(filePath, 'utf-8');
    return { path: filePath, content };
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_FILE, async (_event, file: { name: string; content: string }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: file.name
    });
    if (canceled || !filePath) return false;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, file.content, 'utf-8');
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, (_event, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => app.getVersion());
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/ipc/handlers.ts
git commit -m "feat(main): register IPC handlers"
```

---

## Task 19: BrowserWindow Factory

**Files:**
- Create: `src/main/app/window.ts`

- [ ] **Step 1: Write `src/main/app/window.ts`**

```ts
import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadURL('app://renderer/index.html');
  }

  return mainWindow;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/app/window.ts
git commit -m "feat(main): add BrowserWindow factory"
```

---

## Task 20: Application Menu

**Files:**
- Create: `src/main/app/menu.ts`

- [ ] **Step 1: Write `src/main/app/menu.ts`**

```ts
import { Menu, BrowserWindow, dialog } from 'electron';
import * as config from '@main/services/config';

export function createMenu(mainWindow: BrowserWindow): Menu {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'XEnsemble',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as Electron.MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Backend',
      submenu: [
        {
          label: 'Set Backend URL',
          click: async () => {
            const current = config.getBackendURL();
            const { response: ok, checkboxChecked } = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              buttons: ['Change', 'Cancel'],
              defaultId: 1,
              title: 'Backend URL',
              message: `Current backend: ${current}`,
              detail: 'Use the Settings UI in the app to change the backend URL.'
            });
            if (ok === 0) {
              mainWindow.webContents.send('navigate-to-settings');
            }
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/app/menu.ts
git commit -m "feat(main): add application menu"
```

---

## Task 21: Custom Protocol for Production

**Files:**
- Create: `src/main/app/protocol.ts`

- [ ] **Step 1: Write `src/main/app/protocol.ts`**

```ts
import { app, protocol } from 'electron';
import path from 'node:path';

const SCHEME = 'app';

export function registerProtocol(): void {
  protocol.registerFileProtocol(SCHEME, (request, callback) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const basePath = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'out', 'renderer')
      : path.join(__dirname, '..', '..', 'renderer');
    const filePath = path.join(basePath, pathname);
    callback(filePath);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/app/protocol.ts
git commit -m "feat(main): register app:// protocol for production renderer"
```

---

## Task 22: Main Process Entry

**Files:**
- Create: `src/main/index.ts`

- [ ] **Step 1: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow, Menu, protocol } from 'electron';
import { createMainWindow } from '@main/app/window';
import { createMenu } from '@main/app/menu';
import { registerProtocol } from '@main/app/protocol';
import { registerIPCHandlers } from '@main/ipc/handlers';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let mainWindow: BrowserWindow | null = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerProtocol();
    registerIPCHandlers();

    mainWindow = createMainWindow();
    Menu.setApplicationMenu(createMenu(mainWindow));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        Menu.setApplicationMenu(createMenu(mainWindow));
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): add Electron main process bootstrap"
```

---

## Task 23: Preload Script

**Files:**
- Create: `src/preload/index.ts`

- [ ] **Step 1: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';

contextBridge.exposeInMainWorld('xensembleDesktopAPI', {
  getBackendURL: () => ipcRenderer.invoke(IPC_CHANNELS.GET_BACKEND_URL),
  setBackendURL: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_BACKEND_URL, url),
  getToken: () => ipcRenderer.invoke(IPC_CHANNELS.GET_TOKEN),
  setToken: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_TOKEN, token),
  deleteToken: () => ipcRenderer.invoke(IPC_CHANNELS.DELETE_TOKEN),
  selectFile: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FILE),
  saveFile: (file: { name: string; content: string }) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FILE, file),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION)
});
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose minimal desktop API to renderer"
```

---

## Task 24: Renderer Entry

**Files:**
- Create: `src/renderer/index.html`
- Modify: `src/renderer/main.jsx` (rename to `main.tsx`)

- [ ] **Step 1: Write `src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' app:; style-src 'self' 'unsafe-inline' app:; connect-src 'self' https: wss:; img-src 'self' data: blob: app:; font-src 'self' app:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>XEnsemble</title>
  </head>
  <body class="h-screen w-screen overflow-hidden">
    <div id="root" class="h-full w-full"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Rename and adapt `main.jsx` to `main.tsx`**

```bash
mv src/renderer/main.jsx src/renderer/main.tsx
```

Content stays the same (JSX is valid TSX):

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/Toast.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ToastProvider>
      <App />
    </ToastProvider>
  </BrowserRouter>
);
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html src/renderer/main.tsx
git rm --cached src/renderer/main.jsx || true
git commit -m "feat(renderer): add HTML entry and TypeScript React mount"
```

---

## Task 25: Build Configuration

**Files:**
- Create: `electron-builder.config.ts`

- [ ] **Step 1: Write `electron-builder.config.ts`**

```ts
import { defineConfig } from 'electron-builder';

export default defineConfig({
  appId: 'dev.xensemble.desktop',
  productName: 'XEnsemble',
  directories: {
    output: 'dist'
  },
  files: [
    'out/**/*',
    'resources/**/*'
  ],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    icon: 'resources/icon.icns'
  },
  win: {
    target: 'nsis',
    icon: 'resources/icon.ico'
  },
  linux: {
    target: 'AppImage',
    category: 'Development',
    icon: 'resources/icon.png'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
});
```

- [ ] **Step 2: Add placeholder icons**

Create empty placeholder files (replace with real icons before release):

```bash
mkdir -p resources
touch resources/icon.icns resources/icon.ico resources/icon.png
```

- [ ] **Step 3: Commit**

```bash
git add electron-builder.config.ts resources/
git commit -m "chore: add electron-builder config and placeholder icons"
```

---

## Task 26: Development Scripts and README

**Files:**
- Modify: `package.json` scripts section
- Create: `README.md`

- [ ] **Step 1: Update `package.json` scripts if needed**

Ensure scripts include:

```json
"scripts": {
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "package": "electron-builder",
  "package:dir": "electron-builder --dir",
  "postinstall": "electron-builder install-app-deps"
}
```

- [ ] **Step 2: Write `README.md`**

```markdown
# XEnsembleDesktop

Cross-platform desktop client for XEnsemble.

## Development

```bash
npm install
npm run dev
```

By default the app connects to `https://xensemble.dev`. For local development, start the XEnsemble server on `http://localhost:3000` and set the backend URL in the app settings.

## Build

```bash
npm run build
npm run package
```

## Project Structure

- `src/main/` — Electron main process
- `src/preload/` — Preload script / bridge
- `src/renderer/` — React UI (reused from XEnsemble web client)
- `src/shared/` — Shared IPC types
```

- [ ] **Step 3: Commit**

```bash
git add README.md package.json
git commit -m "docs: add README and finalize package scripts"
```

---

## Task 27: First Dev Run

**Files:**
- None (verification task)

- [ ] **Step 1: Run dev**

```bash
npm run dev
```

Expected: Electron window opens, app loads, shows login page.

- [ ] **Step 2: Verify backend URL**

Open DevTools (View → Toggle Developer Tools), run in console:

```js
await window.xensembleDesktopAPI.getBackendURL();
```

Expected: `"https://xensemble.dev"` (or your configured URL).

- [ ] **Step 3: Test login against local backend**

Start XEnsemble server locally on `http://localhost:3000`, then in app DevTools:

```js
await window.xensembleDesktopAPI.setBackendURL('http://localhost:3000');
location.reload();
```

Then log in. Expected: login succeeds and Console loads.

- [ ] **Step 4: Commit any fixes**

If changes are needed, commit them with a clear message.

---

## Task 28: Production Build Verification

**Files:**
- None (verification task)

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: `out/main/`, `out/preload/`, `out/renderer/` are created with no errors.

- [ ] **Step 2: Package directory**

```bash
npm run package:dir
```

Expected: `dist/mac-arm64/XEnsemble.app` (on macOS) or equivalent is created.

- [ ] **Step 3: Launch packaged app**

```bash
./dist/mac-arm64/XEnsemble.app/Contents/MacOS/XEnsemble
```

Expected: app launches, loads from `app://renderer/index.html`, and can connect to backend.

---

## Spec Coverage Review

| Spec Requirement | Implementing Task(s) |
|---|---|
| Electron 纯客户端，无本地后端 | Task 22 (main 只启动窗口/IPC)，无 server spawn 代码 |
| 独立仓库，参考 XEnsemble client | Task 4 (copy client)，Task 5-14 (adapt) |
| 远程后端默认 `xensemble.dev` | Task 16 (config default)，Task 5 (renderer helpers) |
| 可配置后端地址 | Task 16, Task 23 (preload), Task 5 (renderer read) |
| 复用 React/Vite/Tailwind 前端 | Task 4, Task 24, Task 25 |
| 安全 token 存储 | Task 17, Task 23 |
| 本地文件桥接 | Task 18 (selectFile/saveFile), Task 23 |
| 无离线/缓存 | 无相关代码 |
| 无自动更新 | 未引入 `electron-updater` |
| 跨平台打包 | Task 25 |

## Placeholder Scan

No TBD/TODO/fill-in-details patterns. Placeholder icons in Task 25 are explicitly called out as needing replacement before release.

## Type Consistency Review

- `getBackendURL()` used in `config.ts`, `handlers.ts`, and exposed via preload → consistent return type `string`.
- `apiFetch` signature `(path, token, options)` matches original usage in `PreviewPanel.jsx`.
- `getWsUrl(sessionId: string)` matches `AgentConsole.jsx` usage.
- IPC channel names match between `shared/ipc.ts`, `preload/index.ts`, and `main/ipc/handlers.ts`.
