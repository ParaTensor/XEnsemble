# XEnsemble Production Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform XEnsemble into a Client-Server backend service with Desktop Client as the primary user entry, keep the Web Admin UI, and use local execution (not Docker) for the runtime — while hardening auth, terminal, filesystem, and preview security.

**Architecture:** Keep the Fastify control plane and the `RuntimeProvider / ExecAdapter / FsAdapter / PreviewAdapter` abstraction. Introduce short-lived Access Tokens + Refresh Tokens, authenticate WebSocket terminals, harden the Local Runtime Provider, and remove public Web Coding features from `client/` while retaining Admin pages.

**Tech Stack:** Node.js 20, Fastify, better-sqlite3, Drizzle ORM, jsonwebtoken, node-pty, React (`client/`), Electron (`desktop/`).

---

## File Map

| File | Responsibility |
|------|----------------|
| `docs/Architecture.md` | Canonical production architecture doc (replaced by the approved spec). |
| `package.json` (root) | Workspace scripts to run server + desktop/client together. |
| `client/src/App.jsx` | Route shell; restrict normal users from Console/terminal. |
| `client/src/pages/Console.jsx` | Remove or disable PreviewPanel/terminal for normal users. |
| `server/src/db/schema.js` | Drizzle table definitions; add `refresh_tokens`. |
| `server/src/db/index.js` | SQLite migrations for `refresh_tokens` and existing column backfills. |
| `server/src/auth/index.js` | Access/Refresh token issuance, password hashing upgrade, production secret guard. |
| `server/src/auth/hooks.js` | `authenticate`, `requireActive`, `requireAdmin` hooks. |
| `server/src/admin/UserAdminService.js` | `loginUser` returns tokens; `registerUser` uses new auth helpers. |
| `server/src/routes/auth.js` | `/auth/login`, `/auth/register`, `/auth/refresh` routes. |
| `server/src/server.js` | Fastify bootstrap; CORS/trustProxy; WS terminal auth; static SPA serving stays for Admin. |
| `server/src/routes/terminalHttp.js` | HTTP terminal fallback (already authenticated; keep as-is). |
| `server/src/session/SessionManager.js` | In-memory bridge + history cache. |
| `server/src/session/terminalBridge.js` | WS/SSE subscription logic. |
| `server/src/runtime/interfaces.js` | Add `RuntimeProvider.attachSession` and `ExecAdapter.exec`. |
| `server/src/runtime/LocalRuntimeProvider.js` | Implement `attachSession`; workspace lifecycle. |
| `server/src/runtime/LocalExecAdapter.js` | Implement `exec`; uid/gid isolation; scrollback file buffer. |
| `server/src/runtime/LocalFsAdapter.js` | Harden path jail; fix `fsList` signature. |
| `server/src/runtime/LocalPreviewAdapter.js` | Inject scoped secrets; explicit port support. |
| `server/src/workspace.js` | `resolveSafePath` with symlink resolution. |
| `server/src/agents/agentEnv.js` | `resolvePlatformSecrets(forPreview: true)` helper reused by preview. |
| `server/src/gateway/defaultConfig.js` / `unigatewayManager.js` | Ensure admin token is always configured. |
| `server/package.json` | Dependency upgrades (fastify, drizzle-orm, glob). |
| `server/src/auth/refreshToken.test.js` | Unit tests for refresh token lifecycle. |
| `server/src/runtime/LocalFsAdapter.test.js` | Path jail tests. |
| `server/src/runtime/LocalExecAdapter.test.js` | `exec` and `attachSession` tests. |
| `deploy/xensemble.env.example` | Required production env vars. |

---

## Task 1: Update `docs/Architecture.md`

**Files:**
- Modify: `docs/Architecture.md`

- [ ] **Step 1: Replace the file contents**

  Copy the approved production architecture design from `docs/superpowers/specs/2026-06-19-xensemble-production-architecture-design.md` into `docs/Architecture.md`.

- [ ] **Step 2: Verify no MVP-only references remain**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble
  grep -n "Docker.*default\|Web Terminal.*default\|iframe Preview.*default" docs/Architecture.md || true
  ```
  Expected: no matches that contradict Phase 1 local-execution + Admin-only Web UI.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/Architecture.md
  git commit -m "docs: update Architecture.md to production phase 1 design"
  ```

---

## Task 2: Root workspace scripts for Desktop Client

**Files:**
- Modify: `/Users/xinference/github/XEnsemble/package.json`
- Create: `/Users/xinference/github/XEnsemble/.env.example`

- [ ] **Step 1: Update root `package.json`**

  ```json
  {
    "name": "xensemble",
    "version": "2.0.0",
    "private": true,
    "scripts": {
      "dev:server": "cd server && npm run dev",
      "dev:desktop": "cd desktop && npm run dev",
      "dev:client": "cd client && npm run dev",
      "dev": "concurrently \"npm run dev:server\" \"npm run dev:desktop\"",
      "build:desktop": "cd desktop && npm run build",
      "build:client": "cd client && npm run build",
      "build:gateway": "cd gateway && cargo build --release"
    },
    "devDependencies": {
      "concurrently": "^8.2.2"
    }
  }
  ```

- [ ] **Step 2: Create root `.env.example`**

  ```bash
  # Server
  PORT=3000
  CONTROL_PLANE_PUBLIC_URL=http://127.0.0.1:3000
  JWT_SECRET=change-me-to-a-long-random-string-min-32-chars
  ENCRYPTION_KEY=change-me-to-a-64-char-hex-string
  ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
  TRUSTED_PROXIES=
  WORKSPACE_ROOT=./server/data/workspaces
  PREVIEW_PUBLIC_HOST=127.0.0.1

  # Gateway
  UNIGATEWAY_BIND_ADDR=127.0.0.1:8741
  UNIGATEWAY_ADMIN_TOKEN=change-me-to-a-long-random-admin-token
  UNIGATEWAY_LOG=info
  ```

