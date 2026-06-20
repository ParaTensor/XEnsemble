import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { apiFetch } from '../lib/api.ts';
import {
  getTerminalTheme,
  listTerminalThemes,
  mergeTerminalCatalog,
} from '../lib/terminalThemes.js';
import { loadTerminalThemeId, saveTerminalThemeId } from '../lib/terminalPrefs.js';

const TerminalThemeContext = createContext(null);

async function syncPreferencesToServer(token, themeId) {
  if (!token) return;
  try {
    await apiFetch('/api/v1/user/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminal_theme_id: themeId }),
    });
  } catch {
    /* local preference still applies */
  }
}

async function fetchRemoteCatalog(token) {
  if (!token) return null;
  try {
    const res = await apiFetch('/api/v1/terminal-themes');
    if (!res.ok) return null;
    const data = await res.json();
    return mergeTerminalCatalog(data.themes);
  } catch {
    return null;
  }
}

async function fetchRemotePreference(token) {
  if (!token) return null;
  try {
    const res = await apiFetch('/api/v1/user/preferences');
    if (!res.ok) return null;
    const data = await res.json();
    const id = data?.terminal_theme_id;
    if (id && getTerminalTheme(id).id === id) return id;
  } catch {
    /* ignore */
  }
  return null;
}

export function TerminalThemeProvider({ token, children }) {
  const [themeId, setThemeIdState] = useState(loadTerminalThemeId);
  const [themeRevision, setThemeRevision] = useState(0);
  const [catalog, setCatalog] = useState(listTerminalThemes);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [remoteCatalog, remoteThemeId] = await Promise.all([
        fetchRemoteCatalog(token),
        fetchRemotePreference(token),
      ]);
      if (cancelled) return;
      if (remoteCatalog) setCatalog(remoteCatalog);
      if (remoteThemeId) {
        setThemeIdState(remoteThemeId);
        saveTerminalThemeId(remoteThemeId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const setThemeId = useCallback((nextId, { onAppearanceChange } = {}) => {
    const next = getTerminalTheme(nextId);
    if (!next || next.id !== nextId) return false;

    const prev = getTerminalTheme(themeId);

    saveTerminalThemeId(nextId);
    setThemeIdState(nextId);
    setThemeRevision((n) => n + 1);
    syncPreferencesToServer(token, nextId);

    if (prev.appearance !== next.appearance) {
      onAppearanceChange?.(prev.appearance, next.appearance);
    }
    return true;
  }, [themeId, token]);

  const preset = useMemo(() => getTerminalTheme(themeId), [themeId]);

  const value = useMemo(() => ({
    themeId,
    preset,
    catalog,
    themeRevision,
    setThemeId,
  }), [themeId, preset, catalog, themeRevision, setThemeId]);

  return (
    <TerminalThemeContext.Provider value={value}>
      {children}
    </TerminalThemeContext.Provider>
  );
}

export function useTerminalTheme() {
  const ctx = useContext(TerminalThemeContext);
  if (!ctx) {
    throw new Error('useTerminalTheme must be used within TerminalThemeProvider');
  }
  return ctx;
}
