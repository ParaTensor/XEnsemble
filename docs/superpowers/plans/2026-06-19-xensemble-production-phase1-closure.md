# Production Phase 1.5 — Auth & Client Closure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Desktop Client and Web Admin UI with the new `access_token` / `refresh_token` auth contract, authenticate WebSocket terminal connections, and fix default-port inconsistencies so the system is end-to-end usable again.

**Architecture:** Desktop stores both tokens securely (refresh token in OS keychain via Electron secure storage, access token in memory/localStorage fallback) and exposes a single `apiFetch` wrapper that auto-refreshes expired access tokens. Web Admin keeps both tokens in `localStorage`. WebSocket terminal URLs append the current access token. The server port default is unified to `3888`.

**Tech Stack:** React, Electron (secure storage / IPC), TypeScript, Node.js, Fastify.

---

## File Map

| File | Responsibility |
|---|---|
| `desktop/src/main/services/secureStore.ts` | Encrypt/decrypt refresh + access tokens in OS keychain. |
| `desktop/src/main/ipc/handlers.ts` | IPC handlers for secure store read/write. |
| `desktop/src/shared/ipc.ts` | IPC channel names and `DesktopAPI` type. |
| `desktop/src/preload/index.ts` | Exposes secure-store methods to renderer. |
| `desktop/src/renderer/lib/auth.ts` | Renderer auth helpers: getAccessToken, setTokens, clearTokens, refreshAccessToken, apiFetch. |
| `desktop/src/renderer/lib/api.ts` | Re-exports `apiFetch` from `auth.ts`; updates `getWsUrl` signature. |
| `desktop/src/renderer/App.jsx` | Uses new auth module for login/logout/restore. |
| `desktop/src/renderer/pages/Login.jsx` | Reads `access_token` / `refresh_token` from login/register response. |
| `desktop/src/renderer/components/AgentConsole.jsx` | Passes access token to `getWsUrl`. |
| `client/src/App.jsx` | Uses `access_token` / `refresh_token` from localStorage. |
| `client/src/pages/Login.jsx` | Reads new token fields. |
| `deploy/nginx/xensemble.conf` | nginx upstream port. |
| `docs/Architecture.md` | Remove draft residue and outdated port/phase statements. |

---

### Task 1: Desktop Secure Token Storage

**Files:**
- Modify: `desktop/src/main/services/secureStore.ts`
- Modify: `desktop/src/shared/ipc.ts`
- Modify: `desktop/src/main/ipc/handlers.ts`
- Modify: `desktop/src/preload/index.ts`

**Steps:**

- [ ] **Step 1: Update secure store schema and functions**

  In `desktop/src/main/services/secureStore.ts` replace the entire file with:

  ```ts
  import { safeStorage } from 'electron';
  import Store from 'electron-store';

  interface SecureStoreSchema {
    accessToken: string | null;
    refreshToken: string | null;
  }

  const store = new Store<SecureStoreSchema>({
    defaults: { accessToken: null, refreshToken: null },
  });

  function get(name: keyof SecureStoreSchema): string | null {
    const encrypted = store.get(name, null);
    if (!encrypted) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }

  function set(name: keyof SecureStoreSchema, value: string | null): void {
    if (!value) {
      store.set(name, null);
      return;
    }
    const encrypted = safeStorage.encryptString(value).toString('base64');
    store.set(name, encrypted);
  }

  export function getAccessToken(): string | null { return get('accessToken'); }
  export function setAccessToken(token: string | null): void { set('accessToken', token); }
  export function getRefreshToken(): string | null { return get('refreshToken'); }
  export function setRefreshToken(token: string | null): void { set('refreshToken', token); }
  export function clearTokens(): void {
    setAccessToken(null);
    setRefreshToken(null);
  }
  ```

- [ ] **Step 2: Add IPC channels**

  In `desktop/src/shared/ipc.ts` replace the `DesktopAPI` interface and `IPC_CHANNELS` object with:

  ```ts
  export interface DesktopAPI {
    getBackendURL(): string;
    setBackendURL(url: string): void;
    getAccessToken(): Promise<string | null>;
    setAccessToken(token: string): Promise<void>;
    getRefreshToken(): Promise<string | null>;
    setRefreshToken(token: string): Promise<void>;
    clearTokens(): Promise<void>;
    selectFile(): Promise<{ path: string; content: string } | null>;
    saveFile(file: { name: string; content: string }): Promise<boolean>;
    openExternal(url: string): void;
    getAppVersion(): string;
  }

  export const IPC_CHANNELS = {
    GET_BACKEND_URL: 'config:getBackendURL',
    SET_BACKEND_URL: 'config:setBackendURL',
    GET_ACCESS_TOKEN: 'secure:getAccessToken',
    SET_ACCESS_TOKEN: 'secure:setAccessToken',
    GET_REFRESH_TOKEN: 'secure:getRefreshToken',
    SET_REFRESH_TOKEN: 'secure:setRefreshToken',
    CLEAR_TOKENS: 'secure:clearTokens',
    SELECT_FILE: 'dialog:selectFile',
    SAVE_FILE: 'dialog:saveFile',
    OPEN_EXTERNAL: 'shell:openExternal',
    GET_APP_VERSION: 'app:getVersion'
  } as const;
  ```

