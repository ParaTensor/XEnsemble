const STORAGE_KEY = 'xensemble.sidebar.prefs';

function readPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pinnedSessions: [], pinnedWorkspaces: [], archivedSessions: [] };
    const data = JSON.parse(raw);
    return {
      pinnedSessions: Array.isArray(data.pinnedSessions) ? data.pinnedSessions : [],
      pinnedWorkspaces: Array.isArray(data.pinnedWorkspaces) ? data.pinnedWorkspaces : [],
      archivedSessions: Array.isArray(data.archivedSessions) ? data.archivedSessions : [],
    };
  } catch {
    return { pinnedSessions: [], pinnedWorkspaces: [], archivedSessions: [] };
  }
}

function writePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function loadSidebarPrefs() {
  return readPrefs();
}

export function togglePinnedSession(sessionId) {
  const prefs = readPrefs();
  const set = new Set(prefs.pinnedSessions);
  if (set.has(sessionId)) set.delete(sessionId);
  else set.add(sessionId);
  prefs.pinnedSessions = [...set];
  writePrefs(prefs);
  return prefs;
}

export function togglePinnedWorkspace(workspaceId) {
  const prefs = readPrefs();
  const set = new Set(prefs.pinnedWorkspaces);
  if (set.has(workspaceId)) set.delete(workspaceId);
  else set.add(workspaceId);
  prefs.pinnedWorkspaces = [...set];
  writePrefs(prefs);
  return prefs;
}

export function archiveSession(sessionId) {
  const prefs = readPrefs();
  const archived = new Set(prefs.archivedSessions);
  archived.add(sessionId);
  prefs.archivedSessions = [...archived];
  const pinned = new Set(prefs.pinnedSessions);
  pinned.delete(sessionId);
  prefs.pinnedSessions = [...pinned];
  writePrefs(prefs);
  return prefs;
}

export function isPinnedSession(prefs, sessionId) {
  return prefs.pinnedSessions.includes(sessionId);
}

export function isPinnedWorkspace(prefs, workspaceId) {
  return prefs.pinnedWorkspaces.includes(workspaceId);
}

export function isArchivedSession(prefs, sessionId) {
  return prefs.archivedSessions.includes(sessionId);
}
