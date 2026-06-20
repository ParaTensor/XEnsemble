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
