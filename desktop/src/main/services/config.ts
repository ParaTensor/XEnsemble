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

// One-time migration: retire the Hong Kong relay and point Desktop back at
// the Cloudflare-fronted production domain, unless a custom URL is set.
const LEGACY_BACKEND_URL = 'https://hk.xensemble.dev';
const stored = store.get('backendURL');
if (stored === LEGACY_BACKEND_URL) {
  store.set('backendURL', DEFAULT_BACKEND_URL);
}

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
