import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AgentConsole from '../components/AgentConsole';
import WorkspaceFileTree from '../components/WorkspaceFileTree';
import WorkspaceShell from '../components/WorkspaceShell';
import RepoImportDialog from '../components/git/RepoImportDialog';
import GitStatusBar from '../components/git/GitStatusBar';
import { apiFetch } from '../lib/api';
import {
  ConsoleDialogShell,
  ConsoleInlineDialog,
} from '../components/ConsoleDialog';
import SelectMenu from '../components/SelectMenu';
import { useToast } from '../components/Toast';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
import {
  TerminalSquare,
  Play,
  Settings2,
  X,
  RefreshCw,
  Plus,
  Bot,
  PanelRightOpen,
  PanelRightClose,
  FileText,
  Eye,
  EyeOff,
  Square,
  Unplug,
  Loader2,
} from 'lucide-react';
import { getSecretLabel } from '../lib/secretLabels';
import { formatQuotaExceeded } from '../lib/quotaLabels';
import {
  archiveSession,
  loadSidebarPrefs,
  purgeWorkspaceSidebarPrefs,
  rememberRecentSession,
  replaceRecentSessionId,
  sortAgentsByRecentUsage,
  rememberRecentAgent,
} from '../lib/sidebarPrefs';
import {
  consoleDialogPanelClass,
  consoleStructuredDialogHeaderClass,
  consoleStructuredDialogFooterClass,
  consoleStructuredDialogBodyClass,
  consoleIconButtonClass,
  consoleInputClass,
  bgCanvas,
  textPrimary,
  textTertiary,
  textPlaceholder,
  borderHairline,
  transitionBase,
  hoverBgSecondary,
  hoverBgTertiary,
  hoverTextPrimary,
} from '../lib/consoleTheme.js';

const DEFAULT_AGENT_ID = 'kimi-code';

function pickDefaultAgentId(agents, preferredId) {
  if (preferredId && agents.some((a) => a.id === preferredId)) return preferredId;
  const preferred = agents.find((a) => a.id === DEFAULT_AGENT_ID) || agents[0];
  return preferred?.id || '';
}

const SLUG_WORDS = [
  'small', 'heavy', 'many', 'quiet', 'swift', 'bright', 'calm', 'bold', 'brave', 'clear',
  'dark', 'fast', 'fresh', 'grand', 'keen', 'light', 'neat', 'proud', 'sharp', 'warm',
];