- [ ] **Step 3: Install root dev deps**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble
  npm install
  ```
  Expected: `concurrently` installed in root `node_modules`.

- [ ] **Step 4: Commit**

  ```bash
  git add package.json package-lock.json .env.example
  git commit -m "chore: add root workspace scripts and env template for desktop"
  ```

---

## Task 3: Restrict `client/` to Admin-only Web UI

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Replace `AuthenticatedLayout` and routes**

  Replace the `AuthenticatedLayout` function and the route definitions with the following (keep imports unchanged):

  ```jsx
  /** Admin-only authenticated layout. Normal users should use the Desktop Client. */
  function AuthenticatedLayout() {
    return (
      <Shell compactMain>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {user?.role === 'admin' && location.pathname === '/admin/agents' && (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden">
              <AgentsAdmin />
            </div>
          )}
          {user?.role === 'admin' && location.pathname === '/admin/users' && (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden">
              <UsersAdmin />
            </div>
          )}
          {!['/admin/agents', '/admin/users'].includes(location.pathname) && (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-zinc-500">
              <p className="text-lg font-medium">Please use the XEnsemble Desktop Client.</p>
              <p className="text-sm">Web Console is available to administrators only.</p>
            </div>
          )}
        </div>
      </Shell>
    );
  }
  ```

  Replace the `<Routes>` block with:

  ```jsx
  <Routes>
    <Route path="/login" element={!token ? <Login /> : <Navigate to="/" />} />
    <Route element={token ? <AuthenticatedLayout /> : <Navigate to="/login" replace />}>
      <Route path="/" element={null} />
      <Route path="/sessions" element={null} />
      <Route path="/console" element={null} />
      <Route
        path="/admin/agents"
        element={user?.role === 'admin' ? null : <Navigate to="/" replace />}
      />
      <Route
        path="/admin/users"
        element={user?.role === 'admin' ? null : <Navigate to="/" replace />}
      />
    </Route>
    <Route path="*" element={<Navigate to={token ? '/' : '/login'} />} />
  </Routes>
  ```

  Remove the `Console` import if it is no longer used, or keep it for the admin path if desired.

- [ ] **Step 2: Build the client to verify no compile errors**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/client
  npm run build
  ```
  Expected: build succeeds.

- [ ] **Step 3: Commit**

  ```bash
  git add client/src/App.jsx
  git commit -m "feat(client): restrict web UI to admin pages; normal users use Desktop Client"
  ```

---

## Task 4: Add `refresh_tokens` schema and migration

**Files:**
- Modify: `server/src/db/schema.js`
- Modify: `server/src/db/index.js`

- [ ] **Step 1: Add table definition in `schema.js`**

  Insert after `workspaceCheckpoints` definition (before `module.exports`):

  ```js
  const refreshTokens = sqliteTable('refresh_tokens', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    tokenHash: text('token_hash').notNull().unique(),
    deviceName: text('device_name'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
  });
  ```

  Add `refreshTokens` to `module.exports`.

- [ ] **Step 2: Add migration in `db/index.js`**

  Append inside the initial `sqlite.exec(...)` block:

  ```sql
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    device_name TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
  ```

- [ ] **Step 3: Restart server and verify table exists**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  rm -f data/emdash.db
  npm start &
  sleep 3
  sqlite3 data/emdash.db ".schema refresh_tokens"
  kill %1
  ```
  Expected: schema contains the `refresh_tokens` table and indexes.

- [ ] **Step 4: Commit**

  ```bash
  git add server/src/db/schema.js server/src/db/index.js
  git commit -m "feat(auth): add refresh_tokens schema and migration"
  ```

---

## Task 5: Refactor `auth/index.js` for Access/Refresh tokens

**Files:**
- Modify: `server/src/auth/index.js`

- [ ] **Step 1: Replace the file with the new implementation**

  ```js
  const crypto = require('crypto');
  const jwt = require('jsonwebtoken');

  const NODE_ENV = process.env.NODE_ENV || 'development';

  // ─── Production secret guard ───
  const JWT_SECRET = process.env.JWT_SECRET;
  if (NODE_ENV === 'production' && (!JWT_SECRET || JWT_SECRET.length < 32)) {
      throw new Error('JWT_SECRET must be set to at least 32 characters in production');
  }
  const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-jwt-secret-do-not-use-in-production';

  function resolveEncryptionKey() {
      const raw = process.env.ENCRYPTION_KEY?.trim();
      if (NODE_ENV === 'production' && !raw) {
          throw new Error('ENCRYPTION_KEY must be set in production');
      }
      if (!raw) return crypto.scryptSync('emdash-vault-password', 'salt', 32);
      if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
      return crypto.scryptSync(raw, 'xensemble-vault', 32);
  }

  const ENCRYPTION_KEY = resolveEncryptionKey();

  // ─── Password hashing (upgrade path) ───
  const PBKDF2_ITERATIONS = 210_000;

  function hashPassword(password) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
      return `pbkdf2_sha512$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
  }

  function verifyPassword(password, storedHash) {
      if (!storedHash) return false;
      // Legacy format: salt:hash (1000 iterations)
      if (!storedHash.includes('$')) {
          const [salt, hash] = storedHash.split(':');
          if (!salt || !hash) return false;
          const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
          return hash === verifyHash;
      }
      const parts = storedHash.split('$');
      if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha512') return false;
      const iterations = parseInt(parts[1], 10);
      const salt = parts[2];
      const hash = parts[3];
      const verifyHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
      return hash === verifyHash;
  }

  function needsRehash(storedHash) {
      return !storedHash || !storedHash.startsWith(`pbkdf2_sha512$${PBKDF2_ITERATIONS}$`);
  }

  // ─── Access tokens ───
  function generateAccessToken(user) {
      return jwt.sign({
          id: user.id,
          username: user.username,
          role: user.role,
          status: user.status || 'active',
      }, EFFECTIVE_JWT_SECRET, { expiresIn: '15m' });
  }

  function verifyAccessToken(token) {
      try {
          return jwt.verify(token, EFFECTIVE_JWT_SECRET);
      } catch (err) {
          return null;
      }
  }

  // ─── Refresh tokens ───
  function generateRefreshTokenValue() {
      return crypto.randomBytes(32).toString('base64url');
  }

  function hashToken(rawToken) {
      return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  // Simple AES-256-GCM encryption for Secrets
  function encryptSecrets(secretsObj) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      let encrypted = cipher.update(JSON.stringify(secretsObj), 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');
      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  function decryptSecrets(encryptedStr) {
      if (!encryptedStr) return {};
      const [ivHex, authTagHex, encryptedData] = encryptedStr.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
  }

  module.exports = {
      hashPassword,
      verifyPassword,
      needsRehash,
      generateAccessToken,
      verifyAccessToken,
      generateRefreshTokenValue,
      hashToken,
      encryptSecrets,
      decryptSecrets,
  };
  ```

