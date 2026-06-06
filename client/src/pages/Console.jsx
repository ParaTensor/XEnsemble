import React, { useState, useEffect, useContext } from 'react';
import AgentConsole from '../components/AgentConsole';
import SelectMenu from '../components/SelectMenu';
import { TerminalSquare, Play, Settings2, FolderOpen, FileText, X, RefreshCw, Plus, Trash2, ChevronRight, ChevronDown, FolderPlus, Pin, Archive, ListFilter } from 'lucide-react';
import { AuthContext } from '../App';
import { getSecretLabel, isSecretPasswordField } from '../lib/secretLabels';
import {
  loadSidebarPrefs,
  togglePinnedSession,
  togglePinnedWorkspace,
  archiveSession,
  isPinnedSession,
  isPinnedWorkspace,
  isArchivedSession,
} from '../lib/sidebarPrefs';

const DEFAULT_AGENT_ID = 'kimi-code';

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
  const { token } = useContext(AuthContext);
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(() => new Set());
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [launchModalMode, setLaunchModalMode] = useState('workspace');
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState('');
  const [projectCreating, setProjectCreating] = useState(false);
  const [launchModalError, setLaunchModalError] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
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
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [deleteConfirmSession, setDeleteConfirmSession] = useState(null);
  const [sidebarPrefs, setSidebarPrefs] = useState(() => loadSidebarPrefs());
  const [expandedSessionLists, setExpandedSessionLists] = useState(() => new Set());

  const refreshSidebarPrefs = () => setSidebarPrefs(loadSidebarPrefs());

  useEffect(() => {
    if (!token) return;
    fetch('http://localhost:3000/api/v1/agents', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) {
          setAgents([]);
          return;
        }
        setAgents(data);
        if (data.length > 0) {
          const preferred = data.find((a) => a.id === DEFAULT_AGENT_ID) || data[0];
          setSelectedAgentId(preferred.id);
        } else {
          setSelectedAgentId('');
        }
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
    fetch('http://localhost:3000/api/v1/projects', {
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
    fetch('http://localhost:3000/api/v1/sessions', {
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
    fetch(`http://localhost:3000/api/v1/workspace/files?project_id=${encodeURIComponent(activeSession.projectId)}`, {
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
    required.forEach(k => { initialKeys[k] = ''; });
    setConfigKeys(initialKeys);
    setSavedConfigKeys({});
    setShowConfigModal(true);
    setConfigLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        const saved = {};
        required.forEach(k => {
          if (data[k]) saved[k] = data[k];
        });
        setSavedConfigKeys(saved);
        setConfigKeys(prev => {
          const next = { ...prev };
          required.forEach(k => {
            if (saved[k]) next[k] = saved[k];
          });
          return next;
        });
      }
    } catch {
      // Modal still opens; user can enter keys manually
    } finally {
      setConfigLoading(false);
    }
  };

  const ensureAgentSecrets = async (agent) => {
    const required = agent?.env_required || [];
    if (required.length === 0) return true;
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) return false;
      const missing = required.filter(k => !data[k]);
      if (missing.length === 0) return true;
      setError(`Missing required keys: ${missing.join(', ')}`);
      openConfigModal();
      return false;
    } catch {
      setError('Could not verify API keys. Open Settings from the account menu to configure them.');
      openConfigModal();
      return false;
    }
  };

  const handleCreateProject = async (nameOverride) => {
    const name = (nameOverride ?? newProjectName).trim() || defaultWorkspaceName();
    setProjectCreating(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3000/api/v1/projects', {
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
          throw new Error(`Project quota exceeded (${data.current}/${data.limit}).`);
        }
        throw new Error(data.error || 'Failed to create project');
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

      const response = await fetch('http://localhost:3000/api/v1/session/start', {
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
          setLaunchModalError(`Quota exceeded (${data.dimension}: ${data.current}/${data.limit}).`);
          return false;
        }
        if (/Missing required env|Secrets Vault/i.test(msg)) {
          setLaunchModalError(msg);
          openConfigModal();
          return false;
        }
        throw new Error(msg);
      }

      setActiveSession({
        sessionId: data.session_id,
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
    const required = selectedAgent?.env_required || [];
    const payload = {};
    required.forEach(k => {
      const value = configKeys[k]?.trim();
      if (value) payload[k] = value;
    });
    const missing = required.filter(k => !payload[k] && !savedConfigKeys[k]);
    if (missing.length > 0) {
      setError(`Missing required keys: ${missing.join(', ')}`);
      setShowErrorModal(true);
      return;
    }
    if (Object.keys(payload).length === 0) {
      setShowConfigModal(false);
      return;
    }
    setConfigSaving(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save keys');
      setSavedConfigKeys(prev => ({ ...prev, ...payload }));
      setShowConfigModal(false);
      setLaunchModalError(null);
      // Optional: immediately launch the agent after saving keys
      // handleStartSession();
    } catch (err) {
      setError(err.message);
      setShowErrorModal(true);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleOpenFile = async (file) => {
    if (file.type !== 'file') return;
    try {
      const res = await fetch(
        `http://localhost:3000/api/v1/workspace/file?project_id=${encodeURIComponent(activeSession.projectId)}&path=${encodeURIComponent(file.path)}`,
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

  const getAgentLabel = (agentId) => agents.find((a) => a.id === agentId)?.name || agentId;

  const handleDeleteSession = async (sessionId) => {
    setDeletingSessionId(sessionId);
    try {
      const res = await fetch(`http://localhost:3000/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete session');
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

  const selectSession = (s, ws) => {
    setActiveSession({
      sessionId: s.id,
      agentName: getAgentLabel(s.agentId),
      projectId: s.projectId,
      projectName: s.projectName || ws?.name,
    });
    if (s.projectId) {
      setExpandedWorkspaces((prev) => {
        const next = new Set(prev);
        next.add(s.projectId);
        return next;
      });
    }
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

  const renderSessionRow = (s, ws, { compact = false } = {}) => {
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
          className="flex-1 min-w-0 text-left truncate text-xs text-zinc-700 disabled:opacity-50"
          title={label}
        >
          {label}
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
  const runningCount = sessions.filter((s) => s.alive === true).length;

  return (
    <>
      {/* Dialog Modals */}
      {deleteConfirmSession && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200">
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
          </div>
        </div>
      )}

      {showErrorModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200">
            <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-red-50 text-red-600">
              <X className="w-5 h-5 shrink-0" />
              <h3 className="font-semibold text-sm">Action Failed</h3>
            </div>
            <div className="p-5 text-sm text-zinc-600 break-words">
              {error}
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
              {/Missing required|Secrets Vault/i.test(error || '') && selectedAgent?.env_required?.length > 0 && (
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
          </div>
        </div>
      )}

      {showNewInstanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-sm w-full max-w-sm overflow-hidden border border-zinc-200">
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
                  <p className="text-xs text-zinc-500 mt-2">Creates an isolated project directory. You can add more parallel sessions later.</p>
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
                  {selectedAgent?.env_required?.length > 0 && (
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
                    options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
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
          </div>
        </div>
      )}

      {showConfigModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200">
            <form onSubmit={handleSaveConfig}>
              <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50">
                <Settings2 className="w-5 h-5 shrink-0 text-zinc-500" />
                <h3 className="font-semibold text-sm text-zinc-900">Configure {selectedAgent?.name}</h3>
              </div>
              <div className="p-5 space-y-4">
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</p>
                )}
                <p className="text-sm text-zinc-500 mb-4">
                  Please provide the required API keys for this agent. They will be securely saved to your personal vault.
                </p>
                {configLoading ? (
                  <p className="text-sm text-zinc-500">Loading saved keys...</p>
                ) : selectedAgent?.env_required?.length === 0 ? (
                  <p className="text-sm font-medium text-zinc-900">No special API keys required for this agent.</p>
                ) : (
                  selectedAgent?.env_required?.map(key => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-zinc-900">{getSecretLabel(key)}</label>
                        {savedConfigKeys[key] && (
                          <span className="text-xs text-green-600 font-medium">Saved</span>
                        )}
                      </div>
                      <input 
                        type={isSecretPasswordField(key) ? 'password' : 'text'}
                        className="w-full h-9 px-3 border border-zinc-200 rounded-md focus:border-black focus:ring-1 focus:ring-black text-sm font-mono"
                        value={configKeys[key] || ''}
                        onChange={e => setConfigKeys({...configKeys, [key]: e.target.value})}
                        placeholder={savedConfigKeys[key] ? 'Leave unchanged or enter new value' : `Enter ${getSecretLabel(key)}`}
                      />
                    </div>
                  ))
                )}
              </div>
              <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
                <button 
                  type="button"
                  onClick={() => {
                    setShowConfigModal(false);
                    setLaunchModalError(null);
                  }}
                  className="h-9 px-4 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
                >
                  {showNewInstanceModal ? 'Back' : 'Cancel'}
                </button>
                {selectedAgent?.env_required?.length > 0 && (
                  <button 
                    type="submit"
                    disabled={configSaving}
                    className="h-9 px-4 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {configSaving ? 'Saving...' : 'Save Keys'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Split Layout */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left Panel: Workspaces + Sessions */}
        <div className="flex w-full shrink-0 flex-col gap-3 min-h-0 lg:w-80">
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
            <div className="flex-1 overflow-auto p-2">
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
                  {pinnedSessions.length > 0 && (
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
                                className="p-1.5 mr-0.5 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
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

        {/* Center: Terminal and File Viewer */}
        <div className="flex-1 min-w-0 flex flex-col gap-6 min-h-0">
          {/* File Viewer Modal / Inline Panel */}
          {viewingFile && (
            <div className="h-1/2 bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col overflow-hidden shrink-0">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-semibold text-zinc-900">{viewingFile.name}</span>
                  <span className="text-xs text-zinc-400 font-mono">{viewingFile.path}</span>
                </div>
                <button onClick={() => setViewingFile(null)} className="text-zinc-400 hover:text-black p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-zinc-50/30 text-sm font-mono text-zinc-800 whitespace-pre">
                {fileContent}
              </div>
            </div>
          )}

          {/* Terminal View */}
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {activeSession ? (
                <AgentConsole
                  key={activeSession.sessionId}
                  sessionId={activeSession.sessionId}
                  agentName={activeSession.agentName}
                  projectId={activeSession.projectId}
                  token={token}
                  onSessionEnd={handleSessionEnd}
                  onDisconnect={() => setActiveSession(null)}
                  workspaceOpen={workspaceOpen}
                  onToggleWorkspace={() => setWorkspaceOpen((v) => !v)}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 p-8 text-center bg-zinc-50/50">
                  <TerminalSquare className="w-12 h-12 mb-4 text-zinc-300" strokeWidth={1} />
                  <h3 className="text-base font-medium text-zinc-900 mb-1">No Active Session</h3>
                  <p className="text-sm">Expand a workspace and select a session, or create a new workspace.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Workspace */}
        {activeSession && workspaceOpen && (
            <div className="w-full lg:w-72 shrink-0 flex flex-col min-h-0 bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen className="w-4 h-4 text-zinc-500 shrink-0" />
                  <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider truncate" title={activeSession.projectName}>
                    {activeSession.projectName || 'Workspace'}
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
                {workspaceFiles.filter(f => f.type === 'file').length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500">No files generated yet.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {workspaceFiles.filter(f => f.type === 'file').map((file, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleOpenFile(file)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left truncate transition-colors ${viewingFile?.path === file.path ? 'bg-zinc-100 text-black font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                        <span className="truncate">{file.path}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
        )}

      </div>
    </>
  );
}
