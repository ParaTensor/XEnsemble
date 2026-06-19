import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  archiveSession,
  isArchivedSession,
  loadSidebarPrefs,
  purgeWorkspaceSidebarPrefs,
  getRecentSessions,
} from './sidebarPrefs.js';

const STORAGE_KEY = 'xensemble.sidebar.prefs';

describe('sidebarPrefs workspace purge', () => {
  /** @type {string|null} */
  let saved;

  beforeEach(() => {
    saved = global.localStorage?.getItem(STORAGE_KEY) ?? null;
    global.localStorage = {
      store: {},
      getItem(key) {
        return this.store[key] ?? null;
      },
      setItem(key, value) {
        this.store[key] = value;
      },
      removeItem(key) {
        delete this.store[key];
      },
    };
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pinnedSessions: ['sess_a'],
      pinnedWorkspaces: ['proj_1'],
      archivedSessions: [],
      lastActiveSessionId: 'sess_a',
      recentSessionIds: ['sess_a', 'sess_b'],
      recentSessionSnapshots: {
        sess_a: { agentId: 'cursor', projectId: 'proj_1', projectName: 'ws', createdAt: 1 },
        sess_b: { agentId: 'cursor', projectId: 'proj_1', projectName: 'ws', createdAt: 2 },
      },
      recentAgentIds: [],
    }));
  });

  afterEach(() => {
    if (saved === null) global.localStorage.removeItem(STORAGE_KEY);
    else global.localStorage.setItem(STORAGE_KEY, saved);
  });

  it('purgeWorkspaceSidebarPrefs removes sessions and ghosts for a workspace', () => {
    purgeWorkspaceSidebarPrefs('proj_1', [
      { id: 'sess_a', projectId: 'proj_1' },
    ]);

    const prefs = loadSidebarPrefs();
    assert.deepStrictEqual(prefs.recentSessionIds, []);
    assert.deepStrictEqual(prefs.pinnedSessions, []);
    assert.strictEqual(prefs.lastActiveSessionId, null);
    assert.strictEqual(prefs.recentSessionSnapshots.sess_a, undefined);
    assert.strictEqual(prefs.recentSessionSnapshots.sess_b, undefined);
    assert.deepStrictEqual(prefs.pinnedWorkspaces, []);
  });

  it('getRecentSessions skips ghosts for deleted projects', () => {
    const prefs = loadSidebarPrefs();
    const recent = getRecentSessions([], prefs, {
      validProjectIds: new Set(['proj_other']),
    });
    assert.strictEqual(recent.length, 0);
  });

  it('archiveSession removes from recent and marks session archived', () => {
    archiveSession('sess_a');
    const prefs = loadSidebarPrefs();
    assert.deepStrictEqual(prefs.recentSessionIds, ['sess_b']);
    assert.ok(isArchivedSession(prefs, 'sess_a'));
    assert.strictEqual(prefs.recentSessionSnapshots.sess_a, undefined);
  });

  it('loadSidebarPrefs trims stale recent list to two entries', () => {
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pinnedSessions: [],
      pinnedWorkspaces: [],
      archivedSessions: [],
      lastActiveSessionId: 'sess_1',
      recentSessionIds: ['sess_1', 'sess_2', 'sess_3', 'sess_4', 'sess_5'],
      recentSessionSnapshots: {
        sess_1: { agentId: 'a', projectId: 'p', createdAt: 1 },
        sess_2: { agentId: 'a', projectId: 'p', createdAt: 2 },
        sess_3: { agentId: 'a', projectId: 'p', createdAt: 3 },
        sess_4: { agentId: 'a', projectId: 'p', createdAt: 4 },
        sess_5: { agentId: 'a', projectId: 'p', createdAt: 5 },
      },
      recentAgentIds: [],
    }));

    const prefs = loadSidebarPrefs();
    assert.deepStrictEqual(prefs.recentSessionIds, ['sess_1', 'sess_2']);
    assert.strictEqual(prefs.recentSessionSnapshots.sess_3, undefined);
    assert.strictEqual(prefs.recentSessionSnapshots.sess_5, undefined);
  });
});