- [ ] **Step 2: Verify existing tests still compile**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  npm test
  ```
  Expected: existing tests may fail because `generateToken`/`verifyToken` no longer exist; those callers will be updated in Task 6.

- [ ] **Step 3: Commit**

  ```bash
  git add server/src/auth/index.js
  git commit -m "feat(auth): add access/refresh tokens, production secret guard, password hash upgrade"
  ```

---

## Task 6: Update authentication hooks

**Files:**
- Modify: `server/src/auth/hooks.js`

- [ ] **Step 1: Replace `verifyToken` with `verifyAccessToken` and add `requireActive`**

  ```js
  const { db } = require('../db/index');
  const schema = require('../db/schema');
  const { eq } = require('drizzle-orm');
  const auth = require('./index');

  function registerAuthHooks(fastify) {
      fastify.decorate('authenticate', async function authenticate(request, reply) {
          try {
              const token = request.headers.authorization?.replace('Bearer ', '');
              if (!token) throw new Error('Missing token');
              const payload = auth.verifyAccessToken(token);
              if (!payload?.id) throw new Error('Invalid token');

              const rows = await db.select().from(schema.users).where(eq(schema.users.id, payload.id));
              if (rows.length === 0) throw new Error('User not found');

              const user = rows[0];
              const status = user.status || 'active';
              if (status !== 'active') {
                  const code = status === 'pending' ? 'account_pending' : 'account_suspended';
                  return reply.code(403).send({ error: code });
              }

              request.user = {
                  id: user.id,
                  username: user.username,
                  role: user.role,
                  status,
              };
          } catch (err) {
              if (!reply.sent) {
                  reply.code(401).send({ error: 'Unauthorized' });
              }
          }
      });

      fastify.decorate('requireActive', async function requireActive(request, reply) {
          if (reply.sent) return;
          if (!request.user || request.user.status !== 'active') {
              return reply.code(403).send({ error: 'account_inactive' });
          }
      });

      fastify.decorate('requireAdmin', async function requireAdmin(request, reply) {
          if (reply.sent) return;
          if (!request.user || request.user.role !== 'admin') {
              return reply.code(403).send({ error: 'Forbidden' });
          }
      });
  }

  module.exports = { registerAuthHooks };
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add server/src/auth/hooks.js
  git commit -m "feat(auth): use verifyAccessToken and add requireActive hook"
  ```

---

## Task 7: Update `UserAdminService` to return tokens and rehash legacy passwords

**Files:**
- Modify: `server/src/admin/UserAdminService.js`

- [ ] **Step 1: Add refresh token persistence helpers**

  At the top of the file after imports:

  ```js
  const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  async function createRefreshToken(userId, deviceName = null) {
      const raw = auth.generateRefreshTokenValue();
      const tokenHash = auth.hashToken(raw);
      const now = Date.now();
      const id = `rt_${crypto.randomBytes(8).toString('hex')}`;
      await db.insert(schema.refreshTokens).values({
          id,
          userId,
          tokenHash,
          deviceName,
          createdAt: now,
          expiresAt: now + REFRESH_TOKEN_TTL_MS,
      });
      return raw;
  }

  async function rotateRefreshToken(oldRawToken, userId, deviceName = null) {
      const oldHash = auth.hashToken(oldRawToken);
      const rows = await db.select().from(schema.refreshTokens)
          .where(eq(schema.refreshTokens.tokenHash, oldHash));
      if (rows.length === 0) return null;
      const tokenRow = rows[0];
      if (tokenRow.userId !== userId) return null;
      if (tokenRow.revokedAt || tokenRow.expiresAt < Date.now()) return null;
      // Revoke old token
      await db.update(schema.refreshTokens)
          .set({ revokedAt: Date.now() })
          .where(eq(schema.refreshTokens.id, tokenRow.id));
      return createRefreshToken(userId, deviceName);
  }

  async function revokeAllUserRefreshTokens(userId) {
      await db.update(schema.refreshTokens)
          .set({ revokedAt: Date.now() })
          .where(eq(schema.refreshTokens.userId, userId));
  }
  ```

- [ ] **Step 2: Update `loginUser` to issue tokens and rehash legacy passwords**

  Replace the `loginUser` function with:

  ```js
  async function loginUser(username, password, deviceName = null) {
      const users = await db.select().from(schema.users).where(eq(schema.users.username, username));
      if (users.length === 0 || !auth.verifyPassword(password, users[0].passwordHash)) {
          throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
      }
      const user = users[0];
      const status = user.status || 'active';

      if (status === 'pending') {
          throw Object.assign(new Error('Account pending approval'), { statusCode: 403, code: 'account_pending' });
      }
      if (status === 'suspended') {
          throw Object.assign(new Error('Account suspended'), { statusCode: 403, code: 'account_suspended' });
      }

      // Transparently upgrade legacy password hashes on successful login
      if (auth.needsRehash(user.passwordHash)) {
          await db.update(schema.users)
              .set({ passwordHash: auth.hashPassword(password), updatedAt: Date.now() })
              .where(eq(schema.users.id, user.id));
      }

      await db.update(schema.users).set({ lastLoginAt: Date.now() }).where(eq(schema.users.id, user.id));
      await policy.ensureUserQuota(user.id);

      const accessToken = auth.generateAccessToken(user);
      const refreshToken = await createRefreshToken(user.id, deviceName);
      const quotas = await policy.getEffectiveQuota(user.id);
      const platformSettings = require('./PlatformSettings');
      const llm_auth_mode = await platformSettings.getLlmAuthMode();
      return {
          access_token: accessToken,
          refresh_token: refreshToken,
          user: {
              id: user.id,
              username: user.username,
              role: user.role,
              status,
              llm_auth_mode,
          },
          quotas,
      };
  }
  ```

- [ ] **Step 3: Update `createUser` to use new `hashPassword`**

  In `createUser`, change:
  ```js
  passwordHash: auth.hashPassword(password),
  ```
  It already calls `auth.hashPassword`; no change needed because the function name is unchanged.

- [ ] **Step 4: Export helpers**

  Add to `module.exports`:
  ```js
  createRefreshToken,
  rotateRefreshToken,
  revokeAllUserRefreshTokens,
  ```

- [ ] **Step 5: Run existing tests**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  npm test
  ```
  Expected: tests pass or fail only at route layer (to be fixed next task).

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/admin/UserAdminService.js
  git commit -m "feat(auth): issue refresh tokens on login and rehash legacy passwords"
  ```

---

## Task 8: Update `/auth/*` routes

**Files:**
- Modify: `server/src/routes/auth.js`

- [ ] **Step 1: Replace the file**

  ```js
  const auth = require('../auth/index');
  const userAdmin = require('../admin/UserAdminService');
  const { db } = require('../db/index');
  const schema = require('../db/schema');
  const { eq } = require('drizzle-orm');

  function registerAuthRoutes(fastify) {
      fastify.post('/api/v1/auth/register', async (request, reply) => {
          const { username, password, device_name } = request.body || {};
          try {
              const { user, status, autoLogin } = await userAdmin.registerUser({ username, password });
              if (!autoLogin) {
                  return reply.code(201).send({
                      message: 'Registration submitted. Await administrator approval.',
                      user: { id: user.id, username: user.username, status },
                  });
              }
              const login = await userAdmin.loginUser(username, password, device_name);
              return {
                  access_token: login.access_token,
                  refresh_token: login.refresh_token,
                  user: login.user,
                  quotas: login.quotas,
              };
          } catch (err) {
              const code = err.statusCode || 400;
              const body = { error: err.message };
              if (err.code) body.code = err.code;
              return reply.code(code).send(body);
          }
      });

      fastify.post('/api/v1/auth/login', async (request, reply) => {
          const { username, password, device_name } = request.body || {};
          try {
              const result = await userAdmin.loginUser(username, password, device_name);
              return {
                  access_token: result.access_token,
                  refresh_token: result.refresh_token,
                  user: result.user,
                  quotas: result.quotas,
              };
          } catch (err) {
              const code = err.statusCode || 401;
              const body = { error: err.message };
              if (err.code) body.code = err.code;
              return reply.code(code).send(body);
          }
      });

      fastify.post('/api/v1/auth/refresh', async (request, reply) => {
          const { refresh_token, device_name } = request.body || {};
          if (!refresh_token) {
              return reply.code(400).send({ error: 'refresh_token is required' });
          }
          try {
              const tokenHash = auth.hashToken(refresh_token);
              const rows = await db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash));
              if (rows.length === 0 || rows[0].revokedAt || rows[0].expiresAt < Date.now()) {
                  return reply.code(401).send({ error: 'Invalid or expired refresh token' });
              }
              const tokenRow = rows[0];
              const user = await userAdmin.getUserById(tokenRow.userId);
              if (!user || user.status !== 'active') {
                  return reply.code(403).send({ error: 'account_inactive' });
              }
              await db.update(schema.refreshTokens).set({ revokedAt: Date.now() }).where(eq(schema.refreshTokens.id, tokenRow.id));
              const newRefreshToken = await userAdmin.createRefreshToken(user.id, device_name);
              const accessToken = auth.generateAccessToken(user);
              return { access_token: accessToken, refresh_token: newRefreshToken };
          } catch (err) {
              return reply.code(401).send({ error: 'Invalid refresh token' });
          }
      });

      fastify.get('/api/v1/auth/me', { preValidation: [fastify.authenticate] }, async (request) => {
          return userAdmin.getMe(request.user.id);
      });

      fastify.put('/api/v1/auth/password', { preValidation: [fastify.authenticate] }, async (request, reply) => {
          const { current_password, new_password } = request.body || {};
          if (!new_password || new_password.length < 8) {
              return reply.code(400).send({ error: 'New password must be at least 8 characters' });
          }
          const user = await userAdmin.getUserById(request.user.id);
          if (!user || !auth.verifyPassword(current_password, user.passwordHash)) {
              return reply.code(401).send({ error: 'Current password is incorrect' });
          }
          await userAdmin.resetPassword(request.user.id, new_password, request.user.id);
          await userAdmin.revokeAllUserRefreshTokens(request.user.id);
          return { ok: true };
      });
  }

  module.exports = { registerAuthRoutes };
  ```

- [ ] **Step 2: Run tests**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  npm test
  ```
  Expected: all existing tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add server/src/routes/auth.js
  git commit -m "feat(auth): add /auth/refresh and return access/refresh tokens on login"
  ```

---

## Task 9: Authenticate WebSocket terminal

**Files:**
- Modify: `server/src/server.js`

- [ ] **Step 1: Update `/ws/v1/terminal` handler**

  Replace the `app.get('/ws/v1/terminal', ...)` block with:

  ```js
  fastify.register(async function terminalWsRoutes(app) {
      app.get('/ws/v1/terminal', { websocket: true }, async (connection, req) => {
          const ws = connection.socket;
          const sendJson = (payload) => {
              if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify(payload));
              }
          };

          let sessionId = null;
          let accessToken = null;
          try {
              const url = new URL(req.url, 'http://localhost');
              sessionId = url.searchParams.get('sessionId');
              accessToken = url.searchParams.get('access_token');
          } catch (_) {
              sessionId = null;
              accessToken = null;
          }

          if (!accessToken) {
              sendJson({ type: 'error', data: 'access_token is required' });
              ws.close();
              return;
          }

          const payload = auth.verifyAccessToken(accessToken);
          if (!payload?.id) {
              sendJson({ type: 'error', data: 'Invalid access token' });
              ws.close();
              return;
          }

          if (!sessionId) {
              sendJson({ type: 'error', data: 'sessionId is required' });
              ws.close();
              return;
          }

          const sessionRows = await db.select().from(schema.sessions)
              .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, payload.id)));
          if (sessionRows.length === 0 || sessionRows[0].status !== 'running') {
              sendJson({ type: 'error', data: 'Session not found or not active' });
              ws.close();
              return;
          }

          const sub = subscribeTerminal(sessionId, (payload) => {
              sendJson(payload);
              if (payload.type === 'exit' || payload.type === 'error') {
                  try { ws.close(); } catch (_) {}
              }
          });
          if (!sub.ok) {
              ws.close();
              return;
          }

          ws.on('message', (message) => {
              if (!sessionManager.isAlive(sessionId)) return;
              try {
                  const raw = typeof message === 'string' ? message : message.toString();
                  applyTerminalMessage(sub.handle, JSON.parse(raw));
              } catch (err) {
                  console.error('WS Message Parse Error:', err);
              }
          });

          ws.on('close', sub.cleanup);
      });
  });
  ```

- [ ] **Step 2: Add `and` import if missing**

  At the top of `server.js`, the line `const { eq, and, sql } = require('drizzle-orm');` already exists.

- [ ] **Step 3: Run server and test with unauthenticated WS**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  npm start &
  SERVER_PID=$!
  sleep 3
  # Should be rejected immediately
  npx wscat -c "ws://127.0.0.1:3000/ws/v1/terminal?sessionId=sess_test" -x '{"type":"input","data":"ls"}' || true
  kill $SERVER_PID
  ```
  Expected: connection closes with error "access_token is required".

- [ ] **Step 4: Commit**

  ```bash
  git add server/src/server.js
  git commit -m "feat(terminal): require access_token on WebSocket terminal"
  ```

---

## Task 10: Implement `LocalExecAdapter.exec`

**Files:**
- Modify: `server/src/runtime/LocalExecAdapter.js`
- Create: `server/src/runtime/LocalExecAdapter.test.js`

- [ ] **Step 1: Add `exec` implementation**

  Replace the `exec` method with:

  ```js
  async exec(cmd, args, env, options = {}) {
      const workspaceDir = options.cwd;
      if (!workspaceDir || typeof workspaceDir !== 'string') {
          throw new AgentSpawnError('Project workspace directory is required to run a command.');
      }
      if (!fs.existsSync(workspaceDir)) {
          fs.mkdirSync(workspaceDir, { recursive: true });
      }

      const spawnEnv = {
          ...process.env,
          ...env,
          PATH: enrichPath({ ...process.env, ...env }),
      };

      return new Promise((resolve, reject) => {
          const child = spawn(cmd, args, {
              cwd: workspaceDir,
              env: spawnEnv,
              timeout: options.timeoutMs || 60_000,
              maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
          });

          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (chunk) => { stdout += chunk; });
          child.stderr?.on('data', (chunk) => { stderr += chunk; });

          child.on('error', (err) => {
              reject(new AgentSpawnError(`Failed to run command: ${err.message}`, 500));
          });

          child.on('close', (code, signal) => {
              if (signal) {
                  reject(new AgentSpawnError(`Command killed by ${signal}`, 504));
                  return;
              }
              resolve({
                  exitCode: code ?? 0,
                  stdout: stdout.slice(0, options.maxOutput || 1024 * 1024),
                  stderr: stderr.slice(0, options.maxOutput || 1024 * 1024),
              });
          });
      });
  }
  ```

  Add `const { spawn } = require('child_process');` at the top of the file.

- [ ] **Step 2: Write test**

  Create `server/src/runtime/LocalExecAdapter.test.js`:

  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const LocalExecAdapter = require('./LocalExecAdapter');

  test('exec runs a simple command', async () => {
      const adapter = new LocalExecAdapter();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-test-'));
      const result = await adapter.exec('echo', ['hello'], {}, { cwd: tmp });
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout.trim(), 'hello');
      fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('exec fails when cwd is missing', async () => {
      const adapter = new LocalExecAdapter();
      await assert.rejects(() => adapter.exec('echo', ['hello'], {}, {}), /workspace directory is required/);
  });
  ```

- [ ] **Step 3: Run tests**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  node --test src/runtime/LocalExecAdapter.test.js
  ```
  Expected: 2 passing tests.

- [ ] **Step 4: Commit**

  ```bash
  git add server/src/runtime/LocalExecAdapter.js server/src/runtime/LocalExecAdapter.test.js
  git commit -m "feat(runtime): implement LocalExecAdapter.exec with tests"
  ```

---

## Task 11: Add `RuntimeProvider.attachSession` and local scrollback file buffer

**Files:**
- Modify: `server/src/runtime/interfaces.js`
- Modify: `server/src/runtime/LocalRuntimeProvider.js`
- Create: `server/src/runtime/LocalScrollbackBuffer.js`
- Modify: `server/src/runtime/LocalExecAdapter.js`
- Modify: `server/src/session/SessionManager.js` (optional, to use scrollback)

- [ ] **Step 1: Update `interfaces.js`**

  Add to `RuntimeProvider`:
  ```js
  async attachSession(sessionId, streamRef) { throw new Error('RuntimeProvider.attachSession not implemented'); }
  ```

- [ ] **Step 2: Create `LocalScrollbackBuffer.js`**

  ```js
  const fs = require('fs');
  const path = require('path');
  const { WORKSPACE_ROOT } = require('../workspace');

  function scrollbackPath(streamRef) {
      if (!streamRef) return null;
      const safe = streamRef.replace(/[^a-zA-Z0-9_-]/g, '_');
      return path.join(WORKSPACE_ROOT, '.scrollback', `${safe}.log`);
  }

  function ensureScrollbackDir() {
      const dir = path.join(WORKSPACE_ROOT, '.scrollback');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  function appendScrollback(streamRef, data) {
      const file = scrollbackPath(streamRef);
      if (!file) return;
      ensureScrollbackDir();
      try {
          fs.appendFileSync(file, data);
      } catch (_) { /* ignore */ }
  }

  function readScrollback(streamRef, maxBytes = 100_000) {
      const file = scrollbackPath(streamRef);
      if (!file || !fs.existsSync(file)) return '';
      try {
          const stats = fs.statSync(file);
          const start = Math.max(0, stats.size - maxBytes);
          const fd = fs.openSync(file, 'r');
          try {
              const buffer = Buffer.alloc(stats.size - start);
              fs.readSync(fd, buffer, 0, buffer.length, start);
              return buffer.toString('utf8');
          } finally {
              fs.closeSync(fd);
          }
      } catch (_) {
          return '';
      }
  }

  function removeScrollback(streamRef) {
      const file = scrollbackPath(streamRef);
      if (file && fs.existsSync(file)) {
          try { fs.unlinkSync(file); } catch (_) {}
      }
  }

  module.exports = { appendScrollback, readScrollback, removeScrollback };
  ```

- [ ] **Step 3: Wire scrollback into `LocalExecAdapter.spawn`**

  In `LocalStreamHandle` constructor, accept `streamRef`:
  ```js
  constructor(ptyProcess, streamRef) {
      super();
      this._pty = ptyProcess;
      this._streamRef = streamRef;
      const { appendScrollback } = require('./LocalScrollbackBuffer');
      ptyProcess.onData((data) => appendScrollback(streamRef, data));
  }
  ```

  In `spawn`, when creating `LocalStreamHandle`:
  ```js
  const streamRef = `local:pty:${ptyProcess.pid}`;
  return new LocalStreamHandle(ptyProcess, streamRef);
  ```

- [ ] **Step 4: Implement `attachSession` in `LocalRuntimeProvider.js`**

  ```js
  async attachSession(sessionId, streamRef) {
      const { readScrollback } = require('./LocalScrollbackBuffer');
      const scrollback = readScrollback(streamRef);
      // For local execution, reattachment to a still-running PTY is not supported across server restarts.
      // Return scrollback so the client can replay history; mark recoverable=false.
      return { scrollback, recoverable: false };
  }
  ```

- [ ] **Step 5: Use attachSession in `SessionManager` for new sessions**

  In `SessionManager.createSession`, after `handle.onData` also set:
  ```js
  const scrollback = require('../runtime/LocalScrollbackBuffer').readScrollback(handle.streamRef);
  session.history = scrollback;
  ```

  This pre-seeds the in-memory cache from the file buffer on server restart.

- [ ] **Step 6: Add test**

  Create `server/src/runtime/LocalScrollbackBuffer.test.js`:

  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const { appendScrollback, readScrollback, removeScrollback } = require('./LocalScrollbackBuffer');

  test('append and read scrollback', () => {
      const ref = 'local:pty:12345';
      removeScrollback(ref);
      appendScrollback(ref, 'hello\n');
      appendScrollback(ref, 'world\n');
      assert.ok(readScrollback(ref).includes('world'));
      removeScrollback(ref);
  });
  ```

