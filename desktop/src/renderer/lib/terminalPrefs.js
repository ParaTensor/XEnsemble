import { DEFAULT_TERMINAL_THEME_ID, getTerminalTheme } from './terminalThemes.js';

const STORAGE_KEY = 'xensemble.terminal_theme_id';

export function loadTerminalThemeId() {
  if (typeof window === 'undefined') return DEFAULT_TERMINAL_THEME_ID;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && getTerminalTheme(raw).id === raw) return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_TERMINAL_THEME_ID;
}

export function saveTerminalThemeId(id) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