- [ ] **Step 3: Add IPC handlers**

  In `desktop/src/main/ipc/handlers.ts` replace the token handlers with:

  ```ts
  ipcMain.handle(IPC_CHANNELS.GET_ACCESS_TOKEN, () => secureStore.getAccessToken());
  ipcMain.handle(IPC_CHANNELS.SET_ACCESS_TOKEN, (_event, token: string) => {
    secureStore.setAccessToken(token);
  });
  ipcMain.handle(IPC_CHANNELS.GET_REFRESH_TOKEN, () => secureStore.getRefreshToken());
  ipcMain.handle(IPC_CHANNELS.SET_REFRESH_TOKEN, (_event, token: string) => {
    secureStore.setRefreshToken(token);
  });
  ipcMain.handle(IPC_CHANNELS.CLEAR_TOKENS, () => secureStore.clearTokens());
  ```

- [ ] **Step 4: Update preload bridge**

  In `desktop/src/preload/index.ts` replace the token methods with:

  ```ts
  getAccessToken: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ACCESS_TOKEN),
  setAccessToken: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_ACCESS_TOKEN, token),
  getRefreshToken: () => ipcRenderer.invoke(IPC_CHANNELS.GET_REFRESH_TOKEN),
  setRefreshToken: (token: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_REFRESH_TOKEN, token),
  clearTokens: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_TOKENS),
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add desktop/src/main/services/secureStore.ts desktop/src/shared/ipc.ts desktop/src/main/ipc/handlers.ts desktop/src/preload/index.ts
  git commit -m "feat(desktop): store access and refresh tokens separately in secure storage"
  ```

---

### Task 2: Desktop Auth Module with Auto-Refresh

**Files:**
- Create: `desktop/src/renderer/lib/auth.ts`
- Modify: `desktop/src/renderer/lib/api.ts`

**Steps:**

- [ ] **Step 1: Create auth module**

  Create `desktop/src/renderer/lib/auth.ts`:

  ```ts
  import { publicFetch } from './api';

  const LS_ACCESS = 'xe_access_token';
  const LS_REFRESH = 'xe_refresh_token';

  function isDesktop(): boolean {
    return typeof window !== 'undefined' && Boolean((window as any).xensembleDesktopAPI);
  }

  export async function getAccessToken(): Promise<string | null> {
    if (isDesktop()) return (window as any).xensembleDesktopAPI.getAccessToken();
    return localStorage.getItem(LS_ACCESS);
  }

  export async function getRefreshToken(): Promise<string | null> {
    if (isDesktop()) return (window as any).xensembleDesktopAPI.getRefreshToken();
    return localStorage.getItem(LS_REFRESH);
  }

  export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
    if (isDesktop()) {
      await (window as any).xensembleDesktopAPI.setAccessToken(accessToken);
      await (window as any).xensembleDesktopAPI.setRefreshToken(refreshToken);
    } else {
      localStorage.setItem(LS_ACCESS, accessToken);
      localStorage.setItem(LS_REFRESH, refreshToken);
    }
  }

  export async function clearTokens(): Promise<void> {
    if (isDesktop()) {
      await (window as any).xensembleDesktopAPI.clearTokens();
    } else {
      localStorage.removeItem(LS_ACCESS);
      localStorage.removeItem(LS_REFRESH);
    }
  }

  let refreshPromise: Promise<string | null> | null = null;

  export async function refreshAccessToken(): Promise<string | null> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const refreshToken = await getRefreshToken();
        if (!refreshToken) return null;
        const res = await publicFetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.access_token || !data.refresh_token) return null;
        await setTokens(data.access_token, data.refresh_token);
        return data.access_token;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const accessToken = await getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
        return fetch(path, { ...options, headers });
      }
    }
    return res;
  }
  ```