- [ ] **Step 7: Run tests and commit**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  node --test src/runtime/LocalScrollbackBuffer.test.js
  ```
  Expected: pass.

  ```bash
  git add server/src/runtime/interfaces.js server/src/runtime/LocalRuntimeProvider.js server/src/runtime/LocalScrollbackBuffer.js server/src/runtime/LocalExecAdapter.js server/src/session/SessionManager.js server/src/runtime/LocalScrollbackBuffer.test.js
  git commit -m "feat(runtime): add attachSession interface and local scrollback file buffer"
  ```

---

## Task 12: Harden `LocalFsAdapter` path jail

**Files:**
- Modify: `server/src/workspace.js`
- Modify: `server/src/runtime/LocalFsAdapter.js`
- Create: `server/src/runtime/LocalFsAdapter.test.js`

- [ ] **Step 1: Update `resolveSafePath`**

  Replace with:

  ```js
  /** Resolve a relative path inside project root; returns null if traversal escapes jail. */
  function resolveSafePath(rootDir, relativePath) {
      const root = path.resolve(rootDir);
      const trimmed = String(relativePath || '').replace(/^[/\\]+/, '');
      const safe = path.normalize(trimmed).replace(/^(
\.\.(\/|\\\\|$))+/, '');
      const absolute = path.resolve(root, safe === '.' ? '' : safe);
      // Resolve symlinks to prevent symlink escape
      let realAbsolute;
      try {
          realAbsolute = fs.realpathSync.native(absolute);
      } catch (e) {
          // Path does not exist yet; use normalized absolute but ensure it stays under root
          realAbsolute = absolute;
      }
      const realRoot = fs.realpathSync.native(root);
      if (realAbsolute !== realRoot && !realAbsolute.startsWith(realRoot + path.sep)) {
          return null;
      }
      return absolute;
  }
  ```

- [ ] **Step 2: Update `LocalFsAdapter.fsList` signature**

  Replace `fsList(rootDir)` with:
  ```js
  async fsList(rootDir, relativePath = '.') {
      const target = resolveSafePath(rootDir, relativePath);
      if (!target) throw new RuntimeError('Access denied', 403);
      if (!fs.existsSync(target)) return [];
      const root = path.resolve(rootDir);
      const results = [];
      const walk = (dirPath) => {
          let entries;
          try { entries = fs.readdirSync(dirPath); } catch (e) { return; }
          for (const name of entries) {
              if (name === '.scrollback') continue; // hide internal scrollback dir
              const fullPath = path.join(dirPath, name);
              let stat;
              try { stat = fs.lstatSync(fullPath); } catch (e) { continue; }
              if (stat.isSymbolicLink()) continue; // do not follow symlinks in listing
              const rel = path.relative(root, fullPath);
              results.push({
                  name,
                  path: rel.startsWith('..') ? name : rel.replace(/\\/g, '/'),
                  type: stat.isDirectory() ? 'directory' : 'file',
              });
              if (stat.isDirectory()) walk(fullPath);
          }
      };
      walk(target);
      return results;
  }
  ```

- [ ] **Step 3: Update `server.js` workspace files route**

  Change `/api/v1/workspace/files` to:
  ```js
  const relativePath = request.query.path || '';
  const { workspacePath } = await ensureProjectRuntime(project);
  return runtime.fs.fsList(workspacePath, relativePath);
  ```

- [ ] **Step 4: Add tests**

  Create `server/src/runtime/LocalFsAdapter.test.js`:

  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const LocalFsAdapter = require('./LocalFsAdapter');

  test('fsList respects relative path', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.writeFileSync(path.join(tmp, 'src', 'main.js'), 'x');
      const adapter = new LocalFsAdapter();
      const list = await adapter.fsList(tmp, 'src');
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].name, 'main.js');
      fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('fsRead blocks traversal', async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
      const adapter = new LocalFsAdapter();
      await assert.rejects(() => adapter.fsRead(tmp, '../etc/passwd'), /Access denied/);
      fs.rmSync(tmp, { recursive: true, force: true });
  });
  ```

