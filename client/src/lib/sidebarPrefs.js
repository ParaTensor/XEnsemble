const STORAGE_KEY = 'xensemble.sidebar.prefs';

const RECENT_SESSION_LIMIT = 8;

const EMPTY_PREFS = {
  pinnedSessions: [],
  pinnedWorkspaces: [],
  archivedSessions: [],
  lastActiveSessionId: null,
  recentSessionIds: [],
  recentSessionSnapshots: {},
};

function pruneSnapshots(prefs) {
  const snapshots = { ...(prefs.recentSessionSnapshots || {}) };
  for (const key of Object.keys(snapshots)) {
    if (!prefs.recentSessionIds.includes(key)) delete snapshots[key];
  }
  prefs.recentSessionSnapshots = snapshots;
  return prefs;
}

function readPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_PREFS, recentSessionSnapshots: {} };
    const data = JSON.parse(raw);
    const prefs = {
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
      recentSessionSnapshots:
        data.recentSessionSnapshots && typeof data.recentSessionSnapshots === 'object'
          ? data.recentSessionSnapshots
          : {},
    };
    return pruneSnapshots(prefs);
  } catch {
    return { ...EMPTY_PREFS, recentSessionSnapshots: {} };
  }
}

function writePrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pruneSnapshots(prefs)));
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
  prefs.recentSessionIds = prefs.recentSessionIds.filter((id) => id !== sessionId);
  delete prefs.recentSessionSnapshots?.[sessionId];
  if (prefs.lastActiveSessionId === sessionId) {
    prefs.lastActiveSessionId = prefs.recentSessionIds[0] || null;
  }
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

export function setLastActiveSession(sessionId, snapshot = null) {
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
  if (snapshot) {
    prefs.recentSessionSnapshots = {
      ...(prefs.recentSessionSnapshots || {}),
      [sessionId]: snapshot,
    };
  }
  writePrefs(prefs);
  return prefs;
}

function sessionSnapshot(session) {
  return {
    agentId: session.agentId ?? null,
    projectId: session.projectId ?? null,
    projectName: session.projectName ?? null,
    createdAt: session.createdAt ?? Date.now(),
  };
}

/** Switch active session without reordering Recently (stable list for sidebar clicks). */
export function selectActiveSession(sessionId, snapshot = null) {
  const prefs = readPrefs();
  if (!sessionId) {
    prefs.lastActiveSessionId = null;
    writePrefs(prefs);
    return prefs;
  }
  prefs.lastActiveSessionId = sessionId;
  if (!prefs.recentSessionIds.includes(sessionId)) {
    prefs.recentSessionIds = [sessionId, ...prefs.recentSessionIds].slice(0, RECENT_SESSION_LIMIT);
  }
  if (snapshot) {
    prefs.recentSessionSnapshots = {
      ...(prefs.recentSessionSnapshots || {}),
      [sessionId]: snapshot,
    };
  }
  writePrefs(prefs);
  return prefs;
}

/** Promote session to top of Recently (start / stop / restart — not sidebar view switch). */
export function rememberRecentSession(session) {
  if (!session?.id) return readPrefs();
  return setLastActiveSession(session.id, sessionSnapshot(session));
}

export function replaceRecentSessionId(oldId, newId, snapshot = null) {
  const prefs = readPrefs();
  if (!newId) return prefs;

  if (oldId && prefs.recentSessionIds.includes(oldId)) {
    prefs.recentSessionIds = prefs.recentSessionIds.map((id) => (id === oldId ? newId : id));
  } else {
    prefs.recentSessionIds = [
      newId,
      ...prefs.recentSessionIds.filter((id) => id !== newId && id !== oldId),
    ].slice(0, RECENT_SESSION_LIMIT);
  }

  prefs.recentSessionIds = [...new Set(prefs.recentSessionIds)].slice(0, RECENT_SESSION_LIMIT);

  const snapshots = { ...(prefs.recentSessionSnapshots || {}) };
  if (oldId && snapshots[oldId]) {
    const prev = snapshots[oldId];
    delete snapshots[oldId];
    snapshots[newId] = snapshot || prev;
  } else if (snapshot) {
    snapshots[newId] = snapshot;
  }
  prefs.recentSessionSnapshots = snapshots;

  if (prefs.lastActiveSessionId === oldId) prefs.lastActiveSessionId = newId;

  writePrefs(prefs);
  return prefs;
}

/** Only moves lastActiveSessionId — does not drop Recently entries. */
export function clearLastActiveSession(sessionId) {
  const prefs = readPrefs();
  if (prefs.lastActiveSessionId !== sessionId) return prefs;
  prefs.lastActiveSessionId = prefs.recentSessionIds.find((id) => id !== sessionId) || null;
  writePrefs(prefs);
  return prefs;
}

export function removeRecentSession(sessionId) {
  const prefs = readPrefs();
  prefs.recentSessionIds = prefs.recentSessionIds.filter((id) => id !== sessionId);
  delete prefs.recentSessionSnapshots?.[sessionId];
  if (prefs.lastActiveSessionId === sessionId) {
    prefs.lastActiveSessionId = prefs.recentSessionIds[0] || null;
  }
  writePrefs(prefs);
  return prefs;
}

function ghostSessionFromSnapshot(id, snap) {
  return {
    id,
    agentId: snap.agentId,
    projectId: snap.projectId,
    projectName: snap.projectName,
    createdAt: snap.createdAt,
    alive: false,
    memoryStatus: 'exited',
    status: 'exited',
  };
}

export function getRecentSessions(sessions, prefs, { excludePinned = true } = {}) {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const snapshots = prefs.recentSessionSnapshots || {};
  const result = [];
  for (const id of prefs.recentSessionIds) {
    if (isArchivedSession(prefs, id)) continue;
    if (excludePinned && isPinnedSession(prefs, id)) continue;

    const live = byId.get(id);
    if (live) {
      result.push(live);
      continue;
    }

    const snap = snapshots[id];
    if (snap) result.push(ghostSessionFromSnapshot(id, snap));
  }
  return result;
}

/** Prefer alive session (last operated if alive), else last operated session (incl. Recently ghosts). */
export function pickSessionToRestore(sessions, prefs) {
  const recent = getRecentSessions(sessions, prefs, { excludePinned: false });
  const visible = sessions.filter((s) => !isArchivedSession(prefs, s.id));
  const lastId = prefs.lastActiveSessionId;
  const alive = visible.filter((s) => s.alive === true);

  if (lastId) {
    const fromRecent = recent.find((s) => s.id === lastId);
    if (fromRecent) return fromRecent;
  }

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

  if (recent.length > 0) return recent[0];

  return null;
}
