import { apiFetch } from '../lib/api.ts';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import AgentConsole from '../components/AgentConsole';
import WorkspaceFileTree from '../components/WorkspaceFileTree';
import SelectMenu from '../components/SelectMenu';
import { ConsoleDialogShell, ConsoleInlineDialog } from '../components/ConsoleDialog';
import SecretFields from '../components/settings/SecretFields';
import { useToast } from '../components/Toast';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
import { TerminalSquare, Play, Settings2, FolderOpen, FileText, X, RefreshCw, Plus, Trash2 } from 'lucide-react';
import { getSecretLabel, isSecretPasswordField } from '../lib/secretLabels';
import { formatQuotaExceeded } from '../lib/quotaLabels';
import {
  archiveSession,
  loadSidebarPrefs,
  purgeWorkspaceSidebarPrefs,
  rememberRecentSession,
  replaceRecentSessionId,
  sortAgentsByRecentUsage,
  rememberRecentAgent,
  getRecentAgentIds,
} from '../lib/sidebarPrefs';
import {
  consoleDialogPanelClass,
  consoleStructuredDialogHeaderClass,
  consoleStructuredDialogFooterClass,
  consoleInputClass,
  bgCanvas,
  textPrimary,
  textSecondary,
  textPlaceholder,
  borderHairline,
  accentBlue,
  panelPadding,
  transitionBase,
  hoverBgSecondary,
  hoverBgCanvas,
  hoverTextPrimary,
  textTertiary,
  accentRed,
  accentRedBg,
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
  'flies', 'colts', 'items', 'signs', 'hounds', 'clouds', 'doors', 'fields', 'flames', 'gates',
  'hints', 'ideas', 'kites', 'lanes', 'maps', 'nodes', 'paths', 'roads', 'stars', 'trees',
  'film', 'play', 'argue', 'invent', 'travel', 'cheer', 'results', 'forest', 'river', 'stone',
];

