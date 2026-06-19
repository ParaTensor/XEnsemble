# XEnsembleDesktop — Design System

## Overview

XEnsembleDesktop is a cross-platform Electron client for XEnsemble. The UI follows a **Native Desktop** aesthetic inspired by Linear, Cursor, and Slack: a unified canvas split by background color rather than floating cards, keeping the native title bar and letting content breathe.

> **Avoid Tailwind `zinc-*` colors in new UI code.** Use the hex tokens below so Login, Settings, Admin, and the main canvas stay visually consistent.

## Design Philosophy

- **Unified Canvas**: No floating cards, heavy rounded corners, or drop shadows for primary layout surfaces.
- **2-Tone Split**: A fixed left sidebar (`#F4F5F6`) and a pure white main area (`#FFFFFF`) are the only structural elements.
- **Vertical Sidebar**: The sidebar is the app’s permanent "wing"; it spans the full window height and hosts workspaces, admin links, and the user profile.
- **Content-First**: The right canvas is intentionally minimal so the terminal (dark) and admin tables/forms can be the focus.
- **Native Title Bar**: The Electron main process keeps the OS-native title bar. Do **not** add custom window control dots.

## Color Palette

| Token | Value | Usage |
|---|---|---|
| `bg-sidebar` | `#F4F5F6` | Left sidebar background |
| `bg-main` | `#FFFFFF` | Right main area background |
| `bg-terminal` | `#09090b` | Terminal (xterm) background |
| `bg-statusbar` | `#FAFBFC` | AgentConsole top status bar |
| `border-hairline` | `#E8EAED` | Subtle dividers and borders |
| `text-primary` | `#202124` | Primary text, headings, brand |
| `text-secondary` | `#5F6368` | Secondary text, labels, admin links |
| `text-placeholder` | `#9AA0A6` | Empty states, hints |
| `accent-green` | `#4A7C59` | Running session count / live indicator |
| `accent-blue` | `#5B8DB8` | Interactive actions |
| `accent-red` | `#C06C5D` | Destructive actions |

## Layout

### Window

- Default size: `1280 x 800`
- Minimum size: `900 x 600`
- Native title bar on macOS / Windows / Linux

### Root Layout (`App.jsx`)

```jsx
<div className="h-full flex">
  <AppSidebar />
  <main className="flex-1 relative min-w-0 bg-white">
    {/* SessionsPage + Admin pages mounted off-route */}
  </main>
</div>
```

### Sidebar (`AppSidebar.jsx`)

- Width: `260px`, fixed, non-collapsible
- Background: `#F4F5F6`
- Three zones:
  1. Top: no brand text (title bar already shows it); Workspaces header + running count + new-workspace button
  2. Middle: scrollable workspaces tree (pinned / recent / workspaces)
  3. Bottom: admin links (`Users`, `Agents`) for admin users + user profile / settings / logout

### Main Area

- Background: `#FFFFFF`
- No padding, border, shadow, or radius at the layout level
- Content pages provide their own padding when needed (e.g. admin pages use `p-6`)

## Components

### AgentConsole

- Outer wrapper: `h-full flex flex-col bg-white`
- Status bar: `bg-[#FAFBFC] border-b border-[#E8EAED]`
- Terminal container: `bg-[#09090b]` with `p-4` inner padding around the xterm instance
- Terminal theme: `background: '#09090b'`, `foreground: '#f4f4f5'`

### SessionsPage

- Occupies the full main area
- Empty state: centered in white canvas, placeholder color
- Active session: AgentConsole fills the space; optional file panel on the right

### Admin Pages (`AgentsAdmin`, `UsersAdmin`)

- Full-height scrollable white canvas
- `p-6` page padding
- Use `PageHeader` + `consoleTableShellClass` for tables
- No own sidebar or header

### Login Page (`Login.jsx`)

- Centered card on `bg-[#F4F5F6]`
- Card: `bg-white border border-[#E8EAED] rounded-lg shadow-sm`
- Headings: `text-[#202124]`
- Body / secondary text: `text-[#5F6368]`
- Use the same `Input` / `Button` components as the rest of the app

### Settings Modal (`SettingsModal.jsx` + `SettingsShell.jsx`)

- Modal shell uses `consoleDialogPanelClass` (white, hairline border)
- Inner layout: rounded container with `border-[#E8EAED]`
- Left tab nav: `bg-[#F4F5F6] border-r border-[#E8EAED]`
- Right panel: white canvas with scroll
- Tab labels use `consoleSettingsTabActiveClass` / `consoleSettingsTabIdleClass`
- Form labels and hints follow the same text token hierarchy

## Typography & Spacing

- Sidebar section labels: `text-[10px] uppercase tracking-wider text-[#5F6368]`
- Workspace rows: `text-xs text-[#202124]` with `hover:bg-[#E8EAED]` and `rounded-md`
- Admin links: `text-xs text-[#5F6368]` with hover state
- Use the token constants in `src/renderer/lib/consoleTheme.js` whenever possible

## Files

- Visual tokens: `src/renderer/lib/consoleTheme.js`
- Layout root: `src/renderer/App.jsx`
- Sidebar: `src/renderer/components/AppSidebar.jsx`
- Terminal: `src/renderer/components/AgentConsole.jsx`
- Main session page: `src/renderer/pages/SessionsPage.jsx`
- Window creation: `src/main/app/window.ts`