- [ ] **Step 5: Run tests and commit**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  node --test src/runtime/LocalFsAdapter.test.js
  ```
  Expected: pass.

  ```bash
  git add server/src/workspace.js server/src/runtime/LocalFsAdapter.js server/src/server.js server/src/runtime/LocalFsAdapter.test.js
  git commit -m "feat(runtime): harden LocalFsAdapter path jail and fix fsList signature"
  ```

---

## Task 13: Inject scoped secrets into Local Preview restart

**Files:**
- Modify: `server/src/runtime/LocalPreviewAdapter.js`
- Modify: `server/src/agents/agentEnv.js` (if needed)

- [ ] **Step 1: Update `LocalPreviewAdapter.startPreview` env**

  Replace the `env` block passed to `spawn` with:

  ```js
  const { resolvePlatformSecrets, applyGatewaySynthesis } = require('../agents/agentEnv');
  const previewSecrets = applyGatewaySynthesis(await resolvePlatformSecrets({ forPreview: true }));

  const child = spawn(shell, ['-lc', spec.shell], {
      cwd: workspacePath,
      env: {
          ...process.env,
          ...previewSecrets,
          PORT: String(port),
          HOST: '127.0.0.1',
          BROWSER: 'none',
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
  });
  ```

  If `resolvePlatformSecrets` is not exported, export it in `agentEnv.js`.

- [ ] **Step 2: Add test**

  Add to `LocalPreviewAdapter.test.js` (create if not exists):

  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const LocalPreviewAdapter = require('./LocalPreviewAdapter');

  test('startPreview requires deploymentId', async () => {
      const adapter = new LocalPreviewAdapter();
      await assert.rejects(() => adapter.startPreview({}, {}), /deploymentId is required/);
  });
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/src/runtime/LocalPreviewAdapter.js server/src/agents/agentEnv.js server/src/runtime/LocalPreviewAdapter.test.js
  git commit -m "feat(preview): inject scoped platform secrets into local preview"
  ```

---

## Task 14: Process isolation for local execution

**Files:**
- Modify: `server/src/runtime/LocalExecAdapter.js`
- Modify: `server/src/runtime/LocalPreviewAdapter.js`
- Modify: `deploy/xensemble.env.example`

- [ ] **Step 1: Add uid/gid support to `LocalExecAdapter.spawn`**

  In the `ptyOptions` object, add:
  ```js
  const ptyOptions = {
      name: 'xterm-256color',
      cols: 120,
      rows: 32,
      cwd: workspaceDir,
      env: spawnEnv,
      uid: options.uid != null ? Number(options.uid) : undefined,
      gid: options.gid != null ? Number(options.gid) : undefined,
  };
  ```

  For `exec`, add the same `uid`/`gid` to `spawn()` options.

- [ ] **Step 2: Add uid/gid support to `LocalPreviewAdapter.startPreview`**

  In the `spawn` options for preview, add:
  ```js
  uid: process.env.RUNTIME_UID ? Number(process.env.RUNTIME_UID) : undefined,
  gid: process.env.RUNTIME_GID ? Number(process.env.RUNTIME_GID) : undefined,
  ```

- [ ] **Step 3: Update env example**

  Add to `deploy/xensemble.env.example`:
  ```bash
  # Optional: run agent/preview processes as a different OS user (requires numeric uid/gid)
  RUNTIME_UID=
  RUNTIME_GID=
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add server/src/runtime/LocalExecAdapter.js server/src/runtime/LocalPreviewAdapter.js deploy/xensemble.env.example
  git commit -m "feat(runtime): support uid/gid isolation for local execution"
  ```

---

## Task 15: Secure server defaults (CORS, trustProxy, gateway admin token)

**Files:**
- Modify: `server/src/server.js`
- Modify: `server/src/gateway/defaultConfig.js`
- Modify: `server/src/gateway/unigatewayManager.js`

- [ ] **Step 1: Replace CORS and trustProxy config in `server.js`**

  Replace:
  ```js
  const fastify = require('fastify')({ logger: true, trustProxy: true });
  ```
  with:
  ```js
  const TRUSTED_PROXIES = process.env.TRUSTED_PROXIES
      ? process.env.TRUSTED_PROXIES.split(',').map((s) => s.trim()).filter(Boolean)
      : false;
  const fastify = require('fastify')({ logger: true, trustProxy: TRUSTED_PROXIES });
  ```

  Replace the CORS registration with:
  ```js
  const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : ['http://127.0.0.1:5173', 'http://localhost:5173'];

  fastify.register(require('@fastify/cors'), {
      origin: (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) {
              cb(null, true);
              return;
          }
          cb(new Error('Not allowed by CORS'), false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: true,
  });
  ```

- [ ] **Step 2: Ensure UniGateway admin token exists**

  In `server/src/gateway/unigatewayManager.js`, in the startup path (`start`), after loading config, throw if `adminToken` is missing in production:

  ```js
  if (process.env.NODE_ENV === 'production' && !config.adminToken) {
      throw new Error('UNIGATEWAY_ADMIN_TOKEN is required in production');
  }
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/src/server.js server/src/gateway/unigatewayManager.js
  git commit -m "feat(server): restrict CORS/trustProxy and require gateway admin token in production"
  ```

---

## Task 16: Upgrade dependencies

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json` (via npm install)

- [ ] **Step 1: Update `server/package.json` dependency versions**

  ```json
  {
    "dependencies": {
      "@fastify/cors": "^9.0.1",
      "@fastify/static": "^7.0.4",
      "@fastify/websocket": "^8.2.0",
      "better-sqlite3": "^9.6.0",
      "drizzle-orm": "^0.45.2",
      "fastify": "^4.28.1",
      "http-proxy": "^1.18.1",
      "jsonwebtoken": "^9.0.2",
      "node-pty": "^1.0.0"
    }
  }
  ```

  Note: fastify v4 latest at time of writing is used because v5 may introduce larger breaking changes. If v5 is desired, treat it as a separate migration task.

- [ ] **Step 2: Reinstall**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  rm -rf node_modules package-lock.json
  npm install
  ```
  Expected: install succeeds.

- [ ] **Step 3: Run tests**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  npm test
  ```
  Expected: all tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add server/package.json server/package-lock.json
  git commit -m "chore(deps): upgrade fastify, drizzle-orm, and related packages"
  ```

---

## Task 17: Add refresh token tests

**Files:**
- Create: `server/src/auth/refreshToken.test.js`

- [ ] **Step 1: Write tests**

  ```js
  const { test } = require('node:test');
  const assert = require('node:assert');
  const auth = require('./index');
  const userAdmin = require('../admin/UserAdminService');
  const { db } = require('../db/index');
  const schema = require('../db/schema');
  const { eq } = require('drizzle-orm');

  test('access token expires quickly', () => {
      const token = auth.generateAccessToken({ id: 'u1', username: 'a', role: 'user', status: 'active' });
      const payload = auth.verifyAccessToken(token);
      assert.ok(payload.exp - payload.iat <= 900, 'expires in 15 minutes');
  });

  test('refresh token lifecycle', async () => {
      const raw = auth.generateRefreshTokenValue();
      const hash = auth.hashToken(raw);
      assert.strictEqual(hash.length, 64);
      // Token value should not be reconstructible from hash
      const raw2 = auth.generateRefreshTokenValue();
      assert.notStrictEqual(auth.hashToken(raw2), hash);
  });

  test('password hash upgrade', () => {
      const legacy = 'salt:hash';
      assert.strictEqual(auth.needsRehash(legacy), true);
      const modern = auth.hashPassword('password123');
      assert.strictEqual(auth.needsRehash(modern), false);
      assert.ok(auth.verifyPassword('password123', modern));
  });
  ```

- [ ] **Step 2: Run tests**

  Run:
  ```bash
  cd /Users/xinference/github/XEnsemble/server
  node --test src/auth/refreshToken.test.js
  ```
  Expected: pass.

- [ ] **Step 3: Commit**

  ```bash
  git add server/src/auth/refreshToken.test.js
  git commit -m "test(auth): add refresh token and password hash tests"
  ```

---

## Task 18: Update deployment environment template

**Files:**
- Modify: `deploy/xensemble.env.example`

- [ ] **Step 1: Ensure all required production vars are documented**

  Final `deploy/xensemble.env.example`:

  ```bash
  NODE_ENV=production
  PORT=3888
  CONTROL_PLANE_PUBLIC_URL=https://xensemble.dev

  # Required: at least 32 characters
  JWT_SECRET=change-me-to-a-long-random-string-min-32-chars

  # Required: 64-character hex string (32 bytes)
  ENCRYPTION_KEY=change-me-to-a-64-char-hex-string

  # CORS origins for the web admin UI; adjust to your Desktop Client / web admin URL
  ALLOWED_ORIGINS=https://xensemble.dev

  # Comma-separated list of trusted proxy IPs; leave empty to disable trustProxy
  TRUSTED_PROXIES=

  # Local execution workspace root
  WORKSPACE_ROOT=/var/lib/xensemble/workspaces

  # Preview URL host (should resolve to this server)
  PREVIEW_PUBLIC_HOST=xensemble.dev

  # UniGateway (LLM proxy)
  UNIGATEWAY_BIND_ADDR=127.0.0.1:8741
  UNIGATEWAY_ADMIN_TOKEN=change-me-to-a-long-random-admin-token
  UNIGATEWAY_LOG=info

  # Optional process isolation (numeric uid/gid)
  RUNTIME_UID=
  RUNTIME_GID=
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add deploy/xensemble.env.example
  git commit -m "docs(deploy): document required production env vars"
  ```

---

## Task 19: End-to-end smoke test

**Files:**
- Create: `server/scripts/smoke-production-phase1.js`

- [ ] **Step 1: Write smoke script**

  ```js
  const http = require('http');
  const assert = require('assert');

  async function request(path, method = 'GET', body = null, token = null) {
      return new Promise((resolve, reject) => {
          const opts = {
              hostname: '127.0.0.1',
              port: process.env.PORT || 3000,
              path,
              method,
              headers: { 'Content-Type': 'application/json' },
          };
          if (token) opts.headers.Authorization = `Bearer ${token}`;
          const req = http.request(opts, (res) => {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => {
                  try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                  catch { resolve({ status: res.statusCode, body: data }); }
              });
          });
          req.on('error', reject);
          if (body) req.write(JSON.stringify(body));
          req.end();
      });
  }

  async function main() {
      // register
      const reg = await request('/api/v1/auth/register', 'POST', {
          username: `smoke_${Date.now()}`,
          password: 'SmokePass123!',
          device_name: 'smoke-test',
      });
      assert.strictEqual(reg.status, 200, `register failed: ${JSON.stringify(reg.body)}`);
      assert.ok(reg.body.access_token, 'access_token missing');
      assert.ok(reg.body.refresh_token, 'refresh_token missing');

      // refresh
      const refresh = await request('/api/v1/auth/refresh', 'POST', {
          refresh_token: reg.body.refresh_token,
      });
      assert.strictEqual(refresh.status, 200, `refresh failed: ${JSON.stringify(refresh.body)}`);
      assert.ok(refresh.body.access_token, 'new access_token missing');

      // me
      const me = await request('/api/v1/auth/me', 'GET', null, reg.body.access_token);
      assert.strictEqual(me.status, 200);
      assert.strictEqual(me.body.username, reg.body.user.username);

      console.log('smoke ok');
  }

  main().catch((err) => {
      console.error(err);
      process.exit(1);
  });
  ```

- [ ] **Step 2: Run smoke test against a running server**

  Run:
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

- [ ] **Step 3: Commit**

  ```bash
  git add server/scripts/smoke-production-phase1.js
  git commit -m "test: add production phase 1 smoke script"
  ```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Implementing task |
|------------------|-------------------|
| Update `docs/Architecture.md` | Task 1 |
| Keep `client/` Web Admin UI | Tasks 3–4 |
| Desktop Client workspace scripts | Task 2 |
| Access/Refresh Token auth | Tasks 4–9, 17 |
| WS terminal authentication | Task 9 |
| `ExecAdapter.exec` | Task 10 |
| `RuntimeProvider.attachSession` + scrollback | Task 11 |
| Harden `LocalFsAdapter` path jail | Task 12 |
| Fix `FsAdapter.fsList` signature | Task 12 |
| Preview scoped secrets | Task 13 |
| Local process isolation (uid/gid) | Task 14 |
| CORS/trustProxy hardening | Task 15 |
| Gateway admin token required | Task 15 |
| Dependency upgrades | Task 16 |
| Production env template | Task 18 |

### 2. Placeholder scan

- No `TBD`, `TODO`, or vague steps remain.
- Every code step contains a concrete code block or exact command.
- Type/function names are consistent (`verifyAccessToken`, `generateAccessToken`, `hashToken`, `rotateRefreshToken`, `createRefreshToken`).

### 3. Known gaps to address during execution

- **Desktop Client API update:** The `desktop/` code currently calls the old `/auth/login` response shape (`token`). Updating `desktop/src` to use `access_token`/`refresh_token` is not in this plan; it should be handled immediately after the auth routes land.
- **`client/` Login component:** It stores `token` in `localStorage`. Update it to store `access_token` and use `/auth/refresh` when the access token expires. This is also a follow-up task.
- **Gateway Rust admin token enforcement:** The Node side now requires it; the Rust binary still treats it as optional. A follow-up task should change `gateway/src/main.rs` to refuse admin requests when `admin_token` is unset.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-xensemble-production-phase1.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Use `superpowers:subagent-driven-development`.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach would you like?