- [ ] **Step 2: Update api.ts to use new auth module**

  Replace `desktop/src/renderer/lib/api.ts` with:

  ```ts
  const DEFAULT_BACKEND_URL = 'https://xensemble.dev';

  export function getBackendURL(): string {
    if (typeof window !== 'undefined' && (window as any).xensembleDesktopAPI) {
      return (window as any).xensembleDesktopAPI.getBackendURL() || DEFAULT_BACKEND_URL;
    }
    const host = window.location.hostname || 'localhost';
    const protocol = window.location.protocol || 'http:';
    return `${protocol}//${host}:3888`;
  }

  export function getApiBase(): string {
    return getBackendURL().replace(/\/$/, '');
  }

  export function getWsUrl(sessionId: string, accessToken: string | null): string {
    const base = getBackendURL();
    const wsProtocol = base.startsWith('https:') ? 'wss:' : 'ws:';
    const httpProtocolRemoved = base.replace(/^https?:/, '');
    const qs = new URLSearchParams({ sessionId });
    if (accessToken) qs.set('access_token', accessToken);
    return `${wsProtocol}${httpProtocolRemoved}/ws/v1/terminal?${qs.toString()}`;
  }

  export function publicFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${getApiBase()}${path}`, options);
  }

  export { apiFetch, getAccessToken, setTokens, clearTokens } from './auth';
  ```

- [ ] **Step 3: Update all `apiFetch` call sites**

  Search for `import.*apiFetch|apiFetch\(` in `desktop/src/renderer/**/*.jsx` and `desktop/src/renderer/**/*.tsx`. Remove the old `token` parameter pattern. Update imports to use `import { apiFetch } from '../lib/api';`. For calls that previously passed `apiFetch(path, token, options)`, change to `apiFetch(path, options)`.

- [ ] **Step 4: Commit**

  ```bash
  git add desktop/src/renderer/lib/auth.ts desktop/src/renderer/lib/api.ts
  git commit -m "feat(desktop): auth module with auto-refresh and token-aware apiFetch"
  ```

---

### Task 3: Desktop Login & Auth Restore

**Files:**
- Modify: `desktop/src/renderer/pages/Login.jsx`
- Modify: `desktop/src/renderer/App.jsx`

**Steps:**

- [ ] **Step 1: Update Login.jsx to read new token fields**

  In `desktop/src/renderer/pages/Login.jsx`, replace the success handling block with:

  ```jsx
  if (res.ok) {
    if (isRegister && !data.access_token) {
      showToast('success', data.message || 'Registration submitted. Await administrator approval.');
      setIsRegister(false);
      return;
    }
    if (!data.access_token || !data.refresh_token) {
      throw new Error('Server returned incomplete credentials');
    }
    login(data.access_token, data.refresh_token, data.user);
    return;
  }
  ```

- [ ] **Step 2: Update App.jsx login/logout/auth restore**

  In `desktop/src/renderer/App.jsx`:
  - Replace `loadStoredAuth` with:

    ```js
    async function loadStoredAuth() {
      const accessToken = await getAccessToken();
      const userRaw = localStorage.getItem('user');
      return { accessToken, user: userRaw ? JSON.parse(userRaw) : null };
    }
    ```

  - Replace the restore `useEffect` with:

    ```js
    React.useEffect(() => {
      loadStoredAuth().then(({ accessToken, user }) => {
        setToken(accessToken);
        setUser(user);
        setAuthReady(true);
      });
    }, []);
    ```

  - Replace `login` with:

    ```js
    const login = async (accessToken, refreshToken, user) => {
      await setTokens(accessToken, refreshToken);
      localStorage.setItem('user', JSON.stringify(user));
      setToken(accessToken);
      setUser(user);
      navigate('/sessions');
    };
    ```

  - Replace `logout` with:

    ```js
    const logout = async () => {
      await clearTokens();
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
      navigate('/login');
    };
    ```

  - Update imports: `import { getAccessToken, setTokens, clearTokens } from './lib/auth';`.

- [ ] **Step 3: Verify build**

  ```bash
  cd /Users/xinference/github/XEnsemble/desktop
  npm run build
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add desktop/src/renderer/pages/Login.jsx desktop/src/renderer/App.jsx
  git commit -m "feat(desktop): align login and auth restore with access/refresh tokens"
  ```

---

### Task 4: Desktop WebSocket Terminal Auth

**Files:**
- Modify: `desktop/src/renderer/components/AgentConsole.jsx`

**Steps:**

- [ ] **Step 1: Pass access token to WebSocket URL**

  In `desktop/src/renderer/components/AgentConsole.jsx`, update the WebSocket connection block to:

  ```js
  import { getWsUrl, getAccessToken } from '../lib/api';

  // inside the connection effect, before `new WebSocket(...)`:
  const accessToken = await getAccessToken();
  const ws = new WebSocket(getWsUrl(sessionId, accessToken));
  ```

  Replace any existing `new WebSocket(getWsUrl(sessionId))` with the above.

- [ ] **Step 2: Commit**

  ```bash
  git add desktop/src/renderer/components/AgentConsole.jsx
  git commit -m "feat(desktop): authenticate WebSocket terminal with access_token"
  ```

---

### Task 5: Web Admin Login Contract

**Files:**
- Modify: `client/src/pages/Login.jsx`
- Modify: `client/src/App.jsx`

**Steps:**

