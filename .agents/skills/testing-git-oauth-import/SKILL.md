---
name: testing-git-oauth-import
description: Test XEnsemble's Git provider OAuth connect (popup flow) and repo import end-to-end with a local mock GitHub server. Use when verifying changes to git connect/repo picker/import UI or the server git routes.
---

# Testing Git OAuth connect + repo import

## Run the app locally
- Server: `cd server && PORT=3888 npm start` (SQLite; no external deps).
- Web: `cd web && npm run dev` → http://localhost:5173 (proxies /api to :3888).
- Create users via the server CLI if none exist (see docs/UserManagement.md); you need one admin (to configure provider OAuth in platform settings) and one normal user (to test connect/import).

## Mock GitHub OAuth server (no real OAuth app needed)
Real GitHub OAuth credentials are usually unavailable. Run a small Node http server (e.g. ~/mock-github.js) on 127.0.0.1:9999 implementing:
- `GET /login/oauth/authorize` — HTML page with an "Authorize" button that redirects to `redirect_uri?code=...&state=<state>` (must echo `state`!)
- `POST /login/oauth/access_token` — returns `{access_token, token_type, scope}`
- `GET /user` — mock user (e.g. octocat)
- `GET /user/repos` — array of repos (snake_case GitHub shape: full_name, private, language, default_branch, clone_url)
- `GET /repos/:owner/:repo` — single repo (required by the import flow's `provider.getRepo`; import fails "not found" without it)

Then as admin, set GitHub provider config in Admin → Platform settings: client id/secret anything, authorize/token/API base URLs pointing at http://127.0.0.1:9999, callback `http://localhost:3888/api/v1/git/callback`.

## UI path
Sessions page → sidebar "Import from Git" icon (next to "Workspaces") → Import Repository dialog → GitHub tab → "Connect to GitHub".

## What to assert
- Connect opens a separate centered popup (not a tab); toast "Waiting for github authorization…".
- After authorize, popup posts `git-oauth-result` via postMessage and auto-closes (~1.2s); main window instantly shows "Connected to github as <user>" and loads the repo list.
- Repo list rows show full_name + visibility/language; selecting a repo auto-fills project name and base branch.
- "Import repository" → POST `/api/v1/projects/import-git` → toast "Import started. Cloning repository…" and workspace appears in sidebar. Cloning against the mock cannot complete (no git protocol) — only assert import request success unless you serve a real git repo.
- Closing the popup without authorizing → error toast within ~6s ("authorization window was closed before completing").

## Gotchas
- The server normalizes repos to camelCase (`fullName`, `defaultBranch`); the dialog normalizes back — if the repo list renders blank rows, check this mapping.
- `GET /api/v1/git/repos` takes `?provider=`; `/api/v1/git/repos/*` is a single-repo lookup — mixing them up yields `Invalid GitHub repo identifier: <provider>`.
- Popups may be blocked in some browsers; the code falls back to opening a tab. Test in the pre-running Chrome, which allows the popup.

## Devin Secrets Needed
- None (mock OAuth server; local users created via CLI).
