# AGENTS.md — XEnsembleDesktop

Agent-focused conventions for working on this codebase.

## Tech Stack

- **Electron 39** with `electron-vite 3`
- **React 18** + **React Router 6**
- **Vite 6** for renderer and main/preload builds
- **Tailwind CSS 3** for styling
- **TypeScript** for main/preload; JSX/TSX for renderer
- **Node.js test runner** for lightweight `.test.js` modules (no JSX support without extra setup)

## Commands

```bash
# Install dependencies
npm install

# Development (starts Electron + Vite dev server)
npm run dev

# Production build
npm run build

# Package app locally
npm run package:dir

# Run available tests
node --test src/renderer/hooks/useWorkspaces.test.js
node --test src/renderer/lib/consoleTheme.test.js
node --test src/renderer/lib/terminalThemes.test.js
```

## Project Structure

```
src/
  main/          # Electron main process (window, menu, IPC)
  preload/       # Preload bridge between main and renderer
  renderer/      # React UI
    components/  # Reusable UI components
    hooks/       # Custom React hooks
    lib/         # Utilities, theme tokens, API helpers
    pages/       # Route-level pages
  shared/        # Shared IPC types
```

## Styling Conventions

- Prefer the design tokens exported from `src/renderer/lib/consoleTheme.js` (e.g. `textPrimary`, `bgActive`, `borderHairline`).
- Native Desktop Layout:
  - Sidebar: `#F4F5F6`, fixed `260px`
  - Main area: `#FFFFFF`, no card/border/shadow at the layout level
  - Terminal: dark `#09090b` with `p-4` inner padding
- Avoid `zinc` / `slate` / `gray` arbitrary colors in new layout code; use the documented hex palette.
- Login, Settings, and Admin pages should all use the same token set (`#202124`, `#5F6368`, `#9AA0A6`, `#E8EAED`, `#F4F5F6`).
- Do **not** add custom window control dots; keep the native title bar.

## State Management

- Workspace state (agents, projects, sessions, activeSession) lives in `src/renderer/hooks/useWorkspaces.js`.
- `App.jsx` consumes this hook and passes props down to `AppSidebar` and `SessionsPage`.
- `SessionsPage` uses `React.forwardRef` to expose `openLaunchModal`, `requestDeleteSession`, and `requestDeleteWorkspace` to the sidebar.

## Off-Route Mounting

- `SessionsPage`, `AgentsAdmin`, and `UsersAdmin` are all mounted inside the main area.
- Inactive routes receive `pointer-events-none invisible absolute inset-0 z-0` so they stay alive without being visible or interactive.
- This preserves terminal sessions and admin form state across route changes.

## Adding a New Page

1. Create the page component under `src/renderer/pages/`.
2. Add the route in `src/renderer/App.jsx` inside the authenticated route group.
3. If the page should stay mounted off-route, render it conditionally inside `<main>` with the off-route class pattern.
4. Use `p-6` padding for full-page admin-style content.

## Important Files

| File | Purpose |
|---|---|
| `src/renderer/App.jsx` | Root layout, routing, auth context |
| `src/renderer/components/AppSidebar.jsx` | Left sidebar |
| `src/renderer/components/AgentConsole.jsx` | Terminal session view |
| `src/renderer/pages/SessionsPage.jsx` | Main sessions page |
| `src/renderer/hooks/useWorkspaces.js` | Workspace data + active session state |
| `src/renderer/lib/consoleTheme.js` | Visual token constants |
| `src/main/app/window.ts` | BrowserWindow creation and sizing |
| `DESIGN.md` | Visual design system reference |

## Gotchas

- `node --test` cannot directly import `.jsx`/`.tsx` files without a loader. Keep unit tests in plain `.js` when possible.
- The renderer dev server runs at `http://localhost:5173/`; the app connects to the backend at `https://hk.xensemble.dev` by default or `http://localhost:3888` for local dev.
- Window sizing and native chrome are controlled in `src/main/app/window.ts`, not in renderer CSS.