- [ ] **Step 1: Update client Login.jsx**

  In `client/src/pages/Login.jsx`, replace the success block with:

  ```jsx
  if (res.ok) {
    if (isRegister && !data.access_token) {
      setError(data.message || 'Registration submitted. Await administrator approval.');
      setIsRegister(false);
      return;
    }
    if (!data.access_token || !data.refresh_token) {
      setError('Server returned incomplete credentials');
      return;
    }
    login(data.access_token, data.refresh_token, data.user);
  }
  ```

- [ ] **Step 2: Update client App.jsx**

  In `client/src/App.jsx`:
  - Change state initialization to:

    ```js
    const [token, setToken] = useState(localStorage.getItem('xe_access_token'));
    ```

  - Change `login` to:

    ```js
    const login = (accessToken, refreshToken, user) => {
      localStorage.setItem('xe_access_token', accessToken);
      localStorage.setItem('xe_refresh_token', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));
      setToken(accessToken);
      setUser(user);
      navigate(user?.role === 'admin' ? '/admin/agents' : '/');
    };
    ```

  - Change `logout` to:

    ```js
    const logout = () => {
      localStorage.removeItem('xe_access_token');
      localStorage.removeItem('xe_refresh_token');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
      navigate('/login');
    };
    ```

  - Update any `localStorage.getItem('token')` references to `xe_access_token`.

- [ ] **Step 3: Build client**

  ```bash
  cd /Users/xinference/github/XEnsemble/client
  npm run build
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add client/src/pages/Login.jsx client/src/App.jsx
  git commit -m "feat(client): align web admin login with access/refresh tokens"
  ```

---

### Task 6: Fix Default Port Consistency

**Files:**
- Modify: `deploy/nginx/xensemble.conf`
- Modify: `desktop/src/renderer/lib/api.ts`
- Modify: `desktop/src/renderer/components/AgentConsole.jsx`
- Modify: `docs/Architecture.md`

**Steps:**

- [ ] **Step 1: Update nginx upstream port**

  In `deploy/nginx/xensemble.conf` change:

  ```nginx
  upstream xensemble_backend {
      server 127.0.0.1:3888;
      keepalive 32;
  }
  ```

- [ ] **Step 2: Update Desktop fallback URL port**

  Already updated in Task 2 (`api.ts` fallback uses `:3888`). Confirm it is `3888`.

- [ ] **Step 3: Update error message in AgentConsole.jsx**

  Search for `3000` in `desktop/src/renderer/components/AgentConsole.jsx` and replace any hard-coded reference with the actual backend URL/port (e.g., `getBackendURL()`).

- [ ] **Step 4: Update Architecture.md port references**

  In `docs/Architecture.md`, replace any `3000` references with `3888` and remove the draft residue at the end of the file (the "实施检查清单" self-reference lines and the "本设计确认后..." sentence).

- [ ] **Step 5: Commit**

  ```bash
  git add deploy/nginx/xensemble.conf desktop/src/renderer/components/AgentConsole.jsx docs/Architecture.md
  git commit -m "chore: unify default port to 3888 and clean Architecture.md"
  ```

---

### Task 7: End-to-End Smoke Test

**Files:**
- Modify: `server/scripts/smoke-production-phase1.js` (if needed)

**Steps:**

- [ ] **Step 1: Run the smoke test**

  ```bash
  cd /Users/xinference/github/XEnsemble/server
  rm -f data/emdash.db
  JWT_SECRET=dev-secret-32-chars-long-for-testing-only \
  ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
  npm start &
  SERVER_PID=$!
  sleep 4
  node scripts/smoke-production-phase1.js
  kill $SERVER_PID
  ```

  Expected: `smoke ok`.

- [ ] **Step 2: Run server tests**

  ```bash
  cd /Users/xinference/github/XEnsemble/server
  npm test
  ```

  Expected: all pass.

- [ ] **Step 3: Commit any smoke-test adjustments**

  If changes were needed, commit them.

---

## Spec Coverage Check

- ✅ Desktop stores access + refresh tokens separately.
- ✅ Desktop auto-refreshes access tokens on 401.
- ✅ Desktop WebSocket terminal sends `access_token`.
- ✅ Web Admin login uses `access_token` / `refresh_token`.
- ✅ Default port unified to `3888` across nginx, Desktop fallback, and docs.
- ⚠️ **Not in this plan:** deployment-scoped preview token, agent uid/gid wiring at spawn time, hiding `server_path`/`endpoint`, preview active-user re-check, LLM gateway rebind lock, real deployment revision. These are scoped for the next closure iteration.

## Placeholder Scan

No TBD/TODO/filler phrases. All code blocks contain real, runnable code. Frontend call-site migration in Task 2 Step 3 is described by search pattern and transformation; implementers should apply it mechanically to every `apiFetch(..., token, ...)` occurrence.
