const STORAGE_KEY = 'xensemble.sidebar.prefs';

const RECENT_SESSION_LIMIT = 8;

const EMPTY_PREFS = {
  pinnedSessions: [],
  pinnedWorkspaces: [],
  archivedSessions: [],
  lastActiveSessionId: null,
  recentSessionIds: [],
};

function readPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_PREFS };
    const data = JSON.parse(raw);
    return {
      pinnedSessions: Array.isArray(data.pinnedSessions) ? data.pinnedSessions : [],
      pinnedWorkspaces: Array.isArray(data.pinnedWorkspaces) ? data.pinnedWorkspaces : [],
      archivedSessions: Array.isArray(data.archivedSessions) ? data.archivedSessions : [],
      lastActiveSessionId:
        typeof data.lastActiveSessionId === 'string' ? data.lastActiveSessionId : null,
      recentSessionIds: Array.isArray(data.recentSessionIds)
        ? data.recentSessionIds
        : typeof data.lastActiveSessionId === 'string'
          ? [data.lastActiveSessionId]
          : [],
    };
  } catch {
    return { ...EMPTY_PREFS };
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

export function removeWorkspacePrefs(workspaceId) {
  const prefs = readPrefs();
  prefs.pinnedWorkspaces = prefs.pinnedWorkspaces.filter((id) => id !== workspaceId);
  writePrefs(prefs);
  return prefs;
}

export function setLastActiveSession(sessionId) {
  const prefs = readPrefs();
  if (!sessionId) {
    prefs.lastActiveSessionId = null;
    writePrefs(prefs);
    return prefs;
  }
  prefs.lastActiveSessionId = sessionId;
  prefs.recentSessionIds = [
    sessionId,
    ...prefs.recentSessionIds.filter((id) => id !== sessionId),
  ].slice(0, RECENT_SESSION_LIMIT);
  writePrefs(prefs);
  return prefs;
}

export function clearLastActiveSession(sessionId) {
  const prefs = readPrefs();
  const nextRecent = prefs.recentSessionIds.filter((id) => id !== sessionId);
  if (
    prefs.lastActiveSessionId !== sessionId
    && nextRecent.length === prefs.recentSessionIds.length
  ) {
    return prefs;
  }
  prefs.recentSessionIds = nextRecent;
  prefs.lastActiveSessionId =
    prefs.lastActiveSessionId === sessionId ? (nextRecent[0] || null) : prefs.lastActiveSessionId;
  writePrefs(prefs);
  return prefs;
}

export function getRecentSessions(sessions, prefs, { excludePinned = true } = {}) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const result = [];
  for (const id of prefs.recentSessionIds) {
    const session = byId.get(id);
    if (!session || isArchivedSession(prefs, id)) continue;
    if (excludePinned && isPinnedSession(prefs, id)) continue;
    result.push(session);
  }
  return result;
}

/** Prefer alive session (last operated if alive), else last operated session. */
export function pickSessionToRestore(sessions, prefs) {
  const visible = sessions.filter((s) => !isArchivedSession(prefs, s.id));
  if (visible.length === 0) return null;

  const lastId = prefs.lastActiveSessionId;
  const alive = visible.filter((s) => s.alive === true);

  if (alive.length > 0) {
    if (lastId && alive.some((s) => s.id === lastId)) {
      return alive.find((s) => s.id === lastId);
    }
    return alive.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  }

  if (lastId) {
    const last = visible.find((s) => s.id === lastId);
    if (last) return last;
  }

  return null;
}
