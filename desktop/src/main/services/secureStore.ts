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