function defaultWorkspaceName() {
  const pick = () => SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${pick()}-${pick()}-${pick()}`;
}

export default React.forwardRef(function SessionsPage({
  token,
  user,
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
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [launchModalMode, setLaunchModalMode] = useState('workspace');
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState('');
  const [projectCreating, setProjectCreating] = useState(false);
  const [launchModalError, setLaunchModalError] = useState(null);
  const [startSessionAfterCreate, setStartSessionAfterCreate] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [launchingSession, setLaunchingSession] = useState(false);
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
  const { themeId, preset } = useTerminalTheme();
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [restartingSession, setRestartingSession] = useState(false);
  const [stoppingSession, setStoppingSession] = useState(false);
  const [deleteConfirmSession, setDeleteConfirmSession] = useState(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState(null);
  const [deleteConfirmWorkspace, setDeleteConfirmWorkspace] = useState(null);

  React.useImperativeHandle(ref, () => ({
    openLaunchModal,
    requestDeleteSession,
    requestDeleteWorkspace,
  }));

  const getAgentLabel = useCallback(
    (agentId) => agents.find((a) => a.id === agentId)?.name || agentId,
    [agents],
  );

  const applyActiveSession = useCallback((session) => {
    if (!session) return;
    const projectName = session.projectName || projects.find((p) => p.id === session.projectId)?.name;
    setActiveSession({
      sessionId: session.id,
      agentId: session.agentId,
      agentName: getAgentLabel(session.agentId),
      projectId: session.projectId,
      projectName,
    });
  }, [getAgentLabel, projects, setActiveSession]);

  useEffect(() => {
    if (activeSession) setLaunchingSession(false);
  }, [activeSession]);

  useEffect(() => {
    if (!activeSession?.agentId || agents.length === 0) return;
    const name = agents.find((a) => a.id === activeSession.agentId)?.name;
    if (name && name !== activeSession.agentName) {
      setActiveSession((prev) => (prev ? { ...prev, agentName: name } : prev));
    }
  }, [agents, activeSession?.agentId, activeSession?.agentName, setActiveSession]);

  useEffect(() => {
    if (agents.length === 0) return;
    setSelectedAgentId((prev) => pickDefaultAgentId(agents, prev));
  }, [agents]);

  const fetchWorkspaceFiles = () => {
    if (!activeSession?.projectId) return;
    setIsLoadingFiles(true);
    apiFetch(`/api/v1/workspace/files?project_id=${encodeURIComponent(activeSession.projectId)}`)
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
  }, [activeSession]);

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
        const msg = data.error || data.message || 'Failed to start session';
        if (data.error === 'agent_not_granted') {
          setLaunchModalError('You do not have permission to use this agent. Contact an administrator.');
          return false;
        }
        if (data.error === 'quota_exceeded') {
          setLaunchModalError(formatQuotaExceeded(data.dimension, data.current, data.limit));
          fetchWorkspaces();
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
      setActiveSession({
        sessionId: data.session_id,
        agentId: selectedAgentId,
        agentName: selectedAgent.name,
        projectId,
        projectName: projectName || projectId,
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

  const openLaunchModal = (mode = 'workspace', workspace = null) => {
    setLaunchModalError(null);
    setLaunchModalMode(mode);
    setStartSessionAfterCreate(true);
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
    setLaunchingSession(true);
    let started = false;
    try {
      if (launchModalMode === 'session') {
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
      if (startSessionAfterCreate) {
        started = await handleStartSession(created.id, created.name, { closeLaunchModal: true });
      } else {
        fetchWorkspaces();
        setShowNewInstanceModal(false);
      }
    } finally {
      // On success keep the workspace dark until activeSession commits (cleared
      // by the effect below). Clearing here would leave a 1-frame gap where both
      // launchingSession and activeSession are false, flashing the white empty state.
      if (!started) setLaunchingSession(false);
    }
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
      const res = await apiFetch('/api/v1/secrets', {
        method: 'POST',
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
      const res = await apiFetch(
        `/api/v1/workspace/file?project_id=${encodeURIComponent(activeSession.projectId)}&path=${encodeURIComponent(file.path)}`
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
    fetchWorkspaces();
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

      const deleteRes = await apiFetch(`/api/v1/sessions/${encodeURIComponent(oldSessionId)}`, {
        method: 'DELETE',
      });
      if (!deleteRes.ok) {
        const deleteData = await deleteRes.json().catch(() => ({}));
        throw new Error(deleteData.error || 'Failed to release previous session');
      }

      const response = await apiFetch('/api/v1/session/start', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId,
          project_id: activeSession.projectId,
          terminal_theme_id: themeId,
        }),
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
          fetchWorkspaces();
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
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(activeSession.sessionId)}`, {
        method: 'DELETE',
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
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete session');
      // Server keeps exited rows; archive locally so workspace tree hides them after refetch.
      archiveSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));

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
          const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(s.id)}`, {
            method: 'DELETE',
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to delete session');
        }
        if (activeSession && !activeSession.projectId) setActiveSession(null);
      } else {
        const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(workspaceId)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete workspace');
        if (activeSession?.projectId === workspaceId) setActiveSession(null);
      }
      purgeWorkspaceSidebarPrefs(workspaceId, sessions);
      setSessions((prev) => prev.filter((s) => (
        workspaceId === '_orphan' ? Boolean(s.projectId) : s.projectId !== workspaceId
      )));
      if (workspaceId !== '_orphan') {
        setProjects((prev) => prev.filter((p) => p.id !== workspaceId));
      }

      setDeleteConfirmWorkspace(null);
      fetchWorkspaces();
      showToast('success', workspaceId === '_orphan' ? 'Unassigned sessions cleared.' : 'Workspace deleted.');
    } catch (err) {
      setError(err.message);
      setShowErrorModal(true);
      showToast('error', err.message);
    } finally {
      setDeletingWorkspaceId(null);
    }
  };

  const requestDeleteWorkspace = (ws, anchorRect) => {
    const liveCount = ws.sessions.filter((s) => s.alive === true).length;
    setDeleteConfirmWorkspace({
      workspaceId: ws.id,
      workspaceName: ws.name,
      sessionCount: ws.sessions.length,
      liveCount,
      isOrphan: ws.id === '_orphan',
      anchorRect,
    });
  };

  const agentSelectOptions = useMemo(
    () => sortAgentsByRecentUsage(agents, loadSidebarPrefs()).map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );
  const recentAgentIds = useMemo(
    () => getRecentAgentIds(agents, loadSidebarPrefs()),
    [agents],
  );

  return (
    <div className={className || 'h-full w-full'}>
      {/* Dialog Modals */}
      {viewingFile && (
        <ConsoleDialogShell
          onClose={() => setViewingFile(null)}
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
              onClick={() => setViewingFile(null)}
              className={`shrink-0 rounded-md p-1.5 ${textPlaceholder} ${hoverBgTertiary} ${hoverTextPrimary} ${transitionBase}`}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className={`min-h-0 flex-1 overflow-auto p-4 bg-[#FAFBFC] text-sm font-mono ${textTertiary} whitespace-pre`}>
            {fileContent}
          </div>
        </ConsoleDialogShell>
      )}

      {deleteConfirmWorkspace && (
        <ConsoleInlineDialog
          onClose={() => setDeleteConfirmWorkspace(null)}
          panelClassName={`${consoleDialogPanelClass} w-72 max-w-[calc(100vw-1.5rem)] shadow-lg`}
        >
            <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-3`}>
              <Trash2 className={`w-5 h-5 shrink-0 ${textPlaceholder}`} />
              <h3 className={`font-semibold text-sm ${textPrimary}`}>
                {deleteConfirmWorkspace.isOrphan ? 'Clear unassigned sessions' : 'Delete workspace'}
              </h3>
            </div>
            <div className={`p-5 text-sm ${textSecondary}`}>
              {deleteConfirmWorkspace.isOrphan ? (
                <>
                  Remove all sessions in <span className={`font-medium ${textPrimary}`}>Unassigned</span>?
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
                  <p className={`mt-2 text-xs ${textPlaceholder}`}>Unassigned is not a workspace — it groups sessions without a project. Clearing it removes those sessions from history.</p>
                </>
              ) : (
                <>
                  Permanently delete <span className={`font-medium ${textPrimary}`}>{deleteConfirmWorkspace.workspaceName}</span>?
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
                  <p className={`mt-2 text-xs ${textPlaceholder}`}>All workspace files on the server will be deleted. This frees your workspace quota.</p>
                </>
              )}
            </div>
            <div className={consoleStructuredDialogFooterClass}>
              <button
                type="button"
                onClick={() => setDeleteConfirmWorkspace(null)}
                className={`h-9 px-4 ${bgCanvas} border ${borderHairline} ${textPrimary} rounded-md text-sm font-medium ${hoverBgSecondary} ${transitionBase}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingWorkspaceId === deleteConfirmWorkspace.workspaceId}
                onClick={() => handleDeleteWorkspace(deleteConfirmWorkspace.workspaceId)}
                className={`h-9 px-4 bg-[#C06C5D] text-white rounded-md text-sm font-medium hover:bg-[#A35A4D] disabled:opacity-50 ${transitionBase}`}
              >
                {deletingWorkspaceId === deleteConfirmWorkspace.workspaceId
                  ? 'Removing…'
                  : deleteConfirmWorkspace.isOrphan
                    ? 'Clear all'
                    : 'Delete workspace'}
              </button>
            </div>
        </ConsoleInlineDialog>
      )}

      {deleteConfirmSession && (
        <ConsoleInlineDialog
          onClose={() => setDeleteConfirmSession(null)}
          panelClassName={`${consoleDialogPanelClass} w-full max-w-md shadow-sm`}
        >
            <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-3`}>
              <Trash2 className={`w-5 h-5 shrink-0 ${textPlaceholder}`} />
              <h3 className={`font-semibold text-sm ${textPrimary}`}>
                {deleteConfirmSession.isLive ? 'Stop session' : 'Remove from history'}
              </h3>
            </div>
            <div className={`p-5 text-sm ${textSecondary}`}>
              {deleteConfirmSession.isLive ? (
                <>
                  Stop <span className={`font-medium ${textPrimary}`}>{deleteConfirmSession.agentLabel}</span> in{' '}
                  <span className={`font-medium ${textPrimary}`}>{deleteConfirmSession.workspaceName}</span> and remove this session?
                </>
              ) : (
                <>
                  Remove <span className={`font-medium ${textPrimary}`}>{deleteConfirmSession.agentLabel}</span> from history in{' '}
                  <span className={`font-medium ${textPrimary}`}>{deleteConfirmSession.workspaceName}</span>?
                </>
              )}
              <p className={`mt-2 text-xs ${textPlaceholder}`}>Workspace files on the server will be kept.</p>
            </div>
            <div className={consoleStructuredDialogFooterClass}>
              <button
                type="button"
                onClick={() => setDeleteConfirmSession(null)}
                className={`h-9 px-4 ${bgCanvas} border ${borderHairline} ${textPrimary} rounded-md text-sm font-medium ${hoverBgSecondary} ${transitionBase}`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingSessionId === deleteConfirmSession.sessionId}
                onClick={() => handleDeleteSession(deleteConfirmSession.sessionId)}
                className={`h-9 px-4 bg-[#C06C5D] text-white rounded-md text-sm font-medium hover:bg-[#A35A4D] disabled:opacity-50 ${transitionBase}`}
              >
                {deletingSessionId === deleteConfirmSession.sessionId ? 'Removing…' : deleteConfirmSession.isLive ? 'Stop & remove' : 'Remove'}
              </button>
            </div>
        </ConsoleInlineDialog>
      )}

      {showErrorModal && (
        <ConsoleInlineDialog
          onClose={() => setShowErrorModal(false)}
          panelClassName={`${consoleDialogPanelClass} w-full max-w-md shadow-sm`}
        >
            <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-3 bg-[#FDECEA] ${accentRed}`}>
              <X className="w-5 h-5 shrink-0" />
              <h3 className="font-semibold text-sm">Action Failed</h3>
            </div>
            <div className={`p-5 text-sm ${textSecondary} break-words`}>
              {error}
            </div>
            <div className={consoleStructuredDialogFooterClass}>
              {selectedAgent?.llm_auth_mode === 'byok' && /Missing required|Secrets Vault/i.test(error || '') && selectedAgent?.env_required?.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowErrorModal(false);
                    openConfigModal();
                  }}
                  className={`h-9 px-4 flex items-center gap-2 border ${borderHairline} rounded-md text-sm font-medium ${textPrimary} ${bgCanvas} ${hoverBgSecondary} ${transitionBase} mr-auto`}
                >
                  <Settings2 className="w-4 h-4" /> Configure Keys
                </button>
              )}
              <button 
                type="button"
                onClick={() => setShowErrorModal(false)}
                className={`h-9 px-4 bg-[#202124] text-white rounded-md text-sm font-medium hover:bg-[#3C4043] ${transitionBase}`}
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
          panelClassName={`${consoleDialogPanelClass} w-full max-w-sm shadow-sm`}
        >
            <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-2.5`}>
              <Plus className={`w-4 h-4 shrink-0 ${textPlaceholder}`} />
              <h3 className={`font-semibold text-sm ${textPrimary}`}>
                {launchModalMode === 'session' ? 'New Session' : 'New Workspace'}
              </h3>
            </div>
            <div className={`p-4 space-y-3`}>
              {launchModalError && (
                <p className="text-sm text-[#C06C5D] bg-[#FDECEA] border border-[#FADBD8] rounded-md px-3 py-2">{launchModalError}</p>
              )}
              {launchModalMode === 'workspace' ? (
                <div>
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${textPlaceholder} mb-1`}>Workspace name</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder="quiet-forest-door"
                    className={consoleInputClass}
                  />
                  <p className={`text-xs ${textPlaceholder} mt-2`}>Isolated directory for agent sessions.</p>
                </div>
              ) : (
                <div>
                  <label className={`block text-xs font-semibold uppercase tracking-wider ${textPlaceholder} mb-1`}>Workspace</label>
                  <SelectMenu
                    value={launchWorkspaceId}
                    onChange={setLaunchWorkspaceId}
                    placeholder="Select workspace"
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <p className={`text-xs ${textPlaceholder} mt-2`}>Runs another agent in the same workspace for parallel development.</p>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className={`text-xs font-semibold uppercase tracking-wider ${textPlaceholder}`}>Agent</label>
                  {selectedAgent?.llm_auth_mode === 'byok' && selectedAgent?.env_required?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openConfigModal()}
                      className={`text-xs font-medium ${textPlaceholder} ${hoverTextPrimary} flex items-center gap-1 shrink-0 ${transitionBase}`}
                    >
                      <Settings2 className="w-3.5 h-3.5" /> Configure Keys
                    </button>
                  )}
                </div>
                {agents.length === 0 ? (
                  <div className={`flex items-center justify-between gap-2 text-sm ${textPlaceholder}`}>
                    <span>No agents available.</span>
                    <button
                      type="button"
                      onClick={fetchWorkspaces}
                      title="Refresh agents"
                      className={`p-1 rounded-md ${hoverBgCanvas} ${hoverTextPrimary} ${transitionBase}`}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
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
                {launchModalMode === 'workspace' && agents.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-[#5F6368] pt-1">
                    <input
                      type="checkbox"
                      checked={startSessionAfterCreate}
                      onChange={(e) => setStartSessionAfterCreate(e.target.checked)}
                      className="rounded border-[#DADCE0] text-[#202124] focus:ring-[#5B8DB8]"
                    />
                    Start a terminal session in this workspace
                  </label>
                )}
              </div>
            </div>
            <div className={consoleStructuredDialogFooterClass}>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewInstanceModal(false);
                    setLaunchModalError(null);
                  }}
                  className={`h-9 px-3 ${bgCanvas} border ${borderHairline} ${textPrimary} rounded-md text-sm font-medium ${hoverBgSecondary} ${transitionBase}`}
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
                className={`h-9 px-3 flex items-center justify-center gap-2 bg-[#202124] text-white rounded-md text-sm font-medium hover:bg-[#3C4043] disabled:opacity-50 ${transitionBase}`}
              >
                {launchModalMode === 'session' || (launchModalMode === 'workspace' && startSessionAfterCreate) ? (
                  <Play className="w-4 h-4" />
                ) : null}
                {isLoading || projectCreating ? 'Starting...' : launchModalMode === 'session' ? 'Start session' : 'Create'}
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
          panelClassName={`${consoleDialogPanelClass} w-full max-w-md shadow-sm`}
        >
            <form onSubmit={handleSaveConfig}>
              <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-3`}>
                <Settings2 className={`w-5 h-5 shrink-0 ${textPlaceholder}`} />
                <h3 className={`font-semibold text-sm ${textPrimary}`}>Configure {selectedAgent?.name}</h3>
              </div>
              <div className="p-5 space-y-4">
                {configLoading ? (
                  <p className={`text-sm ${textPlaceholder}`}>Loading...</p>
                ) : configRequiredKeys.length === 0 ? (
                  <p className={`text-sm ${textPlaceholder}`}>No API keys required.</p>
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
                  <p className="text-sm text-[#C06C5D] bg-[#FDECEA] border border-[#FADBD8] rounded-md px-3 py-2">{configError}</p>
                )}
              </div>
              <div className={consoleStructuredDialogFooterClass}>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfigModal(false);
                    setConfigError(null);
                    setLaunchModalError(null);
                  }}
                  className={`h-9 px-4 ${bgCanvas} border ${borderHairline} ${textPrimary} rounded-md text-sm font-medium ${hoverBgSecondary} ${transitionBase}`}
                >
                  {showNewInstanceModal ? 'Back' : 'Cancel'}
                </button>
                {configRequiredKeys.length > 0 && (
                  <button
                    type="submit"
                    disabled={configSaving || configMissingKeys.length > 0}
                    className={`h-9 px-4 bg-[#202124] text-white rounded-md text-sm font-medium hover:bg-[#3C4043] disabled:opacity-50 ${transitionBase}`}
                  >
                    {configSaving ? 'Saving...' : 'Save Keys'}
                  </button>
                )}
              </div>
            </form>
        </ConsoleInlineDialog>
      )}

      {/* Main area: terminal or empty state */}
      <div className="flex min-h-0 flex-1 w-full flex-row items-stretch">
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${activeSession || launchingSession ? '' : 'bg-white'}`}
          style={(activeSession || launchingSession) ? { backgroundColor: preset.xterm.background } : undefined}
        >
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
          ) : launchingSession ? (
            <div className="flex-1" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-[#5F6368]">
              <TerminalSquare className="w-12 h-12 mb-4 text-[#9AA0A6]" strokeWidth={1} />
              <h3 className="text-base font-medium text-[#202124] mb-1">No Active Session</h3>
              <p className="text-sm">Select a session from the sidebar, or create a new workspace.</p>
            </div>
          )}
        </div>

        {/* Right Panel: Files */}
        {activeSession && workspaceOpen && (
          <div className={`flex w-72 shrink-0 flex-col min-h-0 overflow-hidden bg-[#F4F5F6] border-l border-[#E8EAED]`}>
            <div className={`flex items-center justify-between border-b border-[#E8EAED] px-3 py-2 shrink-0`}>
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className={`w-4 h-4 ${textPlaceholder} shrink-0`} />
                <h2 className={`text-sm font-semibold ${textPrimary} uppercase tracking-wider truncate`} title={activeSession.projectName}>
                  Files
                </h2>
              </div>
              <button
                type="button"
                onClick={fetchWorkspaceFiles}
                title="Refresh files"
                className={`p-1.5 ${accentBlue} rounded-md ${hoverBgCanvas} ${transitionBase}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className={`flex-1 overflow-auto ${panelPadding} min-h-0`}>
              {workspaceFiles.filter((f) => f.type === 'file').length === 0 ? (
                <div className={`p-4 text-center text-xs ${textPlaceholder}`}>No files generated yet.</div>
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
});