function defaultWorkspaceName() {
  const pick = () => SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${pick()}-${pick()}`;
}

export default React.forwardRef(function Sessions({
  /* token, user kept for API compat */
  agents,
  projects,
  setProjects,
  sessions,
  setSessions,
  activeSession,
  setActiveSession,
  fetchWorkspaces,
  className,
}, ref) {
  const navigate = useNavigate();
  const location = useLocation();
  const goToSessions = useCallback(() => {
    if (location.pathname !== '/sessions') navigate('/sessions');
  }, [location.pathname, navigate]);

  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [launchModalMode, setLaunchModalMode] = useState('workspace');
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState('');
  const [projectCreating, setProjectCreating] = useState(false);
  const [launchModalError, setLaunchModalError] = useState(null);
  const [startSessionAfterCreate, setStartSessionAfterCreate] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [launchingSession, setLaunchingSession] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [_error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState('files');
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [viewingFile, setViewingFile] = useState(null);
  const [fileContent, setFileContent] = useState('');

  // eslint-disable-next-line no-unused-vars
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configKeys, setConfigKeys] = useState({});
  const [savedConfigKeys, setSavedConfigKeys] = useState({});
  // eslint-disable-next-line no-unused-vars
  const [_configSaving, setConfigSaving] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [_configLoading, setConfigLoading] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [_configError, setConfigError] = useState(null);
  const { showToast } = useToast();
  const { themeId, preset } = useTerminalTheme();
  // eslint-disable-next-line no-unused-vars
  const [_deletingSessionId, setDeletingSessionId] = useState(null);
  const [restartingSession, setRestartingSession] = useState(false);
  const [stoppingSession, setStoppingSession] = useState(false);
  const [deleteConfirmSession, setDeleteConfirmSession] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [_deleteConfirmWorkspace, setDeleteConfirmWorkspace] = useState(null);

  const [showNewInstanceModal, setShowNewInstanceModal] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [createNewWorkspaceInline, setCreateNewWorkspaceInline] = useState(false);

  const getAgentLabel = useCallback(
    (agentId) => agents.find((a) => a.id === agentId)?.name || agentId,
    [agents],
  );

  useEffect(() => {
    if (activeSession) setLaunchingSession(false);
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession?.projectId) {
      setPanelOpen(false);
      setPanelTab('files');
    }
    setViewingFile(null);
    setFileContent('');
    setWorkspaceFiles([]);
  }, [activeSession?.projectId]);

  useEffect(() => {
    if (agents.length === 0) return;
    setSelectedAgentId((prev) => pickDefaultAgentId(agents, prev));
  }, [agents]);

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
      const res = await apiFetch('/api/v1/secrets');
      const data = await res.json();
      if (res.ok) {
        const saved = {};
        const loaded = {};
        required.forEach((k) => {
          if (data[k]) saved[k] = true;
          if (data[k] && data[k] !== '***') loaded[k] = data[k];
          else loaded[k] = '';
        });
        setSavedConfigKeys(saved);
        setConfigKeys(loaded);
      }
    } catch {
      setConfigError('Could not load saved keys.');
    } finally {
      setConfigLoading(false);
    }
  };

  const configRequiredKeys = selectedAgent?.env_required || [];
  // eslint-disable-next-line no-unused-vars
  const configMissingKeys = useMemo(
    () => configRequiredKeys.filter((k) => !savedConfigKeys[k] && !configKeys[k]?.trim()),
    [configRequiredKeys, savedConfigKeys, configKeys],
  );

  const ensureAgentSecrets = async (agent) => {
    const required = agent?.env_required || [];
    if (required.length === 0 || agent?.llm_auth_mode === 'gateway') return true;
    try {
      const res = await apiFetch('/api/v1/secrets');
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
      const res = await apiFetch('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401 || data.error === 'Unauthorized') {
          throw new Error('登录已过期，请重新登录。');
        }
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

      const response = await apiFetch('/api/v1/session/start', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: selectedAgentId,
          project_id: projectId,
          terminal_theme_id: themeId,
        })
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = data.detail || data.error || data.message || 'Failed to start session';
        if (response.status === 401 || msg === 'Unauthorized') {
          setLaunchModalError('登录已过期，请重新登录。');
          return false;
        }
        if (data.error === 'agent_not_granted') {
          setLaunchModalError('You do not have permission to use this agent.');
          return false;
        }
        if (data.error === 'quota_exceeded') {
          setLaunchModalError(formatQuotaExceeded(data.dimension, data.current, data.limit));
          fetchWorkspaces();
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
      setActiveSession({
        sessionId: data.session_id,
        agentId: selectedAgentId,
        agentName: selectedAgent.name,
        projectId,
        projectName: projectName || projectId,
      });
      goToSessions();
      setSessions((prev) => {
        if (prev.some((s) => s.id === data.session_id)) return prev;
        const now = Date.now();
        return [
          ...prev,
          {
            id: data.session_id,
            projectId,
            agentId: selectedAgentId,
            status: data.status || 'running',
            alive: true,
            projectName: projectName || projectId,
            createdAt: now,
          },
        ];
      });
      fetchWorkspaces();
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

  const resolveDefaultWorkspace = useCallback(() => {
    if (activeSession?.projectId) {
      const ws = projects.find((p) => p.id === activeSession.projectId);
      if (ws) return ws;
    }
    const prefs = loadSidebarPrefs();
    for (const sessionId of prefs.recentSessionIds || []) {
      const snap = prefs.recentSessionSnapshots?.[sessionId];
      if (snap?.projectId) {
        const ws = projects.find((p) => p.id === snap.projectId);
        if (ws) return ws;
      }
    }
    if (projects.length === 0) return null;
    return [...projects].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  }, [activeSession?.projectId, projects]);

  const openLaunchModal = (mode = 'session', workspace = null) => {
    setLaunchModalError(null);
    setCreateNewWorkspaceInline(false);
    if (mode === 'workspace') {
      setLaunchModalMode('workspace');
      setStartSessionAfterCreate(false);
      setLaunchWorkspaceId('');
      setNewProjectName('');
    } else if (projects.length === 0) {
      setLaunchModalMode('quickstart');
      setStartSessionAfterCreate(true);
      setLaunchWorkspaceId('');
      setNewProjectName('');
    } else {
      setLaunchModalMode('session');
      setStartSessionAfterCreate(true);
      const ws = workspace || resolveDefaultWorkspace();
      if (ws) {
        setLaunchWorkspaceId(ws.id);
        setNewProjectName(ws.name);
      } else {
        setLaunchWorkspaceId('');
        setNewProjectName('');
      }
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
    setLaunchingSession(true);
    let started = false;
    try {
      if (launchModalMode === 'quickstart') {
        const name = newProjectName.trim() || defaultWorkspaceName();
        const created = await handleCreateProject(name);
        if (!created) return;
        setProjects((prev) => {
          if (prev.some((p) => p.id === created.id)) return prev;
          return [...prev, { id: created.id, name: created.name, createdAt: Date.now() }];
        });
        started = await handleStartSession(created.id, created.name, { closeLaunchModal: true });
        return;
      }
      if (launchModalMode === 'session') {
        if (createNewWorkspaceInline) {
          const name = newProjectName.trim() || defaultWorkspaceName();
          const created = await handleCreateProject(name);
          if (!created) return;
          setProjects((prev) => {
            if (prev.some((p) => p.id === created.id)) return prev;
            return [...prev, { id: created.id, name: created.name, createdAt: Date.now() }];
          });
          started = await handleStartSession(created.id, created.name, { closeLaunchModal: true });
          return;
        }
        if (!launchWorkspaceId) {
          setLaunchModalError('Select a workspace first.');
          return;
        }
        const ws = projects.find((p) => p.id === launchWorkspaceId);
        started = await handleStartSession(launchWorkspaceId, ws?.name || launchWorkspaceId, { closeLaunchModal: true });
        return;
      }
      const name = newProjectName.trim() || defaultWorkspaceName();
      const created = await handleCreateProject(name);
      if (!created) return;
      setProjects((prev) => {
        if (prev.some((p) => p.id === created.id)) return prev;
        return [...prev, { id: created.id, name: created.name, createdAt: Date.now() }];
      });
      if (startSessionAfterCreate) {
        started = await handleStartSession(created.id, created.name, { closeLaunchModal: true });
        if (!started) fetchWorkspaces();
      } else {
        fetchWorkspaces();
        setShowNewInstanceModal(false);
      }
    } finally {
      if (!started) setLaunchingSession(false);
    }
  };

  // eslint-disable-next-line no-unused-vars
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
      const res = await apiFetch('/api/v1/secrets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save keys');
      setSavedConfigKeys((prev) => {
        const next = { ...prev };
        required.forEach((k) => { if (payload[k] || prev[k]) next[k] = true; });
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

  const fetchWorkspaceFiles = useCallback(async ({ notifyError = false } = {}) => {
    if (!activeSession?.projectId) return;
    setIsLoadingFiles(true);
    try {
      const qs = new URLSearchParams({ project_id: activeSession.projectId });
      if (showHiddenFiles) qs.set('include_hidden', '1');
      const res = await apiFetch(`/api/v1/workspace/files?${qs}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load workspace files');
      }
      setWorkspaceFiles(Array.isArray(data) ? data : []);
    } catch (err) {
      if (notifyError) showToast('error', err.message);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [activeSession?.projectId, showHiddenFiles, showToast]);

  useEffect(() => {
    if (!activeSession?.projectId || !panelOpen || panelTab !== 'files') return undefined;
    fetchWorkspaceFiles();
    const interval = setInterval(fetchWorkspaceFiles, 10000);
    return () => clearInterval(interval);
  }, [activeSession?.projectId, fetchWorkspaceFiles, panelOpen, panelTab, showHiddenFiles]);

  const handleOpenFile = useCallback(async (file) => {
    if (!activeSession?.projectId || file?.type !== 'file') return;
    try {
      const res = await apiFetch(
        `/api/v1/workspace/file?project_id=${encodeURIComponent(activeSession.projectId)}&path=${encodeURIComponent(file.path)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to read file');
      }
      setViewingFile(file);
      setFileContent(data.content || '');
    } catch (err) {
      showToast('error', err.message);
    }
  }, [activeSession?.projectId, showToast]);

  const handleSessionEnd = (sessionId) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, alive: false, memoryStatus: 'exited', status: 'exited' } : s
      )
    );
    fetchWorkspaces();
  };

  const handleRestartSession = async () => {
    if (!activeSession) return;
    const agentId = activeSession.agentId || sessions.find((s) => s.id === activeSession.sessionId)?.agentId;
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
      const deleteRes = await apiFetch(`/api/v1/sessions/${encodeURIComponent(oldSessionId)}`, { method: 'DELETE' });
      if (!deleteRes.ok) throw new Error('Failed to release previous session');

      const response = await apiFetch('/api/v1/session/start', {
        method: 'POST',
        body: JSON.stringify({ agent_id: agentId, project_id: activeSession.projectId, terminal_theme_id: themeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start session');

      replaceRecentSessionId(oldSessionId, data.session_id, {
        agentId, projectId: activeSession.projectId, projectName: activeSession.projectName, createdAt: Date.now(),
      });
      rememberRecentAgent(agentId);
      setActiveSession({
        sessionId: data.session_id,
        agentId,
        agentName: agent?.name || activeSession.agentName,
        projectId: activeSession.projectId,
        projectName: activeSession.projectName,
      });
      goToSessions();
      setSessions((prev) => {
        if (prev.some((s) => s.id === data.session_id)) return prev;
        const now = Date.now();
        return [...prev, { id: data.session_id, projectId: activeSession.projectId, agentId, status: 'running', alive: true, projectName: activeSession.projectName, createdAt: now }];
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
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(activeSession.sessionId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to stop session');
      rememberRecentSession({ id: activeSession.sessionId, agentId: activeSession.agentId, projectId: activeSession.projectId, projectName: activeSession.projectName, createdAt: Date.now() });
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
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete session');
      archiveSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSession?.sessionId === sessionId) setActiveSession(null);
      setDeleteConfirmSession(null);
      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const requestDeleteSession = (session, ws) => {
    setDeleteConfirmSession({
      sessionId: session.id,
      isLive: session.alive === true,
      agentLabel: getAgentLabel(session.agentId),
      workspaceName: ws?.name || 'Unassigned',
    });
  };

  // eslint-disable-next-line no-unused-vars
  const handleDeleteWorkspace = async (workspaceId) => {
    try {
      if (workspaceId === '_orphan') {
        const orphanSessions = sessions.filter((s) => !s.projectId);
        for (const s of orphanSessions) {
          await apiFetch(`/api/v1/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
        }
        if (activeSession && !activeSession.projectId) setActiveSession(null);
      } else {
        await apiFetch(`/api/v1/projects/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
        if (activeSession?.projectId === workspaceId) setActiveSession(null);
      }
      purgeWorkspaceSidebarPrefs(workspaceId, sessions);
      setSessions((prev) => prev.filter((s) => (workspaceId === '_orphan' ? Boolean(s.projectId) : s.projectId !== workspaceId)));
      if (workspaceId !== '_orphan') {
        setProjects((prev) => prev.filter((p) => p.id !== workspaceId));
      }
      setDeleteConfirmWorkspace(null);
      fetchWorkspaces();
      showToast('success', workspaceId === '_orphan' ? 'Unassigned sessions cleared.' : 'Workspace deleted.');
    } catch (err) {
      showToast('error', err.message);
    }
  };

  const requestDeleteWorkspace = (ws) => {
    const liveCount = ws.sessions.filter((s) => s.alive === true).length;
    setDeleteConfirmWorkspace({
      workspaceId: ws.id,
      workspaceName: ws.name,
      sessionCount: ws.sessions.length,
      liveCount,
      isOrphan: ws.id === '_orphan',
    });
  };

  React.useImperativeHandle(ref, () => ({
    openLaunchModal,
    openImportDialog: () => setShowImportDialog(true),
    requestDeleteSession,
    requestDeleteWorkspace,
  }), [openLaunchModal, requestDeleteSession, requestDeleteWorkspace]);

  const agentSelectOptions = useMemo(
    () => sortAgentsByRecentUsage(agents, loadSidebarPrefs()).map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeSession?.projectId) || null,
    [projects, activeSession?.projectId],
  );

  const sessionAlive = sessions.find((s) => s.id === activeSession?.sessionId)?.alive === true;
  const sessionControlPending = restartingSession || stoppingSession;

  return (
    <div className={className || 'h-full w-full'}>
      {/* Launch modal */}
      {showNewInstanceModal && (
        <ConsoleInlineDialog
          onClose={() => { setShowNewInstanceModal(false); setLaunchModalError(null); setCreateNewWorkspaceInline(false); }}
          panelClassName={`${consoleDialogPanelClass} w-full max-w-sm shadow-sm`}
        >
          <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-2.5`}>
            {launchModalMode === 'workspace' ? (
              <Plus className={`w-4 h-4 shrink-0 ${textPlaceholder}`} />
            ) : (
              <Bot className={`w-4 h-4 shrink-0 ${textPlaceholder}`} />
            )}
            <h3 className={`font-semibold text-sm ${textPrimary}`}>
              {launchModalMode === 'workspace'
                ? 'New Workspace'
                : launchModalMode === 'quickstart'
                  ? 'New Agent'
                  : 'New Agent'}
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {launchModalError && (
              <p className="text-sm text-[#C06C5D] bg-[#FDECEA] border border-[#FADBD8] rounded-md px-3 py-2">{launchModalError}</p>
            )}
            {launchModalMode === 'workspace' && (
              <div>
                <label className={`block text-xs font-semibold uppercase tracking-wider ${textPlaceholder} mb-1`}>Workspace name</label>
                <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="my-workspace" className={consoleInputClass} autoFocus />
              </div>
            )}
            {(launchModalMode === 'quickstart' || launchModalMode === 'session') && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${textPlaceholder}`}>Workspace</label>
                  {launchModalMode === 'session' && !createNewWorkspaceInline && projects.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreateNewWorkspaceInline(true);
                        setNewProjectName('');
                        setLaunchWorkspaceId('');
                      }}
                      className={`text-xs font-medium ${textPlaceholder} hover:text-[#202124] ${transitionBase}`}
                    >
                      New workspace
                    </button>
                  )}
                </div>
                {launchModalMode === 'quickstart' || createNewWorkspaceInline ? (
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder={launchModalMode === 'quickstart' ? 'Optional — auto-generated if empty' : 'my-workspace'}
                    className={consoleInputClass}
                    autoFocus
                  />
                ) : (
                  <SelectMenu
                    value={launchWorkspaceId}
                    onChange={setLaunchWorkspaceId}
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                    placeholder="Select workspace"
                  />
                )}
              </div>
            )}
            {launchModalMode !== 'workspace' && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${textPlaceholder}`}>Agent</label>
                  {selectedAgent?.llm_auth_mode === 'byok' && selectedAgent?.env_required?.length > 0 && (
                    <button type="button" onClick={() => openConfigModal()} className={`text-xs font-medium ${textPlaceholder} hover:text-[#202124]`}>
                      <Settings2 className="w-3.5 h-3.5 inline" /> Configure Keys
                    </button>
                  )}
                </div>
                <SelectMenu
                  value={selectedAgentId}
                  onChange={setSelectedAgentId}
                  options={agentSelectOptions}
                  placeholder="Select agent"
                />
              </div>
            )}
          </div>
          <div className={consoleStructuredDialogFooterClass}>
            <button type="button" onClick={() => { setShowNewInstanceModal(false); setCreateNewWorkspaceInline(false); }} className={`h-9 px-3 ${bgCanvas} border ${borderHairline} ${textPrimary} rounded-md text-sm font-medium ${hoverBgSecondary} ${transitionBase}`}>Cancel</button>
            <button
              type="button"
              disabled={
                isLoading
                || projectCreating
                || (launchModalMode !== 'workspace' && !selectedAgentId)
                || (launchModalMode === 'session' && !createNewWorkspaceInline && !launchWorkspaceId)
              }
              onClick={handleLaunchFromModal}
              className={`h-9 px-3 flex items-center justify-center gap-2 bg-[#202124] text-white rounded-md text-sm font-medium hover:bg-[#3C4043] disabled:opacity-50 ${transitionBase}`}
            >
              {isLoading || projectCreating
                ? 'Starting...'
                : launchModalMode === 'workspace'
                  ? 'Create workspace'
                  : 'Start agent'}
            </button>
          </div>
        </ConsoleInlineDialog>
      )}

      {/* Simple delete confirm */}
      {deleteConfirmSession && (
        <ConsoleInlineDialog onClose={() => setDeleteConfirmSession(null)} panelClassName={`${consoleDialogPanelClass} w-full max-w-md`}>
          <div className={`${consoleStructuredDialogHeaderClass}`}>Confirm</div>
          <div className="p-5 text-sm">Remove this session?</div>
          <div className={consoleStructuredDialogFooterClass}>
            <button onClick={() => setDeleteConfirmSession(null)} className="h-9 px-4 border rounded-md">Cancel</button>
            <button onClick={() => handleDeleteSession(deleteConfirmSession.sessionId)} className="h-9 px-4 bg-[#C06C5D] text-white rounded-md">Remove</button>
          </div>
        </ConsoleInlineDialog>
      )}

      {/* Main area */}
      <div className="flex min-h-0 flex-1 w-full flex-row items-stretch bg-white">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          <div className="h-12 border-b border-[#E8EAED] flex items-center justify-between px-5 shrink-0 bg-white">
            <div className="flex items-center gap-3 min-w-0">
              {activeSession ? (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <h1 className="truncate text-[15px] font-semibold text-[#202124]">
                      {activeSession.projectName || activeSession.agentName || 'Session'}
                    </h1>
                    <span className="inline-flex shrink-0 items-center rounded-md bg-[#F4F5F6] px-2 py-0.5 text-[11px] font-medium text-[#5F6368]">
                      {activeSession.agentName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${sessionAlive ? 'bg-[#4A7C59]' : 'bg-[#9AA0A6]'}`}
                    />
                    <span className="text-[11px] text-[#9AA0A6]">
                      {sessionAlive ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                </>
              ) : (
                <h1 className="text-[15px] font-semibold text-[#202124]">Sessions</h1>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {activeSession && (
                <>
                  <div className="mx-0.5 h-5 w-px bg-[#E8EAED]" />
                  {sessionAlive ? (
                    <button
                      type="button"
                      onClick={handleStopSession}
                      disabled={sessionControlPending}
                      className={`${consoleIconButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={stoppingSession ? 'Stopping…' : 'Stop session'}
                      aria-label={stoppingSession ? 'Stopping session' : 'Stop session'}
                    >
                      {stoppingSession ? (
                        <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <Square className="w-4 h-4" strokeWidth={1.75} />
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRestartSession}
                      disabled={sessionControlPending}
                      className={`${consoleIconButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={restartingSession ? 'Starting…' : 'Start session'}
                      aria-label={restartingSession ? 'Starting session' : 'Start session'}
                    >
                      {restartingSession ? (
                        <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <Play className="w-4 h-4" strokeWidth={1.75} />
                      )}
                    </button>
                  )}
                  {sessionAlive && (
                    <button
                      type="button"
                      onClick={handleRestartSession}
                      disabled={sessionControlPending}
                      className={`${consoleIconButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={restartingSession ? 'Restarting…' : 'Restart session'}
                      aria-label={restartingSession ? 'Restarting session' : 'Restart session'}
                    >
                      {restartingSession ? (
                        <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveSession(null)}
                    className={consoleIconButtonClass}
                    title="Disconnect view"
                    aria-label="Disconnect view"
                  >
                    <Unplug className="w-4 h-4" strokeWidth={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelOpen((prev) => !prev)}
                    className={`${consoleIconButtonClass} ${panelOpen ? 'bg-[#F4F5F6] text-[#202124]' : ''}`}
                    title={panelOpen ? 'Close workspace panel' : 'Open workspace panel'}
                    aria-label={panelOpen ? 'Close workspace panel' : 'Open workspace panel'}
                  >
                    {panelOpen ? <PanelRightClose className="w-4 h-4" strokeWidth={1.75} /> : <PanelRightOpen className="w-4 h-4" strokeWidth={1.75} />}
                  </button>
                </>
              )}
            </div>
          </div>
          {activeSession ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1 flex-col p-4">
                  <div
                    className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E8EAED] shadow-sm"
                    style={{ backgroundColor: preset.xterm.background }}
                  >
                    <AgentConsole
                      key={activeSession.sessionId}
                      sessionId={activeSession.sessionId}
                      agentName={activeSession.agentName}
                      projectId={activeSession.projectId}
                      onSessionEnd={handleSessionEnd}
                      sessionLive={sessionAlive}
                    />
                  </div>
                </div>
                <GitStatusBar projectId={activeSession.projectId} project={activeProject} />
              </div>
              {panelOpen && (
                <div className="flex min-h-0 w-80 shrink-0 flex-col border-l border-[#E8EAED] bg-white">
                  <div className="flex h-12 items-center justify-between border-b border-[#E8EAED] px-3 shrink-0">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPanelTab('files')}
                        className={`px-2.5 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                          panelTab === 'files'
                            ? 'border-[#202124] text-[#202124]'
                            : 'border-transparent text-[#5F6368] hover:text-[#202124]'
                        }`}
                      >
                        Files
                      </button>
                      <button
                        type="button"
                        onClick={() => setPanelTab('shell')}
                        className={`px-2.5 py-1.5 text-sm font-medium border-b-2 transition-colors ${
                          panelTab === 'shell'
                            ? 'border-[#202124] text-[#202124]'
                            : 'border-transparent text-[#5F6368] hover:text-[#202124]'
                        }`}
                      >
                        Shell
                      </button>
                    </div>
                    {panelTab === 'files' && (
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => setShowHiddenFiles((v) => !v)}
                          className={`p-2 rounded-lg transition-colors ${
                            showHiddenFiles
                              ? 'text-[#202124] bg-[#F4F5F6]'
                              : 'text-[#5F6368] hover:bg-[#F4F5F6]'
                          }`}
                          title={showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}
                          aria-label={showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}
                          aria-pressed={showHiddenFiles}
                        >
                          {showHiddenFiles ? (
                            <EyeOff className="w-4 h-4" strokeWidth={1.75} />
                          ) : (
                            <Eye className="w-4 h-4" strokeWidth={1.75} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => fetchWorkspaceFiles({ notifyError: true })}
                          className="p-2 text-[#5F6368] hover:bg-[#F4F5F6] rounded-lg transition-colors"
                          title="Refresh files"
                          aria-label="Refresh files"
                        >
                          <RefreshCw className={`w-4 h-4 ${isLoadingFiles ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className={`min-h-0 flex-1 flex-col ${panelTab === 'files' ? 'flex' : 'hidden'}`}>
                    <div className="min-h-0 flex-1 overflow-auto p-3">
                      {workspaceFiles.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-[#9AA0A6]">
                          No files yet.
                        </div>
                      ) : (
                        <WorkspaceFileTree
                          items={workspaceFiles}
                          selectedPath={viewingFile?.path}
                          onOpenFile={handleOpenFile}
                          showHidden={showHiddenFiles}
                        />
                      )}
                    </div>
                  </div>
                  <div className={`min-h-0 flex-1 flex-col ${panelTab === 'shell' ? 'flex' : 'hidden'}`}>
                    <WorkspaceShell projectId={activeSession.projectId} />
                  </div>
                </div>
              )}
            </div>
          ) : launchingSession ? (
            <div className="flex-1 bg-white" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-white p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F4F5F6] mb-5">
                <TerminalSquare className="w-7 h-7 text-[#9AA0A6]" strokeWidth={1.25} />
              </div>
              <h3 className="text-lg font-semibold text-[#202124] mb-1.5">No active session</h3>
              <p className="text-sm text-[#9AA0A6] max-w-sm">
                {projects.length === 0
                  ? 'Create a workspace, then use New Agent in the sidebar to get started.'
                  : 'Select a session from the sidebar, or use New Agent to start one in a workspace.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {showImportDialog && (
        <RepoImportDialog
          open={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          onImported={() => {
            fetchWorkspaces();
          }}
          fetchWorkspaces={fetchWorkspaces}
        />
      )}

      {viewingFile && (
        <ConsoleDialogShell
          onClose={() => {
            setViewingFile(null);
            setFileContent('');
          }}
          panelClassName={`${consoleDialogPanelClass} w-[min(900px,calc(100vw-2rem))] h-[min(80vh,calc(100vh-2rem))]`}
        >
          <div className={`flex items-center justify-between ${borderHairline} border-b bg-[#FAFBFC] px-4 py-3 shrink-0`}>
            <div className="flex min-w-0 items-center gap-2">
              <FileText className={`w-4 h-4 shrink-0 ${textPlaceholder}`} />
              <span className={`truncate text-sm font-semibold ${textPrimary}`}>{viewingFile.name}</span>
              <span className={`truncate text-xs font-mono ${textPlaceholder}`}>{viewingFile.path}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setViewingFile(null);
                setFileContent('');
              }}
              className={`shrink-0 rounded-md p-1.5 ${textPlaceholder} ${hoverBgTertiary} ${hoverTextPrimary} ${transitionBase}`}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className={`${consoleStructuredDialogBodyClass} bg-[#FAFBFC] text-sm font-mono ${textTertiary} whitespace-pre`}>
            {fileContent}
          </div>
        </ConsoleDialogShell>
      )}
    </div>
  );
});
