# XEnsembleDesktop

Cross-platform desktop client for XEnsemble.

## Development

```bash
npm install
npm run dev
```

By default the app connects to `https://xensemble.dev`. For local development, start the XEnsemble server on `http://localhost:3888` and set the backend URL in the app settings.

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
