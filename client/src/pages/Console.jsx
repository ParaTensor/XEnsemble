import React, { useState, useEffect, useContext, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import AgentConsole from '../components/AgentConsole';
import WorkspaceFileTree from '../components/WorkspaceFileTree';
import SelectMenu from '../components/SelectMenu';
import { ConsoleAnchoredDialog, ConsoleDialogShell, ConsoleInlineDialog } from '../components/ConsoleDialog';
import SecretFields from '../components/settings/SecretFields';
import { useToast } from '../components/Toast';
import { TerminalSquare, Play, Settings2, FolderOpen, FileText, X, RefreshCw, Plus, Trash2, ChevronRight, ChevronDown, FolderPlus, Pin, Archive, ListFilter } from 'lucide-react';
import { AuthContext } from '../App';
import { getSecretLabel, isSecretPasswordField } from '../lib/secretLabels';
import { formatQuotaExceeded } from '../lib/quotaLabels';
import {
  loadSidebarPrefs,
  togglePinnedSession,
  togglePinnedWorkspace,
  archiveSession,
  isPinnedSession,
  isPinnedWorkspace,
  isArchivedSession,
  removeWorkspacePrefs,
  rememberRecentSession,
  selectActiveSession,
  replaceRecentSessionId,
  removeRecentSession,
  pickSessionToRestore,
  getRecentSessions,
  sortAgentsByRecentUsage,
  rememberRecentAgent,
  getRecentAgentIds,
} from '../lib/sidebarPrefs';
import { getApiBase } from '../lib/api';
import { consoleDialogPanelClass, consoleToolPageClass } from '../lib/consoleTokens';
import {
  getCacheUserId,
  readBootstrapConsoleState,
  saveConsoleCache,
} from '../lib/consoleCache';

const DEFAULT_AGENT_ID = 'kimi-code';

function pickDefaultAgentId(agents, preferredId) {
  if (preferredId && agents.some((a) => a.id === preferredId)) return preferredId;
  const preferred = agents.find((a) => a.id === DEFAULT_AGENT_ID) || agents[0];
  return preferred?.id || '';
}

const SLUG_WORDS = [
  'small', 'heavy', 'many', 'quiet', 'swift', 'bright', 'calm', 'bold', 'brave', 'clear',
  'dark', 'fast', 'fresh', 'grand', 'keen', 'light', 'neat', 'proud', 'sharp', 'warm',
  'flies', 'colts', 'items', 'signs', 'hounds', 'clouds', 'doors', 'fields', 'flames', 'gates',
  'hints', 'ideas', 'kites', 'lanes', 'maps', 'nodes', 'paths', 'roads', 'stars', 'trees',
  'film', 'play', 'argue', 'invent', 'travel', 'cheer', 'results', 'forest', 'river', 'stone',
];

function defaultWorkspaceName() {
  const pick = () => SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${pick()}-${pick()}-${pick()}`;
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sortSessions(list, prefs) {
  return [...list].sort((a, b) => {
    const aPin = isPinnedSession(prefs, a.id) ? 1 : 0;
    const bPin = isPinnedSession(prefs, b.id) ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    const aLive = a.alive === true ? 1 : 0;
    const bLive = b.alive === true ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

function buildWorkspaces(projects, sessions, prefs) {
  const visible = sessions.filter((s) => !isArchivedSession(prefs, s.id));
  const byProject = {};
  for (const s of visible) {
    const pid = s.projectId || '_orphan';
    if (!byProject[pid]) byProject[pid] = [];
    byProject[pid].push(s);
  }
  const list = projects.map((p) => {
    const sess = sortSessions(byProject[p.id] || [], prefs);
    const lastActivity = Math.max(
      p.createdAt || 0,
      ...sess.map((s) => s.createdAt || 0),
    );
    return { id: p.id, name: p.name, sessions: sess, lastActivity };
  });
  if (byProject._orphan?.length) {
    const sess = sortSessions(byProject._orphan, prefs);
    list.push({
      id: '_orphan',
      name: 'Unassigned',
      sessions: sess,
      lastActivity: Math.max(...sess.map((s) => s.createdAt || 0)),
    });
  }
  return list.sort((a, b) => {
    const aPin = isPinnedWorkspace(prefs, a.id) ? 1 : 0;
    const bPin = isPinnedWorkspace(prefs, b.id) ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    return b.lastActivity - a.lastActivity;
  });
}

export default function Console() {
  const { token, user } = useContext(AuthContext);
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const [agents, setAgents] = useState(() => readBootstrapConsoleState(null).agents);
  const [sessions, setSessions] = useState(() => readBootstrapConsoleState(null).sessions);
  const [projects, setProjects] = useState(() => readBootstrapConsoleState(null).projects);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(() => {
    const ids = new Set();
    const cached = readBootstrapConsoleState(null).activeSession;
    if (cached?.projectId) ids.add(cached.projectId);
    return ids;
  });
  const [selectedAgentId, setSelectedAgentId] = useState(() => readBootstrapConsoleState(null).selectedAgentId);
  const [newProjectName, setNewProjectName] = useState('');
  const [launchModalMode, setLaunchModalMode] = useState('workspace');
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState('');
  const [projectCreating, setProjectCreating] = useState(false);
  const [launchModalError, setLaunchModalError] = useState(null);
  const [activeSession, setActiveSession] = useState(() => readBootstrapConsoleState(null).activeSession);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Workspace File Explorer states
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [viewingFile, setViewingFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  // Modals state
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showNewInstanceModal, setShowNewInstanceModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [configKeys, setConfigKeys] = useState({});
  const [savedConfigKeys, setSavedConfigKeys] = useState({});
  const [configSaving, setConfigSaving] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);
  const { showToast } = useToast();
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [restartingSession, setRestartingSession] = useState(false);
  const [stoppingSession, setStoppingSession] = useState(false);
  const [deleteConfirmSession, setDeleteConfirmSession] = useState(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState(null);
  const [deleteConfirmWorkspace, setDeleteConfirmWorkspace] = useState(null);
  const [sidebarPrefs, setSidebarPrefs] = useState(() => loadSidebarPrefs());
  const [expandedSessionLists, setExpandedSessionLists] = useState(() => new Set());

  const refreshSidebarPrefs = () => setSidebarPrefs(loadSidebarPrefs());

  const getAgentLabel = useCallback(
    (agentId) => agents.find((a) => a.id === agentId)?.name || agentId,
    [agents],
  );

  const applyActiveSession = useCallback((session) => {
    if (!session) return;
    const projectName = session.projectName || projects.find((p) => p.id === session.projectId)?.name;
    selectActiveSession(session.id, {
      agentId: session.agentId ?? null,
      projectId: session.projectId ?? null,
      projectName: projectName ?? null,
      createdAt: session.createdAt ?? Date.now(),
    });
    refreshSidebarPrefs();
    setActiveSession({
      sessionId: session.id,
      agentId: session.agentId,
      agentName: getAgentLabel(session.agentId),
      projectId: session.projectId,
      projectName,
    });
    if (session.projectId) {
      setExpandedWorkspaces((prev) => {
        const next = new Set(prev);
        next.add(session.projectId);
        return next;
      });
    }
  }, [getAgentLabel, projects]);

  const tryRestoreActiveSession = useCallback(() => {
    if (!token || sessions.length === 0) return;

    const prefs = loadSidebarPrefs();
    if (activeSession?.sessionId && !isArchivedSession(prefs, activeSession.sessionId)) {
      return;
    }

    const candidate = pickSessionToRestore(sessions, prefs);
    if (!candidate) return;
    applyActiveSession(candidate);
  }, [token, sessions, activeSession, applyActiveSession]);

  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = location.pathname;
    if (location.pathname === '/sessions' && prev !== '/sessions') {
      tryRestoreActiveSession();
    }
  }, [location.pathname, tryRestoreActiveSession]);

  useEffect(() => {
    if (!token || sessions.length === 0 || activeSession) return;
    tryRestoreActiveSession();
  }, [token, sessions, activeSession, tryRestoreActiveSession]);

  useEffect(() => {
    const userId = getCacheUserId(user);
    if (!userId || !token) return;
    saveConsoleCache(userId, {
      agents,
      sessions,
      projects,
      selectedAgentId,
      activeSession,
    });
  }, [user, token, agents, sessions, projects, selectedAgentId, activeSession]);

  useEffect(() => {
    if (!activeSession?.agentId || agents.length === 0) return;
    const name = agents.find((a) => a.id === activeSession.agentId)?.name;
    if (name && name !== activeSession.agentName) {
      setActiveSession((prev) => (prev ? { ...prev, agentName: name } : prev));
    }
  }, [agents, activeSession?.agentId, activeSession?.agentName]);

  useEffect(() => {
    if (!token) return;
    fetch(`${getApiBase()}/api/v1/agents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) {
          setAgents([]);
          setSelectedAgentId('');
          return;
        }
        setAgents(data);
        setSelectedAgentId((prev) => pickDefaultAgentId(data, prev));
      })
      .catch(() => setError('Could not connect to backend server.'));

    fetchWorkspaces();
    const poll = setInterval(fetchWorkspaces, 5000);
    return () => clearInterval(poll);
  }, [token]);

  useEffect(() => {
    if (!activeSession?.projectId) return;
    setExpandedWorkspaces((prev) => {
      if (prev.has(activeSession.projectId)) return prev;
      const next = new Set(prev);
      next.add(activeSession.projectId);
      return next;
    });
  }, [activeSession?.projectId]);

  useEffect(() => {
    const runningIds = [...new Set(sessions.filter((s) => s.alive && s.projectId).map((s) => s.projectId))];
    if (runningIds.length === 0) return;
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of runningIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  const fetchProjects = () =>
    fetch(`${getApiBase()}/api/v1/projects`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        setProjects(
          data.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.created_at ?? p.createdAt ?? 0,
          })),
        );
      });

  const fetchSessions = () =>
    fetch(`${getApiBase()}/api/v1/sessions`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSessions(data);
      });

  const fetchWorkspaces = () => {
    fetchProjects();
    fetchSessions();
  };

  const toggleWorkspaceExpanded = (workspaceId) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };

  const toggleSessionListExpanded = (key) => {
    setExpandedSessionLists((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fetchWorkspaceFiles = () => {
    if (!activeSession?.projectId) return;
    setIsLoadingFiles(true);
    fetch(`${getApiBase()}/api/v1/workspace/files?project_id=${encodeURIComponent(activeSession.projectId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setWorkspaceFiles(data);
      })
      .finally(() => setIsLoadingFiles(false));
  };

  // Poll workspace files occasionally when session is active
  useEffect(() => {
    if (activeSession) {
      fetchWorkspaceFiles();
      const interval = setInterval(fetchWorkspaceFiles, 10000);
      return () => clearInterval(interval);
    } else {
      setWorkspaceFiles([]);
      setViewingFile(null);
      setWorkspaceOpen(false);
    }
  }, [activeSession, token]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const openConfigModal = async () => {
    const required = selectedAgent?.env_required || [];
    const initialKeys = {};
    required.forEach((k) => { initialKeys[k] = ''; });
    setConfigKeys(initialKeys);
    setSavedConfigKeys({});
    setConfigError(null);
    setError(null);
    setShowConfigModal(true);
    setConfigLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/secrets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        const saved = {};
        const loaded = {};
        required.forEach((k) => {
          if (data[k]) saved[k] = true;
          if (data[k] && !isSecretPasswordField(k)) loaded[k] = data[k];
          else loaded[k] = '';
        });
        setSavedConfigKeys(saved);
        setConfigKeys(loaded);
      }
    } catch {
      setConfigError('Could not load saved keys. You can still enter them below.');
    } finally {
      setConfigLoading(false);
    }
  };

  const configRequiredKeys = selectedAgent?.env_required || [];
  const configMissingKeys = useMemo(
    () => configRequiredKeys.filter((k) => !savedConfigKeys[k] && !configKeys[k]?.trim()),
    [configRequiredKeys, savedConfigKeys, configKeys],
  );
  const ensureAgentSecrets = async (agent) => {
    const required = agent?.env_required || [];
    if (required.length === 0 || agent?.llm_auth_mode === 'gateway') return true;
    try {
      const res = await fetch(`${getApiBase()}/api/v1/secrets`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) return false;
      const missing = required.filter((k) => !data[k]);
      if (missing.length === 0) return true;
      openConfigModal();
      return false;
    } catch {
      openConfigModal();
      return false;
    }
  };

  const handleCreateProject = async (nameOverride) => {
    const name = (nameOverride ?? newProjectName).trim() || defaultWorkspaceName();
    setProjectCreating(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'quota_exceeded') {
          throw new Error(formatQuotaExceeded(data.dimension || 'max_projects', data.current, data.limit));
        }
        throw new Error(data.error || 'Failed to create workspace');
      }
      return { id: data.id, name: data.name || name };
    } catch (err) {
      setLaunchModalError(err.message);
      return null;
    } finally {
      setProjectCreating(false);
    }
  };

  const handleStartSession = async (projectId, projectName, { closeLaunchModal = true } = {}) => {
    if (!selectedAgentId || !selectedAgent) return false;
    if (!projectId) {
      setLaunchModalError('Could not create workspace for this session.');
      return false;
    }
    setIsLoading(true);
    setLaunchModalError(null);
    setError(null);
    try {
      const ready = await ensureAgentSecrets(selectedAgent);
      if (!ready) {
        setLaunchModalError('Configure required API keys before launching.');
        return false;
      }

      const response = await fetch(`${getApiBase()}/api/v1/session/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ agent_id: selectedAgentId, project_id: projectId })
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = data.error || data.message || 'Failed to start session';
        if (data.error === 'agent_not_granted') {
          setLaunchModalError('You do not have permission to use this agent. Contact an administrator.');
          return false;
        }
        if (data.error === 'quota_exceeded') {
          setLaunchModalError(formatQuotaExceeded(data.dimension, data.current, data.limit));
          return false;
        }
        if (/Missing required env|Secrets Vault/i.test(msg)) {
          setLaunchModalError(msg);
          openConfigModal();
          return false;
        }
        throw new Error(msg);
      }

      rememberRecentSession({
        id: data.session_id,
        agentId: selectedAgentId,
        projectId,
        projectName: projectName || projectId,
        createdAt: Date.now(),
      });
      rememberRecentAgent(selectedAgentId);
      refreshSidebarPrefs();
      setActiveSession({
        sessionId: data.session_id,
        agentId: selectedAgentId,
        agentName: selectedAgent.name,
        projectId,
        projectName: projectName || projectId,
      });
      fetchWorkspaces();
      setExpandedWorkspaces((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      if (closeLaunchModal) setShowNewInstanceModal(false);
      return true;
    } catch (err) {
      setLaunchModalError(err.message);
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const openLaunchModal = (mode = 'workspace', workspace = null) => {
    setLaunchModalError(null);
    setLaunchModalMode(mode);
    if (mode === 'session' && workspace) {
      setLaunchWorkspaceId(workspace.id);
      setNewProjectName(workspace.name);
    } else {
      setLaunchWorkspaceId('');
      setNewProjectName(defaultWorkspaceName());
    }
    const prefs = loadSidebarPrefs();
    const sorted = sortAgentsByRecentUsage(agents, prefs);
    if (sorted.length > 0) {
      setSelectedAgentId(sorted[0].id);
    }
    setShowNewInstanceModal(true);
  };

  const handleLaunchFromModal = async () => {
    setLaunchModalError(null);
    if (launchModalMode === 'session') {
      if (!launchWorkspaceId) {
        setLaunchModalError('Select a workspace first.');
        return;
      }
      const ws = projects.find((p) => p.id === launchWorkspaceId);
      await handleStartSession(launchWorkspaceId, ws?.name || launchWorkspaceId, { closeLaunchModal: true });
      return;
    }
    const name = newProjectName.trim() || defaultWorkspaceName();
    const created = await handleCreateProject(name);
    if (!created) return;
    await handleStartSession(created.id, created.name, { closeLaunchModal: true });
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigError(null);
    const required = selectedAgent?.env_required || [];
    const payload = {};
    required.forEach((k) => {
      const value = configKeys[k]?.trim();
      if (value) payload[k] = value;
    });
    const missing = required.filter((k) => !payload[k] && !savedConfigKeys[k]);
    if (missing.length > 0) {
      setConfigError(`Missing: ${missing.map(getSecretLabel).join(', ')}`);
      return;
    }
    if (Object.keys(payload).length === 0) {
      setShowConfigModal(false);
      setLaunchModalError(null);
      return;
    }
    setConfigSaving(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/secrets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save keys');
      setSavedConfigKeys((prev) => {
        const next = { ...prev };
        required.forEach((k) => {
          if (payload[k] || prev[k]) next[k] = true;
        });
        return next;
      });
      setConfigKeys((prev) => {
        const next = { ...prev };
        required.forEach((k) => {
          if (isSecretPasswordField(k)) next[k] = '';
        });
        return next;
      });
      showToast('success', 'API keys saved.');
      setShowConfigModal(false);
      setLaunchModalError(null);
    } catch (err) {
      setConfigError(err.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleOpenFile = async (file) => {
    if (file.type !== 'file') return;
    try {
      const res = await fetch(
        `${getApiBase()}/api/v1/workspace/file?project_id=${encodeURIComponent(activeSession.projectId)}&path=${encodeURIComponent(file.path)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.ok) {
        setViewingFile(file);
        setFileContent(data.content);
      } else {
        alert('Could not read file: ' + data.error);
      }
    } catch (e) {
      alert('Failed to fetch file content');
    }
  };

  const handleSessionEnd = (sessionId) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, alive: false, memoryStatus: 'exited', status: 'exited' } : s
      )
    );
    fetchSessions();
  };

  const handleRestartSession = async () => {
    if (!activeSession) return;

    const agentId =
      activeSession.agentId ||
      sessions.find((s) => s.id === activeSession.sessionId)?.agentId;
    if (!agentId || !activeSession.projectId) {
      showToast('error', 'Cannot start: missing agent or workspace.');
      return;
    }

    const agent = agents.find((a) => a.id === agentId);
    const oldSessionId = activeSession.sessionId;

    setRestartingSession(true);
    try {
      const ready = await ensureAgentSecrets(agent);
      if (!ready) {
        showToast('error', 'Configure required API keys before starting.');
        return;
      }

      await fetch(`${getApiBase()}/api/v1/sessions/${encodeURIComponent(oldSessionId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});

      const response = await fetch(`${getApiBase()}/api/v1/session/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ agent_id: agentId, project_id: activeSession.projectId }),
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = data.error || data.message || 'Failed to start session';
        if (data.error === 'agent_not_granted') {
          showToast('error', 'You do not have permission to use this agent.');
          return;
        }
        if (data.error === 'quota_exceeded') {
          showToast('error', formatQuotaExceeded(data.dimension, data.current, data.limit));
          return;
        }
        if (/Missing required env|Secrets Vault/i.test(msg)) {
          showToast('error', msg);
          openConfigModal();
          return;
        }
        throw new Error(msg);
      }

      replaceRecentSessionId(oldSessionId, data.session_id, {
        agentId,
        projectId: activeSession.projectId,
        projectName: activeSession.projectName,
        createdAt: Date.now(),
      });
      rememberRecentAgent(agentId);
      refreshSidebarPrefs();
      setActiveSession({
        sessionId: data.session_id,
        agentId,
        agentName: agent?.name || activeSession.agentName,
        projectId: activeSession.projectId,
        projectName: activeSession.projectName,
      });
      fetchWorkspaces();
      showToast('success', 'Session started.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setRestartingSession(false);
    }
  };

  const handleStopSession = async () => {
    if (!activeSession?.sessionId) return;

    setStoppingSession(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/sessions/${encodeURIComponent(activeSession.sessionId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to stop session');
      rememberRecentSession({
        id: activeSession.sessionId,
        agentId: activeSession.agentId,
        projectId: activeSession.projectId,
        projectName: activeSession.projectName,
        createdAt: sessions.find((s) => s.id === activeSession.sessionId)?.createdAt,
      });
      refreshSidebarPrefs();
      handleSessionEnd(activeSession.sessionId);
      fetchWorkspaces();
      showToast('success', 'Session stopped.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setStoppingSession(false);
    }
  };

  const handleDeleteSession = async (sessionId) => {
    setDeletingSessionId(sessionId);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete session');
      removeRecentSession(sessionId);
      refreshSidebarPrefs();
      if (activeSession?.sessionId === sessionId) setActiveSession(null);
      setDeleteConfirmSession(null);
      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
      setShowErrorModal(true);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const requestDeleteSession = (session, ws) => {
    setDeleteConfirmSession({
      sessionId: session.id,
      isLive: session.alive === true,
      agentLabel: getAgentLabel(session.agentId),
      workspaceName: ws.name,
    });
  };

  const handleDeleteWorkspace = async (workspaceId) => {
    setDeletingWorkspaceId(workspaceId);
    try {
      if (workspaceId === '_orphan') {
        const orphanSessions = sessions.filter((s) => !s.projectId);
        for (const s of orphanSessions) {
          const res = await fetch(`${getApiBase()}/api/v1/sessions/${encodeURIComponent(s.id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to delete session');
        }
        if (activeSession && !activeSession.projectId) setActiveSession(null);
      } else {
        const res = await fetch(`${getApiBase()}/api/v1/projects/${encodeURIComponent(workspaceId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete workspace');
        if (activeSession?.projectId === workspaceId) setActiveSession(null);
      }
      removeWorkspacePrefs(workspaceId);
      refreshSidebarPrefs();
      setDeleteConfirmWorkspace(null);
      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
      setShowErrorModal(true);
    } finally {
      setDeletingWorkspaceId(null);
    }
  };

  const requestDeleteWorkspace = (ws, anchorEl) => {
    const liveCount = ws.sessions.filter((s) => s.alive === true).length;
    const rect = anchorEl.getBoundingClientRect();
    setDeleteConfirmWorkspace({
      workspaceId: ws.id,
      workspaceName: ws.name,
      sessionCount: ws.sessions.length,
      liveCount,
      isOrphan: ws.id === '_orphan',
      anchorRect: {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
    });
  };

  const selectSession = (s, ws) => {
    applyActiveSession({ ...s, projectName: s.projectName || ws?.name });
  };

  const handlePinSession = (e, sessionId) => {
    e.stopPropagation();
    togglePinnedSession(sessionId);
    refreshSidebarPrefs();
  };

  const handleArchiveSession = (e, sessionId) => {
    e.stopPropagation();
    archiveSession(sessionId);
    refreshSidebarPrefs();
    if (activeSession?.sessionId === sessionId) setActiveSession(null);
  };

  const handlePinWorkspace = (e, workspaceId) => {
    e.stopPropagation();
    togglePinnedWorkspace(workspaceId);
    refreshSidebarPrefs();
  };

  const SESSION_PREVIEW_LIMIT = 5;

  const renderSessionRow = (s, ws, { compact = false, showWorkspace = false } = {}) => {
    const isActive = activeSession?.sessionId === s.id;
    const isLive = s.alive === true;
    const isDeleting = deletingSessionId === s.id;
    const pinned = isPinnedSession(sidebarPrefs, s.id);
    const label = getAgentLabel(s.agentId);

    return (
      <div
        key={s.id}
        className={`group/session relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors ${
          isActive ? 'bg-zinc-100' : 'hover:bg-zinc-50'
        } ${!isLive ? 'opacity-70' : ''}`}
      >
        <span className={`shrink-0 w-1 h-1 rounded-full ${isLive ? 'bg-green-500' : 'bg-zinc-300'}`} />
        <button
          type="button"
          disabled={isDeleting}
          onClick={() => selectSession(s, ws)}
          className="flex-1 min-w-0 text-left text-xs text-zinc-700 disabled:opacity-50"
          title={showWorkspace ? `${label} · ${ws?.name || ''}` : label}
        >
          {showWorkspace ? (
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{label}</span>
              <span className="truncate text-[10px] text-zinc-400">{ws?.name}</span>
            </span>
          ) : (
            <span className="truncate">{label}</span>
          )}
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <span className={`text-[11px] text-zinc-400 tabular-nums ${compact ? '' : 'hidden group-hover/session:inline'}`}>
            {formatRelativeTime(s.createdAt)}
          </span>
          <button
            type="button"
            title={pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => handlePinSession(e, s.id)}
            className={`p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-opacity ${
              pinned ? 'opacity-100 text-zinc-600' : 'opacity-0 group-hover/session:opacity-100 focus:opacity-100'
            }`}
          >
            <Pin className={`w-3 h-3 ${pinned ? 'fill-current' : ''}`} />
          </button>
          <button
            type="button"
            title="Archive"
            disabled={isDeleting}
            onClick={(e) => handleArchiveSession(e, s.id)}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 opacity-0 group-hover/session:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
          >
            <Archive className="w-3 h-3" />
          </button>
          {!compact && (
            <button
              type="button"
              title={isLive ? 'Stop and remove' : 'Remove'}
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation();
                requestDeleteSession(s, ws);
              }}
              className="p-1 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover/session:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
            >
              <Trash2 className={`w-3 h-3 ${isDeleting ? 'animate-pulse' : ''}`} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSessionList = (sessionList, ws, listKey) => {
    if (sessionList.length === 0) {
      return <p className="text-xs text-zinc-400 py-1 px-1.5">No sessions. Use + to add one.</p>;
    }
    const expanded = expandedSessionLists.has(listKey);
    const visible = expanded ? sessionList : sessionList.slice(0, SESSION_PREVIEW_LIMIT);
    const hasMore = sessionList.length > SESSION_PREVIEW_LIMIT;

    return (
      <>
        {visible.map((s) => renderSessionRow(s, ws))}
        {hasMore && !expanded && (
          <button
            type="button"
            onClick={() => toggleSessionListExpanded(listKey)}
            className="text-xs text-zinc-400 hover:text-zinc-600 py-1 px-1.5 text-left"
          >
            See more
          </button>
        )}
      </>
    );
  };

  const workspaces = buildWorkspaces(projects, sessions, sidebarPrefs);
  const pinnedSessions = sortSessions(
    sessions.filter((s) => isPinnedSession(sidebarPrefs, s.id) && !isArchivedSession(sidebarPrefs, s.id)),
    sidebarPrefs,
  );
  const recentSessions = getRecentSessions(sessions, sidebarPrefs);
  const hasRecentSection = (sidebarPrefs.recentSessionIds?.length ?? 0) > 0;
  const runningCount = sessions.filter((s) => s.alive === true).length;
  const hasSidebarSectionsAboveWorkspaces = hasRecentSection || pinnedSessions.length > 0;
  const agentSelectOptions = sortAgentsByRecentUsage(agents, sidebarPrefs).map((agent) => ({
    value: agent.id,
    label: agent.name,
  }));
  const recentAgentIds = getRecentAgentIds(agents, sidebarPrefs);

  return (
    <div className={consoleToolPageClass}>
      {/* Dialog Modals */}
      {viewingFile && (
        <ConsoleDialogShell
          onClose={() => setViewingFile(null)}
          panelClassName={`${consoleDialogPanelClass} w-[min(900px,calc(100vw-2rem))] h-[min(80vh,calc(100vh-2rem))]`}
        >
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3 shrink-0">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="w-4 h-4 shrink-0 text-zinc-500" />
              <span className="truncate text-sm font-semibold text-zinc-900">{viewingFile.name}</span>
              <span className="truncate text-xs font-mono text-zinc-400">{viewingFile.path}</span>
            </div>
            <button
              type="button"
              onClick={() => setViewingFile(null)}
              className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-black"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4 bg-zinc-50/30 text-sm font-mono text-zinc-800 whitespace-pre">
            {fileContent}
          </div>
        </ConsoleDialogShell>
      )}

      {deleteConfirmWorkspace && (
        <ConsoleAnchoredDialog
          onClose={() => setDeleteConfirmWorkspace(null)}
          anchorRect={deleteConfirmWorkspace.anchorRect}
          panelClassName="bg-white rounded-lg shadow-lg w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden border border-zinc-200"
        >
            <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50">
              <Trash2 className="w-5 h-5 shrink-0 text-zinc-500" />
              <h3 className="font-semibold text-sm text-zinc-900">
                {deleteConfirmWorkspace.isOrphan ? 'Clear unassigned sessions' : 'Delete workspace'}
              </h3>
            </div>
            <div className="p-5 text-sm text-zinc-600">
              {deleteConfirmWorkspace.isOrphan ? (
                <>
                  Remove all sessions in <span className="font-medium text-zinc-900">Unassigned</span>?
                  {deleteConfirmWorkspace.sessionCount > 0 && (
                    <span>
                      {' '}
                      This will remove {deleteConfirmWorkspace.sessionCount} session
                      {deleteConfirmWorkspace.sessionCount === 1 ? '' : 's'}
                      {deleteConfirmWorkspace.liveCount > 0 && (
                        <> (including {deleteConfirmWorkspace.liveCount} running)</>
                      )}
                      .
                    </span>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">Unassigned is not a workspace — it groups sessions without a project. Clearing it removes those sessions from history.</p>
                </>
              ) : (
                <>
                  Permanently delete <span className="font-medium text-zinc-900">{deleteConfirmWorkspace.workspaceName}</span>?
                  {deleteConfirmWorkspace.sessionCount > 0 && (
                    <span>
                      {' '}
                      This will remove {deleteConfirmWorkspace.sessionCount} session
                      {deleteConfirmWorkspace.sessionCount === 1 ? '' : 's'}
                      {deleteConfirmWorkspace.liveCount > 0 && (
                        <> (including {deleteConfirmWorkspace.liveCount} running)</>
                      )}
                      .
                    </span>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">All workspace files on the server will be deleted. This frees your workspace quota.</p>
                </>
              )}
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmWorkspace(null)}
                className="h-9 px-4 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingWorkspaceId === deleteConfirmWorkspace.workspaceId}
                onClick={() => handleDeleteWorkspace(deleteConfirmWorkspace.workspaceId)}
                className="h-9 px-4 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deletingWorkspaceId === deleteConfirmWorkspace.workspaceId
                  ? 'Removing…'
                  : deleteConfirmWorkspace.isOrphan
                    ? 'Clear all'
                    : 'Delete workspace'}
              </button>
            </div>
        </ConsoleAnchoredDialog>
      )}

      {deleteConfirmSession && (
        <ConsoleInlineDialog
          onClose={() => setDeleteConfirmSession(null)}
          panelClassName="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200"
        >
            <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50">
              <Trash2 className="w-5 h-5 shrink-0 text-zinc-500" />
              <h3 className="font-semibold text-sm text-zinc-900">
                {deleteConfirmSession.isLive ? 'Stop session' : 'Remove from history'}
              </h3>
            </div>
            <div className="p-5 text-sm text-zinc-600">
              {deleteConfirmSession.isLive ? (
                <>
                  Stop <span className="font-medium text-zinc-900">{deleteConfirmSession.agentLabel}</span> in{' '}
                  <span className="font-medium text-zinc-900">{deleteConfirmSession.workspaceName}</span> and remove this session?
                </>
              ) : (
                <>
                  Remove <span className="font-medium text-zinc-900">{deleteConfirmSession.agentLabel}</span> from history in{' '}
                  <span className="font-medium text-zinc-900">{deleteConfirmSession.workspaceName}</span>?
                </>
              )}
              <p className="mt-2 text-xs text-zinc-500">Workspace files on the server will be kept.</p>
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmSession(null)}
                className="h-9 px-4 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingSessionId === deleteConfirmSession.sessionId}
                onClick={() => handleDeleteSession(deleteConfirmSession.sessionId)}
                className="h-9 px-4 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deletingSessionId === deleteConfirmSession.sessionId ? 'Removing…' : deleteConfirmSession.isLive ? 'Stop & remove' : 'Remove'}
              </button>
            </div>
        </ConsoleInlineDialog>
      )}

      {showErrorModal && (
        <ConsoleInlineDialog
          onClose={() => setShowErrorModal(false)}
          panelClassName="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200"
        >
            <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-red-50 text-red-600">
              <X className="w-5 h-5 shrink-0" />
              <h3 className="font-semibold text-sm">Action Failed</h3>
            </div>
            <div className="p-5 text-sm text-zinc-600 break-words">
              {error}
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
              {selectedAgent?.llm_auth_mode === 'byok' && /Missing required|Secrets Vault/i.test(error || '') && selectedAgent?.env_required?.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowErrorModal(false);
                    openConfigModal();
                  }}
                  className="h-9 px-4 flex items-center gap-2 border border-zinc-200 rounded-md text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 mr-auto"
                >
                  <Settings2 className="w-4 h-4" /> Configure Keys
                </button>
              )}
              <button 
                type="button"
                onClick={() => setShowErrorModal(false)}
                className="h-9 px-4 bg-zinc-900 text-white rounded-md text-sm font-medium hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
        </ConsoleInlineDialog>
      )}

      {showNewInstanceModal && (
        <ConsoleInlineDialog
          onClose={() => {
            setShowNewInstanceModal(false);
            setLaunchModalError(null);
          }}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          panelClassName="bg-white rounded-lg shadow-sm w-full max-w-sm overflow-hidden border border-zinc-200"
        >
            <div className="p-4 border-b border-zinc-100 flex items-center gap-2.5 bg-zinc-50">
              <Plus className="w-4 h-4 shrink-0 text-zinc-500" />
              <h3 className="font-semibold text-sm text-zinc-900">
                {launchModalMode === 'session' ? 'New session in workspace' : 'New workspace & session'}
              </h3>
            </div>
            <div className="p-4 space-y-3">
              {launchModalError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{launchModalError}</p>
              )}
              {launchModalMode === 'workspace' ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Workspace name</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder="quiet-forest-door"
                    className="w-full h-9 px-3 border border-zinc-200 rounded-md text-sm focus:border-black focus:ring-1 focus:ring-black"
                  />
                  <p className="text-xs text-zinc-500 mt-2">Creates an isolated workspace directory. You can add more parallel sessions later.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Workspace</label>
                  <SelectMenu
                    value={launchWorkspaceId}
                    onChange={setLaunchWorkspaceId}
                    placeholder="Select workspace"
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <p className="text-xs text-zinc-500 mt-2">Runs another agent in the same workspace for parallel development.</p>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Agent</label>
                  {selectedAgent?.llm_auth_mode === 'byok' && selectedAgent?.env_required?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openConfigModal()}
                      className="text-xs font-medium text-zinc-500 hover:text-zinc-900 flex items-center gap-1 shrink-0"
                    >
                      <Settings2 className="w-3.5 h-3.5" /> Configure Keys
                    </button>
                  )}
                </div>
                {agents.length === 0 ? (
                  <p className="text-sm text-zinc-500">No agents available.</p>
                ) : (
                  <SelectMenu
                    value={selectedAgentId}
                    onChange={setSelectedAgentId}
                    placeholder="Select agent"
                    options={agentSelectOptions}
                    searchable
                    searchPlaceholder="Search agents…"
                    recentValues={recentAgentIds}
                  />
                )}
              </div>
            </div>
            <div className="p-3 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewInstanceModal(false);
                    setLaunchModalError(null);
                  }}
                  className="h-9 px-3 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
                >
                  Cancel
                </button>
              <button
                type="button"
                disabled={
                  !selectedAgentId
                  || isLoading
                  || (launchModalMode === 'workspace' && projectCreating)
                  || (launchModalMode === 'session' && !launchWorkspaceId)
                }
                onClick={handleLaunchFromModal}
                className="h-9 px-3 flex items-center justify-center gap-2 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
              >
                <Play className="w-4 h-4" /> {isLoading || projectCreating ? 'Starting...' : launchModalMode === 'session' ? 'Start session' : 'Create & launch'}
              </button>
            </div>
        </ConsoleInlineDialog>
      )}

      {showConfigModal && (
        <ConsoleInlineDialog
          onClose={() => {
            setShowConfigModal(false);
            setConfigError(null);
            setLaunchModalError(null);
          }}
          panelClassName="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200"
        >
            <form onSubmit={handleSaveConfig}>
              <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50">
                <Settings2 className="w-5 h-5 shrink-0 text-zinc-500" />
                <h3 className="font-semibold text-sm text-zinc-900">Configure {selectedAgent?.name}</h3>
              </div>
              <div className="p-5 space-y-4">
                {configLoading ? (
                  <p className="text-sm text-zinc-500">Loading...</p>
                ) : configRequiredKeys.length === 0 ? (
                  <p className="text-sm text-zinc-500">No API keys required.</p>
                ) : (
                  <>
                    <SecretFields
                      keys={configRequiredKeys}
                      secrets={configKeys}
                      savedHints={savedConfigKeys}
                      missingKeys={configMissingKeys}
                      mono
                      onChange={(key, value) => setConfigKeys((prev) => ({ ...prev, [key]: value }))}
                    />
                  </>
                )}
                {configError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{configError}</p>
                )}
              </div>
              <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowConfigModal(false);
                    setConfigError(null);
                    setLaunchModalError(null);
                  }}
                  className="h-9 px-4 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
                >
                  {showNewInstanceModal ? 'Back' : 'Cancel'}
                </button>
                {configRequiredKeys.length > 0 && (
                  <button
                    type="submit"
                    disabled={configSaving || configMissingKeys.length > 0}
                    className="h-9 px-4 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {configSaving ? 'Saving...' : 'Save Keys'}
                  </button>
                )}
              </div>
            </form>
        </ConsoleInlineDialog>
      )}

      {/* Main Split Layout */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* Left Panel: Workspaces + Sessions */}
        <div className="flex w-full shrink-0 flex-col gap-3 min-h-0 lg:w-80 lg:min-h-0">
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openLaunchModal('workspace')}
              disabled={isLoading || agents.length === 0}
              className="flex flex-1 items-center justify-center gap-2 h-9 px-3 rounded-md text-sm font-medium bg-black text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              <FolderPlus className="w-4 h-4" /> New workspace
            </button>
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 p-4 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">Workspaces</h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {runningCount > 0 && (
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-green-600 mr-1">
                    {runningCount} running
                  </span>
                )}
                <button type="button" title="Filter" className="p-1 text-zinc-400 hover:text-zinc-700 rounded-md hover:bg-zinc-100">
                  <ListFilter className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="New workspace"
                  disabled={isLoading || agents.length === 0}
                  onClick={() => openLaunchModal('workspace')}
                  className="p-1 text-zinc-400 hover:text-zinc-700 rounded-md hover:bg-zinc-100 disabled:opacity-50"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-2 console-scroll-hidden">
              {hasRecentSection && (
                <div className="mb-3">
                  <h3 className="px-1.5 py-1 text-xs font-medium text-zinc-500">Recently</h3>
                  <div className="flex flex-col">
                    {recentSessions.map((s) => {
                      const ws = workspaces.find((w) => w.id === (s.projectId || '_orphan'))
                        || { name: s.projectName || 'Unassigned' };
                      return renderSessionRow(s, ws, { compact: true, showWorkspace: true });
                    })}
                  </div>
                </div>
              )}
              {pinnedSessions.length > 0 && (
                <div className="mb-3">
                  <h3 className="px-1.5 py-1 text-xs font-medium text-zinc-500">Pinned</h3>
                  <div className="flex flex-col">
                    {pinnedSessions.map((s) => {
                      const ws = workspaces.find((w) => w.id === (s.projectId || '_orphan')) || { name: s.projectName || 'Unassigned' };
                      return renderSessionRow(s, ws, { compact: true });
                    })}
                  </div>
                </div>
              )}
              {workspaces.length === 0 ? (
                <p className="text-sm text-zinc-500 px-2 py-1">No workspaces yet. Create one to start parallel sessions.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {hasSidebarSectionsAboveWorkspaces && (
                    <h3 className="px-1.5 py-1 text-xs font-medium text-zinc-500">Workspaces</h3>
                  )}
                  {workspaces.map((ws) => {
                    const expanded = expandedWorkspaces.has(ws.id);
                    const liveInWs = ws.sessions.filter((s) => s.alive === true).length;
                    const isOrphan = ws.id === '_orphan';
                    const wsPinned = isPinnedWorkspace(sidebarPrefs, ws.id);
                    return (
                      <div key={ws.id} className="rounded-md">
                        <div className="group flex items-center gap-0.5 rounded-md hover:bg-zinc-50">
                          <button
                            type="button"
                            onClick={() => toggleWorkspaceExpanded(ws.id)}
                            className="p-1.5 text-zinc-400 hover:text-zinc-700 shrink-0"
                            aria-expanded={expanded}
                          >
                            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          <FolderOpen className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          <button
                            type="button"
                            onClick={() => toggleWorkspaceExpanded(ws.id)}
                            className="flex-1 min-w-0 text-left py-1.5 pr-1 truncate text-sm text-zinc-800"
                            title={ws.name}
                          >
                            {ws.name}
                            {liveInWs > 0 && (
                              <span className="ml-1.5 text-[10px] font-semibold text-green-600">{liveInWs}</span>
                            )}
                          </button>
                          {!isOrphan && (
                            <>
                              <button
                                type="button"
                                title={wsPinned ? 'Unpin workspace' : 'Pin workspace'}
                                onClick={(e) => handlePinWorkspace(e, ws.id)}
                                className={`p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-opacity ${
                                  wsPinned ? 'opacity-100 text-zinc-600' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                                }`}
                              >
                                <Pin className={`w-3.5 h-3.5 ${wsPinned ? 'fill-current' : ''}`} />
                              </button>
                              <button
                                type="button"
                                title="New session in this workspace"
                                disabled={isLoading || agents.length === 0}
                                onClick={() => openLaunchModal('session', { id: ws.id, name: ws.name })}
                                className="p-1.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            title={isOrphan ? 'Clear unassigned sessions' : 'Delete workspace'}
                            disabled={deletingWorkspaceId === ws.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDeleteWorkspace(ws, e.currentTarget);
                            }}
                            className="p-1.5 mr-0.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                          >
                            <Trash2 className={`w-3.5 h-3.5 ${deletingWorkspaceId === ws.id ? 'animate-pulse' : ''}`} />
                          </button>
                        </div>
                        {expanded && (
                          <div className="ml-4 pl-2 border-l border-zinc-100 flex flex-col pb-1">
                            {renderSessionList(ws.sessions, ws, ws.id)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Terminal */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {activeSession ? (
                <AgentConsole
                  key={activeSession.sessionId}
                  sessionId={activeSession.sessionId}
                  agentName={activeSession.agentName}
                  projectId={activeSession.projectId}
                  token={token}
                  sessionLive={sessions.find((s) => s.id === activeSession.sessionId)?.alive === true}
                  onSessionEnd={handleSessionEnd}
                  onStart={handleRestartSession}
                  onStop={handleStopSession}
                  sessionControlPending={restartingSession || stoppingSession}
                  onDisconnect={() => setActiveSession(null)}
                  workspaceOpen={workspaceOpen}
                  onToggleWorkspace={() => setWorkspaceOpen((v) => !v)}
                />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-zinc-200 bg-white p-8 text-center text-zinc-400 shadow-sm">
                  <TerminalSquare className="w-12 h-12 mb-4 text-zinc-300" strokeWidth={1} />
                  <h3 className="text-base font-medium text-zinc-900 mb-1">No Active Session</h3>
                  <p className="text-sm">Expand a workspace and select a session, or create a new workspace.</p>
                </div>
              )}
          </div>
        </div>

        {/* Right Panel: Files */}
        {activeSession && workspaceOpen && (
            <div className="flex w-full shrink-0 flex-col min-h-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm lg:w-72 lg:min-h-0">
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen className="w-4 h-4 text-zinc-500 shrink-0" />
                  <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider truncate" title={activeSession.projectName}>
                    Files
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={fetchWorkspaceFiles}
                  title="Refresh files"
                  className="p-1.5 text-zinc-400 hover:text-black rounded-md hover:bg-zinc-100"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-2 min-h-0">
                {workspaceFiles.filter((f) => f.type === 'file').length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500">No files generated yet.</div>
                ) : (
                  <WorkspaceFileTree
                    items={workspaceFiles}
                    selectedPath={viewingFile?.path}
                    onOpenFile={handleOpenFile}
                  />
                )}
              </div>
            </div>
        )}

      </div>
    </div>
  );
}
