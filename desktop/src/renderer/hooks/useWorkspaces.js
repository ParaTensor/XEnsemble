import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../lib/api.ts';
import {
  readBootstrapConsoleState,
  saveConsoleCache,
  getCacheUserId,
} from '../lib/consoleCache.js';
import {
  loadSidebarPrefs,
  pickSessionToRestore,
  isArchivedSession,
} from '../lib/sidebarPrefs.js';

export function useWorkspaces(token, user) {
  const [agents, setAgents] = useState(() => readBootstrapConsoleState(null).agents);
  const [projects, setProjects] = useState(() => readBootstrapConsoleState(null).projects);
  const [sessions, setSessions] = useState(() => readBootstrapConsoleState(null).sessions);
  const [activeSession, setActiveSession] = useState(() => readBootstrapConsoleState(null).activeSession);

  const fetchAgents = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiBase()}/api/v1/agents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) setAgents(data);
    } catch {
      // ignore transient errors
    }
  }, [token]);

  const fetchProjects = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiBase()}/api/v1/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data.map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.created_at ?? p.createdAt ?? 0,
        })));
      }
    } catch {
      // ignore transient errors
    }
  }, [token]);

  const fetchSessions = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${getApiBase()}/api/v1/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (Array.isArray(data)) setSessions(data);
    } catch {
      // ignore transient errors
    }
  }, [token]);

  const fetchWorkspaces = useCallback(async () => {
    await Promise.all([fetchAgents(), fetchProjects(), fetchSessions()]);
  }, [fetchAgents, fetchProjects, fetchSessions]);

  useEffect(() => {
    if (!token) return;
    fetchWorkspaces();
    const poll = setInterval(fetchWorkspaces, 5000);
    return () => clearInterval(poll);
  }, [token, fetchWorkspaces]);

  useEffect(() => {
    if (!token || sessions.length === 0 || activeSession) return;
    const prefs = loadSidebarPrefs();
    if (activeSession?.sessionId && !isArchivedSession(prefs, activeSession.sessionId)) return;
    const candidate = pickSessionToRestore(sessions, prefs);
    if (!candidate) return;
    const projectName = candidate.projectName || projects.find((p) => p.id === candidate.projectId)?.name;
    setActiveSession({
      sessionId: candidate.id,
      agentId: candidate.agentId,
      agentName: agents.find((a) => a.id === candidate.agentId)?.name || candidate.agentId,
      projectId: candidate.projectId ?? null,
      projectName: projectName ?? null,
    });
  }, [token, sessions, activeSession, agents, projects]);

  useEffect(() => {
    const userId = getCacheUserId(user);
    if (!userId || !token) return;
    saveConsoleCache(userId, { agents, sessions, projects, activeSession });
  }, [user, token, agents, sessions, projects, activeSession]);

  return {
    agents,
    setAgents,
    projects,
    setProjects,
    sessions,
    setSessions,
    activeSession,
    setActiveSession,
    fetchWorkspaces,
  };
}
