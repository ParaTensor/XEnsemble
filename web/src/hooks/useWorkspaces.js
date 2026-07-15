import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import {
  readBootstrapConsoleState,
  saveConsoleCache,
  getCacheUserId,
} from '../lib/consoleCache.js';
import {
  loadSidebarPrefs,
  pickSessionToRestore,
} from '../lib/sidebarPrefs.js';

export function useWorkspaces(user) {
  const [agents, setAgents] = useState(() => readBootstrapConsoleState(null).agents);
  const [projects, setProjects] = useState(() => readBootstrapConsoleState(null).projects);
  const [sessions, setSessions] = useState(() => readBootstrapConsoleState(null).sessions);
  const [activeSession, setActiveSession] = useState(() => readBootstrapConsoleState(null).activeSession);

  const hasPendingRef = useRef(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/agents');
      const data = await res.json();
      if (Array.isArray(data)) setAgents(data);
    } catch {
      // ignore transient errors
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/projects');
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data.map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.created_at ?? p.createdAt ?? 0,
          repoProvider: p.repo_provider ?? p.repoProvider ?? 'none',
          repoUrl: p.repo_url ?? p.repoUrl ?? null,
          repoDefaultBranch: p.repo_default_branch ?? p.repoDefaultBranch ?? 'main',
          currentBranch: p.current_branch ?? p.currentBranch ?? null,
          githubRepoId: p.github_repo_id ?? p.githubRepoId ?? null,
          githubFullName: p.github_full_name ?? p.githubFullName ?? null,
          cloneStatus: p.clone_status ?? p.cloneStatus ?? null,
          cloneError: p.clone_error ?? p.cloneError ?? null,
          workspaceMode: p.workspace_mode ?? p.workspaceMode ?? 'local',
        })));
      }
    } catch {
      // ignore transient errors
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/sessions');
      const data = await res.json();
      if (Array.isArray(data)) setSessions(data);
    } catch {
      // ignore transient errors
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    await Promise.all([fetchAgents(), fetchProjects(), fetchSessions()]);
  }, [fetchAgents, fetchProjects, fetchSessions]);

  useEffect(() => {
    hasPendingRef.current = sessions.some((s) => s.status === 'pending');
  }, [sessions]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let timer;
    const scheduleNext = () => {
      const interval = hasPendingRef.current ? 2000 : 15000;
      timer = setTimeout(async () => {
        await fetchWorkspaces();
        scheduleNext();
      }, interval);
    };
    fetchWorkspaces();
    scheduleNext();
    return () => clearTimeout(timer);
  }, [fetchWorkspaces, user?.id]);

  useEffect(() => {
    if (sessions.length === 0) return;
    if (activeSession?.sessionId) {
      const exists = sessions.some((s) => s.id === activeSession.sessionId);
      if (!exists) {
        setActiveSession(null);
        const userId = getCacheUserId(user);
        if (userId) saveConsoleCache(userId, { agents, sessions, projects, activeSession: null });
      }
      return;
    }
    const prefs = loadSidebarPrefs();
    const candidate = pickSessionToRestore(sessions, prefs);
    if (!candidate || candidate.alive !== true) return;
    const projectName = candidate.projectName || projects.find((p) => p.id === candidate.projectId)?.name;
    setActiveSession({
      sessionId: candidate.id,
      agentId: candidate.agentId,
      agentName: agents.find((a) => a.id === candidate.agentId)?.name || candidate.agentId,
      projectId: candidate.projectId ?? null,
      projectName: projectName ?? null,
    });
  }, [sessions]);

  useEffect(() => {
    const userId = getCacheUserId(user);
    if (!userId) return;
    saveConsoleCache(userId, { agents, sessions, projects, activeSession });
  }, [user, agents, sessions, projects, activeSession]);

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
