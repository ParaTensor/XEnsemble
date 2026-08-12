import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AgentConsole from '../components/AgentConsole';
import WorkspaceFileTree from '../components/WorkspaceFileTree';
import WorkspaceShell from '../components/WorkspaceShell';
import WorkspacePanel from '../components/WorkspacePanel';
import RepoImportDialog from '../components/git/RepoImportDialog';
import GitStatusBar from '../components/git/GitStatusBar';
import { apiFetch } from '../lib/api';
import * as githubApi from '../lib/githubApi';
import {
  ConsoleDialogShell,
  ConsoleInlineDialog,
} from '../components/ConsoleDialog';
import SelectMenu from '../components/SelectMenu';
import { useToast } from '../components/Toast';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
import { useEditorTabs } from '../hooks/useEditorTabs';
import { useGitChanges } from '../hooks/useGitChanges';
import { usePreview, PreviewControlGroup } from '../components/PreviewPanel';
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
  Square,
  Unplug,
  Loader2,
  Trash2,
} from 'lucide-react';
import { getSecretLabel, getSecretPlaceholder, isSecretPasswordField } from '../lib/secretLabels';
import ByokConfigForm from '../components/ByokConfigForm';
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
  consoleButtonFocusClass,
  bgCanvas,
  textPrimary,
  textSecondary,
  textTertiary,
  textPlaceholder,
  borderHairline,
  transitionBase,
  hoverBgSecondary,
  hoverBgTertiary,
  hoverTextPrimary,
} from '../lib/consoleTheme.js';
import { buttonClass } from '../lib/buttonStyles';

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
  const [panelOpen, setPanelOpen] = useState(true);
  const [shellMounted, setShellMounted] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => {
    const maxW = typeof window !== 'undefined' ? Math.max(720, window.innerWidth - 240) : 800;
    return Math.min(Math.floor(maxW / 2), maxW);
  });
  const panelRowRef = useRef(null);

  // Measure actual container width for true 1:1 ratio (sidebar width varies)
  useLayoutEffect(() => {
    const measure = () => {
      if (panelRowRef.current) {
        const w = panelRowRef.current.offsetWidth;
        if (w > 0) setPanelWidth(Math.floor(w / 2));
      }
    };
    measure();
    const timer = setTimeout(measure, 100);
    return () => clearTimeout(timer);
  }, []);
  const resizingRef = useRef(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [viewingFile, setViewingFile] = useState(null);
  const [fileContent, setFileContent] = useState('');

  // Compute session liveness early so we can gate VM-triggering API calls
  // (git status polling, file tree listing) on the session being actually
  // running.  When the session is idle/pending, starting these polls would
  // trigger ensureProjectRuntime on the server, which creates a box-base VM
  // that is then torn down and recreated with an agent image when the
  // session resumes — causing 30-60s of unnecessary double VM provisioning.
  const activeSessionMeta = useMemo(
    () => sessions.find((s) => s.id === activeSession?.sessionId) || null,
    [sessions, activeSession?.sessionId],
  );
  const sessionAlive = activeSessionMeta?.alive === true;

  const editorTabs = useEditorTabs(activeSession?.projectId);
  // Changes 与 Files 共用同一 workspace attach 路径；不能再按 sessionAlive 关掉，
  // 否则编辑器已能保存、Changes 却一直空白（分支显示 —）。
  const changesTabActiveRef = useRef(false);
  const gitChanges = useGitChanges(activeSession?.projectId || null, changesTabActiveRef);
  const preview = usePreview(activeSession?.projectId, Boolean(activeSession?.projectId));
  const [gitDiffView, setGitDiffView] = useState(null);

  const [configEnvVars, setConfigEnvVars] = useState([{ key: '', value: '' }]);
  const [savedConfigKeys, setSavedConfigKeys] = useState({});
  const configModalInitialKeysRef = useRef(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState(null);
  const { showToast } = useToast();
  const { themeId, preset } = useTerminalTheme();
  // eslint-disable-next-line no-unused-vars
  const [_deletingSessionId, setDeletingSessionId] = useState(null);
  const [restartingSession, setRestartingSession] = useState(false);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const [stoppingSession, setStoppingSession] = useState(false);
  const [deleteConfirmSession, setDeleteConfirmSession] = useState(null);
  const [deleteConfirmWorkspace, setDeleteConfirmWorkspace] = useState(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState(null);

  const [showNewInstanceModal, setShowNewInstanceModal] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [createNewWorkspaceInline, setCreateNewWorkspaceInline] = useState(false);
  const [customImageId, setCustomImageId] = useState('');
  const [customImages, setCustomImages] = useState([]);

  // Launch modal: agent config files
  const [launchConfigFiles, setLaunchConfigFiles] = useState([]);
  const [showLaunchConfigModal, setShowLaunchConfigModal] = useState(false);

  // Session config dialog (running session)
  const [showSessionConfigModal, setShowSessionConfigModal] = useState(false);
  const [sessionConfigFiles, setSessionConfigFiles] = useState([]);
  const [sessionEnvVars, setSessionEnvVars] = useState([{ key: '', value: '' }]);
  const [sessionConfigLoading, setSessionConfigLoading] = useState(false);
  const [sessionConfigSaving, setSessionConfigSaving] = useState(false);
  const [sessionConfigError, setSessionConfigError] = useState(null);
  const [showRestartPrompt, setShowRestartPrompt] = useState(false);

  // Reset launch config when agent changes
  useEffect(() => {
    setLaunchConfigFiles([]);
  }, [selectedAgentId]);

  const startPanelResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const maxW = Math.max(720, window.innerWidth - 240);
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      const next = Math.min(maxW, Math.max(420, startW + delta));
      setPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

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
      setShellMounted(false);
    } else {
      setPanelOpen(true);
    }
    setViewingFile(null);
    setFileContent('');
  }, [activeSession?.projectId]);

  useEffect(() => {
    if (agents.length === 0) return;
    setSelectedAgentId((prev) => pickDefaultAgentId(agents, prev));
  }, [agents]);

  const fetchCustomImages = useCallback(() => {
    return apiFetch('/api/v1/custom-images').then((res) => res.json()).then((data) => {
      const list = data.images || (Array.isArray(data) ? data : []);
      setCustomImages(list.filter((img) => img.status === 'ready'));
    }).catch(() => {
      setCustomImages([]);
    });
  }, []);

  useEffect(() => {
    fetchCustomImages();
  }, [fetchCustomImages]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const openLaunchConfigModal = async () => {
    setConfigError(null);
    setError(null);
    setShowLaunchConfigModal(true);
  };

  const configRequiredKeys = selectedAgent?.env_required || [];
  // eslint-disable-next-line no-unused-vars
  const configMissingKeys = useMemo(
    () => configRequiredKeys.filter((k) => !savedConfigKeys[k]),
    [configRequiredKeys, savedConfigKeys],
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
      openLaunchConfigModal();
      return false;
    } catch {
      openLaunchConfigModal();
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

      // Collect non-empty config files from launch modal
      const cleanConfigFiles = launchConfigFiles.filter((f) => f.path && f.content);

      // Collect non-required env vars as custom_env (required ones are injected via secrets)
      const requiredSet = new Set(selectedAgent?.env_required || []);
      const cleanCustomEnv = {};
      for (const { key, value } of configEnvVars) {
        const k = (key || '').trim();
        const v = (value || '').trim();
        if (k && v && !requiredSet.has(k)) cleanCustomEnv[k] = v;
      }

      const response = await apiFetch('/api/v1/session/start', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: selectedAgentId,
          project_id: projectId,
          terminal_theme_id: themeId,
          custom_image_id: customImageId || undefined,
          ...(cleanConfigFiles.length ? { config_files: cleanConfigFiles } : {}),
          ...(Object.keys(cleanCustomEnv).length ? { custom_env: cleanCustomEnv } : {}),
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

      const isPending = response.status === 202 || data.status === 'pending';

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
            alive: !isPending,
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
    goToSessions();
    setLaunchModalError(null);
    setCreateNewWorkspaceInline(false);
    setCustomImageId('');
    fetchCustomImages();
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

  const handleSaveLaunchConfig = async () => {
    setConfigError(null);
    const payload = {};
    for (const { key, value } of configEnvVars) {
      const k = (key || '').trim();
      if (!k) continue;
      const v = (value || '').trim();
      payload[k] = v;
    }
    // Include keys that were removed via X button (present at modal open, now gone)
    if (configModalInitialKeysRef.current) {
      for (const k of configModalInitialKeysRef.current) {
        if (!(k in payload)) payload[k] = '';
      }
    }
    configModalInitialKeysRef.current = null;
    if (Object.keys(payload).length === 0) {
      setShowLaunchConfigModal(false);
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
        Object.keys(payload).forEach((k) => { next[k] = true; });
        return next;
      });
      showToast('success', 'Configuration saved.');
      setShowLaunchConfigModal(false);
      setLaunchModalError(null);
    } catch (err) {
      setConfigError(err.message);
    } finally {
      setConfigSaving(false);
    }
  };

  // ── Session config (config files + custom env for running session) ──
  const openSessionConfigModal = async () => {
    if (!activeSession?.sessionId) return;
    setShowSessionConfigModal(true);
    setSessionConfigError(null);
    setSessionConfigLoading(true);
    try {
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(activeSession.sessionId)}/config`);
      const data = await res.json();
      if (res.ok) {
        const files = data.config_files || [];
        setSessionConfigFiles(files);
        const envObj = data.custom_env || {};
        const envRows = Object.keys(envObj).length
          ? Object.entries(envObj).map(([k, v]) => ({ key: k, value: v }))
          : [{ key: '', value: '' }];
        setSessionEnvVars(envRows);
      } else {
        setSessionConfigFiles([]);
        setSessionEnvVars([{ key: '', value: '' }]);
      }
    } catch {
      setSessionConfigFiles([]);
      setSessionEnvVars([{ key: '', value: '' }]);
      setSessionConfigError('Could not load configuration.');
    } finally {
      setSessionConfigLoading(false);
    }
  };

  const handleSaveSessionConfig = async () => {
    if (!activeSession?.sessionId) return;
    setSessionConfigError(null);
    setSessionConfigSaving(true);
    try {
      const cleanConfigFiles = sessionConfigFiles.filter((f) => f.path && f.content);
      const cleanCustomEnv = {};
      for (const { key, value } of sessionEnvVars) {
        const k = (key || '').trim();
        const v = (value || '').trim();
        if (k && v) cleanCustomEnv[k] = v;
      }
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(activeSession.sessionId)}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          config_files: cleanConfigFiles,
          custom_env: cleanCustomEnv,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save configuration');
      setShowSessionConfigModal(false);
      if (data.needs_restart) {
        setShowRestartPrompt(true);
      } else {
        showToast('success', 'Configuration saved.');
      }
    } catch (err) {
      setSessionConfigError(err.message);
    } finally {
      setSessionConfigSaving(false);
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
    } catch (err) {
      if (notifyError) showToast('error', err.message);
    } finally {
      setIsLoadingFiles(false);
    }
  }, [activeSession?.projectId, showHiddenFiles, showToast]);

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

  const handleGitFileClick = useCallback(async (filePath) => {
    if (!activeSession?.projectId) return;
    setGitDiffView({ path: filePath, original: null, modified: null, loading: true });
    try {
      const data = await githubApi.getGitFileDiffView(activeSession.projectId, filePath);
      setGitDiffView({
        path: filePath,
        original: data.original || '',
        modified: data.modified || '',
        loading: false,
        binary: Boolean(data.binary),
        truncated: Boolean(data.truncated),
      });
    } catch (err) {
      setGitDiffView(null);
      showToast('error', err.message);
    }
  }, [activeSession?.projectId, showToast]);

  const handleCloseGitDiff = useCallback(() => {
    setGitDiffView(null);
  }, []);

  // Stabilized callbacks for WorkspacePanel to prevent re-renders on every keystroke.
  const handleSaveTab = useCallback((path) => {
    if (!activeSession?.projectId) return;
    return editorTabs.saveTab(activeSession.projectId, path)
      .then((result) => {
        gitChanges?.fetchStatus?.({ silent: true });
        return result;
      });
  }, [activeSession?.projectId, editorTabs.saveTab, gitChanges]);

  const handleEditorOpenFile = useCallback((file) => {
    if (!activeSession?.projectId) return;
    return editorTabs.openFile(activeSession.projectId, file);
  }, [activeSession?.projectId, editorTabs.openFile]);

  const handleCreateFile = useCallback((projectId, name) => {
    return editorTabs.handleCreateFile(projectId, name)
      .then(() => editorTabs.openFile(projectId, { path: name, type: 'file' }))
      .then((result) => {
        gitChanges?.fetchStatus?.({ silent: true });
        return result;
      })
      .catch((e) => showToast('error', e.message));
  }, [editorTabs.handleCreateFile, editorTabs.openFile, showToast, gitChanges]);

  const handleCreateDir = useCallback((projectId, name) => {
    return editorTabs.handleCreateDir(projectId, name)
      .then((result) => {
        gitChanges?.fetchStatus?.({ silent: true });
        return result;
      })
      .catch((e) => showToast('error', e.message));
  }, [editorTabs.handleCreateDir, showToast, gitChanges]);

  const handleShowDiff = useCallback((path) => {
    if (!activeSession?.projectId) return;
    return editorTabs.showDiff(activeSession.projectId, path)
      .catch((e) => showToast('error', e.message));
  }, [activeSession?.projectId, editorTabs.showDiff, showToast]);

  const handleSessionEnd = useCallback((sessionId) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, alive: false, memoryStatus: 'exited', status: 'exited' } : s
      )
    );
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleSessionIdle = (sessionId) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, alive: false, memoryStatus: 'idle', status: 'idle' } : s
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
    const sessionMeta = sessions.find((s) => s.id === oldSessionId);

    setRestartingSession(true);
    try {
      const ready = await ensureAgentSecrets(agent);
      if (!ready) {
        showToast('error', 'Configure required API keys before starting.');
        return;
      }

      if (sessionMeta?.recoverable) {
        if (sessionAlive) {
          const stopRes = await apiFetch(`/api/v1/sessions/${encodeURIComponent(oldSessionId)}/stop`, { method: 'POST' });
          const stopData = await stopRes.json();
          if (!stopRes.ok) throw new Error(stopData.error || 'Failed to pause session');
          handleSessionIdle(oldSessionId);
        }
        const response = await apiFetch(`/api/v1/sessions/${encodeURIComponent(oldSessionId)}/resume`, {
          method: 'POST',
          body: JSON.stringify({ terminal_theme_id: themeId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.detail || 'Failed to resume session');
        setSessions((prev) => prev.map((s) => (
          s.id === oldSessionId ? { ...s, alive: true, status: 'running', memoryStatus: 'running' } : s
        )));
        setReconnectVersion((v) => v + 1);
        fetchWorkspaces();
        showToast('success', sessionAlive ? 'Session restarted.' : 'Session resumed.');
        return;
      }

      const deleteRes = await apiFetch(`/api/v1/sessions/${encodeURIComponent(oldSessionId)}`, { method: 'DELETE' });
      if (!deleteRes.ok) throw new Error('Failed to release previous session');
      archiveSession(oldSessionId);

      const response = await apiFetch('/api/v1/session/start', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId,
          project_id: activeSession.projectId,
          terminal_theme_id: themeId,
          custom_image_id: sessionMeta?.customImageId || undefined,
        }),
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
        const withoutOld = prev.filter((s) => s.id !== oldSessionId);
        if (withoutOld.some((s) => s.id === data.session_id)) return withoutOld;
        const now = Date.now();
        return [...withoutOld, { id: data.session_id, projectId: activeSession.projectId, agentId, status: 'running', alive: true, projectName: activeSession.projectName, createdAt: now }];
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
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(activeSession.sessionId)}/stop`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to pause session');
      rememberRecentSession({ id: activeSession.sessionId, agentId: activeSession.agentId, projectId: activeSession.projectId, projectName: activeSession.projectName, createdAt: Date.now() });
      handleSessionIdle(activeSession.sessionId);
      fetchWorkspaces();
      showToast('success', 'Session paused.');
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

  const handleDeleteWorkspace = async (workspaceId) => {
    setDeletingWorkspaceId(workspaceId);
    try {
      if (workspaceId === '_orphan') {
        const orphanSessions = sessions.filter((s) => !s.projectId);
        for (const s of orphanSessions) {
          await apiFetch(`/api/v1/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
        }
        if (activeSession && !activeSession.projectId) setActiveSession(null);
      } else {
        const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to delete workspace');
        }
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
      fetchWorkspaces();
    } finally {
      setDeletingWorkspaceId(null);
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

  // activeSessionMeta and sessionAlive are computed earlier (before useGitChanges)
  // so we can gate VM-triggering API calls on session liveness.
  const sessionPending = activeSessionMeta?.status === 'pending';
  const sessionFailed = activeSessionMeta?.status === 'failed';
  const sessionWakeable = !sessionAlive && !sessionPending && !sessionFailed
    && activeSessionMeta?.recoverable === true
    && activeSessionMeta?.status === 'idle';
  const sessionControlPending = restartingSession || stoppingSession;

  const handleSessionConnected = useCallback((sessionId) => {
    setSessions((prev) => prev.map((s) => (
      s.id === sessionId ? { ...s, alive: true, status: 'running', memoryStatus: 'running' } : s
    )));
    fetchWorkspaces();
  }, [fetchWorkspaces, setSessions]);

  return (
    <div className={className || 'h-full w-full'}>
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

      {deleteConfirmWorkspace && (
        <ConsoleInlineDialog
          onClose={() => setDeleteConfirmWorkspace(null)}
          panelClassName={`${consoleDialogPanelClass} w-full max-w-md shadow-sm`}
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
              className={`h-9 px-4 flex items-center justify-center gap-2 bg-[#C06C5D] text-white rounded-md text-sm font-medium hover:bg-[#A35A4D] disabled:opacity-50 ${transitionBase}`}
            >
              {deletingWorkspaceId === deleteConfirmWorkspace.workspaceId
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Removing…</>
                : deleteConfirmWorkspace.isOrphan
                  ? 'Clear all'
                  : 'Delete workspace'}
            </button>
          </div>
        </ConsoleInlineDialog>
      )}

      {/* Session config dialog (running session) */}
      {showSessionConfigModal && (
        <ConsoleInlineDialog
          onClose={() => { setShowSessionConfigModal(false); setSessionConfigError(null); }}
          panelClassName={`${consoleDialogPanelClass} w-full max-w-lg shadow-sm`}
        >
          <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-2.5`}>
            <Settings2 className={`w-4 h-4 shrink-0 ${textPlaceholder}`} />
            <h3 className={`font-semibold text-sm ${textPrimary}`}>
              Agent Configuration{activeSession?.agentName ? ` - ${activeSession.agentName}` : ''}
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {sessionConfigError && (
              <p className="text-sm text-[#C06C5D] bg-[#FDECEA] border border-[#FADBD8] rounded-md px-3 py-2">{sessionConfigError}</p>
            )}
            <AgentConfigEditor
              configSchema={agents.find((a) => a.id === activeSession?.agentId)?.config_schema || null}
              configFiles={sessionConfigFiles}
              envVars={sessionEnvVars}
              onConfigFilesChange={setSessionConfigFiles}
              onEnvVarsChange={setSessionEnvVars}
              loading={sessionConfigLoading}
            />
          </div>
          <div className={consoleStructuredDialogFooterClass}>
            <button
              type="button"
              onClick={() => { setShowSessionConfigModal(false); setSessionConfigError(null); }}
              className={`h-9 px-3 ${bgCanvas} border ${borderHairline} ${textPrimary} rounded-md text-sm font-medium ${hoverBgSecondary} ${transitionBase}`}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={sessionConfigSaving || sessionConfigLoading}
              onClick={handleSaveSessionConfig}
              className={`h-9 px-3 flex items-center justify-center gap-2 bg-[#202124] text-white rounded-md text-sm font-medium hover:bg-[#3C4043] disabled:opacity-50 ${transitionBase}`}
            >
              {sessionConfigSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save'}
            </button>
          </div>
        </ConsoleInlineDialog>
      )}

      {/* Restart prompt after config update */}
      {showRestartPrompt && (
        <ConsoleInlineDialog
          onClose={() => setShowRestartPrompt(false)}
          panelClassName={`${consoleDialogPanelClass} w-full max-w-sm shadow-sm`}
        >
          <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-2.5`}>
            <RefreshCw className={`w-4 h-4 shrink-0 ${textPlaceholder}`} />
            <h3 className={`font-semibold text-sm ${textPrimary}`}>Configuration Updated</h3>
          </div>
          <div className="p-4 space-y-2">
            <p className={`text-sm ${textSecondary}`}>
              Configuration has been updated. Restart this session for the changes to take effect.
            </p>
          </div>
          <div className={consoleStructuredDialogFooterClass}>
            <button
              type="button"
              onClick={() => setShowRestartPrompt(false)}
              className={`h-9 px-3 ${bgCanvas} border ${borderHairline} ${textPrimary} rounded-md text-sm font-medium ${hoverBgSecondary} ${transitionBase}`}
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => { setShowRestartPrompt(false); handleRestartSession(); }}
              className={`h-9 px-3 flex items-center justify-center gap-2 bg-[#202124] text-white rounded-md text-sm font-medium hover:bg-[#3C4043] ${transitionBase}`}
            >
              <RefreshCw className="w-4 h-4" /> Restart Now
            </button>
          </div>
        </ConsoleInlineDialog>
      )}

      {/* Main area */}
      <div className="flex min-h-0 flex-1 w-full flex-row items-stretch bg-white">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          {showNewInstanceModal ? (
            <div className="flex min-h-0 flex-1 flex-col bg-[#F0F1F3]">
              <div className="flex items-center justify-between border-b border-[#DADCE0] bg-white px-4 py-2.5 shrink-0 shadow-sm">
                <div className="flex items-center gap-2.5">
                  {launchModalMode === 'workspace' ? (
                    <Plus className="w-4 h-4 shrink-0 text-[#9AA0A6]" />
                  ) : (
                    <Bot className="w-4 h-4 shrink-0 text-[#9AA0A6]" />
                  )}
                  <h3 className="text-sm font-bold text-[#202124]">
                    {launchModalMode === 'workspace' ? 'New Workspace' : 'New Agent'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => { setShowNewInstanceModal(false); setLaunchModalError(null); setCreateNewWorkspaceInline(false); setShowLaunchConfigModal(false); }}
                  className={`p-1.5 rounded text-[#5F6368] hover:bg-[#E8EAED] ${consoleButtonFocusClass}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto flex items-start justify-center p-6">
                <div className="w-full max-w-md">
                  <div className="rounded-xl bg-white shadow-sm border border-[#E8EAED] divide-y divide-[#E8EAED]">
                    {launchModalError && (
                      <div className="px-5 py-3">
                        <p className="text-sm text-[#C06C5D] bg-[#FDECEA] border border-[#FADBD8] rounded-md px-3 py-2">{launchModalError}</p>
                      </div>
                    )}
                    {launchModalMode === 'workspace' && (
                      <div className="px-5 py-4">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-[#9AA0A6] mb-2">Workspace name</label>
                        <input type="text" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="my-workspace" className={consoleInputClass} autoFocus />
                      </div>
                    )}
                    {(launchModalMode === 'quickstart' || launchModalMode === 'session') && (
                      <div className="px-5 py-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <label className="text-xs font-semibold uppercase tracking-wider text-[#9AA0A6]">Workspace</label>
                          {launchModalMode === 'session' && !createNewWorkspaceInline && projects.length > 0 && (
                            <button
                              type="button"
                              onClick={() => { setCreateNewWorkspaceInline(true); setNewProjectName(''); setLaunchWorkspaceId(''); }}
                              className={`text-xs font-medium text-[#5B8DB8] hover:text-[#4A7298] ${consoleButtonFocusClass}`}
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
                            placeholder={launchModalMode === 'quickstart' ? 'Optional - auto-generated if empty' : 'my-workspace'}
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
                    {launchModalMode !== 'workspace' && customImages.length > 0 && (
                      <div className="px-5 py-4">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-[#9AA0A6] mb-2">Image type</label>
                        <SelectMenu
                          value={customImageId ? 'custom' : ''}
                          onChange={(v) => {
                            if (v === 'custom') {
                              setCustomImageId(customImages[0]?.id || '');
                              const img = customImages[0];
                              if (img) {
                                const agentComp = (img.components || []).find((c) => (c.component_id || '').startsWith('agent:'));
                                const agentId = agentComp ? agentComp.component_id.replace('agent:', '') : '';
                                if (agentId && agents.find((a) => a.id === agentId)) setSelectedAgentId(agentId);
                              }
                            } else {
                              setCustomImageId('');
                              setSelectedAgentId('');
                            }
                          }}
                          options={[{ value: '', label: 'Built-in' }, { value: 'custom', label: 'Custom (your images)' }]}
                          placeholder="Built-in"
                        />
                      </div>
                    )}
                    {launchModalMode !== 'workspace' && customImageId && (
                      <div className="px-5 py-4">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-[#9AA0A6] mb-2">Custom image</label>
                        <SelectMenu
                          value={customImageId}
                          onChange={(v) => {
                            setCustomImageId(v);
                            const img = customImages.find((c) => c.id === v);
                            if (img) {
                              const agentComp = (img.components || []).find((c) => (c.component_id || '').startsWith('agent:'));
                              const agentId = agentComp ? agentComp.component_id.replace('agent:', '') : '';
                              if (agentId && agents.find((a) => a.id === agentId)) setSelectedAgentId(agentId);
                            }
                          }}
                          options={customImages.map((img) => ({ value: img.id, label: img.name }))}
                          placeholder="Select image"
                        />
                      </div>
                    )}
                    {launchModalMode !== 'workspace' && (
                      <div className="px-5 py-4">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <label className="text-xs font-semibold uppercase tracking-wider text-[#9AA0A6]">Agent</label>
                          {selectedAgent && selectedAgent.llm_auth_mode === 'byok' && (
                            <button type="button" onClick={() => setShowLaunchConfigModal(v => !v)} className={`text-xs font-medium text-[#5B8DB8] hover:text-[#4A7298] ${consoleButtonFocusClass}`}>
                              <Settings2 className="w-3.5 h-3.5 inline" /> {showLaunchConfigModal ? 'Hide config' : 'Configure'}
                            </button>
                          )}
                        </div>
                        <SelectMenu
                          value={selectedAgentId}
                          onChange={setSelectedAgentId}
                          options={
                            customImageId
                              ? agentSelectOptions.filter((opt) => {
                                  const img = customImages.find((c) => c.id === customImageId);
                                  if (!img) return true;
                                  const agentComp = (img.components || []).find((c) => (c.component_id || '').startsWith('agent:'));
                                  return !agentComp || opt.value === agentComp.component_id.replace('agent:', '');
                                })
                              : agentSelectOptions
                          }
                          placeholder="Select agent"
                        />
                      </div>
                    )}
                    {showLaunchConfigModal && selectedAgent && (
                      <div className="px-5 py-4 bg-[#FAFBFC]">
                        <div className="flex items-center gap-2 mb-3">
                          <Settings2 className="w-4 h-4 text-[#9AA0A6]" />
                          <h4 className="text-sm font-semibold text-[#202124]">Configure {selectedAgent.name}</h4>
                        </div>
                        <ByokConfigForm
                          agentId={selectedAgentId}
                          loading={false}
                          onSave={() => { setShowLaunchConfigModal(false); showToast('success', 'Configuration saved.'); }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-[#DADCE0] bg-white px-4 py-3 shrink-0">
                <button
                  type="button"
                  onClick={() => { setShowNewInstanceModal(false); setCreateNewWorkspaceInline(false); }}
                  className={`${buttonClass('secondary', 'sm')} ${consoleButtonFocusClass}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isLoading || projectCreating || (launchModalMode !== 'workspace' && !selectedAgentId) || (launchModalMode === 'session' && !createNewWorkspaceInline && !launchWorkspaceId)}
                  onClick={handleLaunchFromModal}
                  className={`${buttonClass('primary', 'sm')} ${consoleButtonFocusClass}`}
                >
                  {isLoading || projectCreating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Starting...</> : launchModalMode === 'workspace' ? 'Create workspace' : 'Start agent'}
                </button>
              </div>
            </div>
          ) : (
            <>
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
                      className={`w-1.5 h-1.5 rounded-full ${sessionAlive ? 'bg-[#4A7C59]' : sessionPending ? 'bg-[#E8B339]' : sessionFailed ? 'bg-[#C06C5D]' : 'bg-[#9AA0A6]'}`}
                    />
                    <span className="text-[11px] text-[#9AA0A6]">
                      {sessionAlive ? 'Running' : sessionPending ? 'Preparing…' : sessionFailed ? 'Failed' : sessionWakeable ? 'Idle' : 'Stopped'}
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
                  {!sessionPending && !sessionFailed && (
                    <>
                      {sessionAlive ? (
                        <button
                          type="button"
                          onClick={handleStopSession}
                          disabled={sessionControlPending}
                          className={`${consoleIconButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={stoppingSession ? 'Pausing…' : 'Pause session (keep history)'}
                          aria-label={stoppingSession ? 'Pausing session' : 'Pause session'}
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
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => openSessionConfigModal()}
                    className={consoleIconButtonClass}
                    title="Agent configuration"
                    aria-label="Agent configuration"
                  >
                    <Settings2 className="w-4 h-4" strokeWidth={1.75} />
                  </button>
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
                  {activeSession.projectId ? (
                    <>
                      <div className="mx-0.5 h-5 w-px bg-[#E8EAED]" />
                      <PreviewControlGroup {...preview} />
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {activeSession ? (
            sessionPending ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white p-8 text-center">
                <Loader2 className="w-8 h-8 text-[#9AA0A6] animate-spin mb-4" strokeWidth={1.5} />
                <h3 className="text-lg font-semibold text-[#202124] mb-1.5">Preparing your environment…</h3>
                <p className="text-sm text-[#9AA0A6] max-w-sm">
                  Pulling image and starting virtual machine. This usually takes less than a minute.
                </p>
              </div>
            ) : sessionFailed ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-white p-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FDECEA] mb-5">
                  <X className="w-7 h-7 text-[#C06C5D]" strokeWidth={1.5} />
                </div>
                <h3 className="text-lg font-semibold text-[#202124] mb-1.5">Session failed to start</h3>
                <p className="text-sm text-[#9AA0A6] max-w-md mb-5">
                  {activeSessionMeta?.provisioningError || 'An unexpected error occurred during provisioning.'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDeleteSession(activeSession.sessionId)}
                    className="h-9 px-4 flex items-center gap-2 bg-[#C06C5D] text-white rounded-md text-sm font-medium hover:bg-[#A85544] disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                    Delete session
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSession(null)}
                    className="h-9 px-4 flex items-center gap-2 bg-white border border-[#E8EAED] text-[#202124] rounded-md text-sm font-medium hover:bg-[#F4F5F6] transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : (
<div ref={panelRowRef} className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  style={{ backgroundColor: preset.xterm.background }}
                >
                  <AgentConsole
                    key={activeSession.sessionId}
                    sessionId={activeSession.sessionId}
                    reconnectVersion={reconnectVersion}
                    onSessionEnd={handleSessionEnd}
                    onSessionConnected={handleSessionConnected}
                    sessionLive={sessionAlive}
                    sessionWakeable={sessionWakeable}
                  />
                </div>
                <GitStatusBar projectId={activeSession.projectId} project={activeProject} git={gitChanges} />
              </div>
              {panelOpen && (
                <>
                <div
                  onMouseDown={startPanelResize}
                  className="w-1 shrink-0 cursor-col-resize bg-[#E8EAED] hover:bg-[#202124] transition-colors"
                  title="Drag to resize"
                />
                <div className="flex min-h-0 shrink-0 flex-col border-l border-[#E8EAED] bg-white" style={{ width: panelWidth }}>
                  <WorkspacePanel
                    projectId={activeSession.projectId}
                    tabs={editorTabs.tabs}
                    activePath={editorTabs.activePath}
                    onSelectTab={editorTabs.selectTab}
                    onSaveTab={handleSaveTab}
                    onOpenFile={handleEditorOpenFile}
                    onFetchDir={editorTabs.fetchDir}
                    onCreateFile={handleCreateFile}
                    onCreateDir={handleCreateDir}
                    onShowDiff={handleShowDiff}
                    diffView={editorTabs.diffView}
                    onCloseDiff={editorTabs.closeDiff}
                    gitChanges={gitChanges}
                    changesTabActiveRef={changesTabActiveRef}
                    onGitFileClick={handleGitFileClick}
                    gitDiffView={gitDiffView}
                    onCloseGitDiff={handleCloseGitDiff}
                    provider={activeProject?.repoProvider}
                    sessionLive={sessionAlive}
                    shellContent={shellMounted && <WorkspaceShell projectId={activeSession.projectId} />}
                    onShellMount={() => setShellMounted(true)}
                  />
                </div>
                </>
              )}
            </div>
            )
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
            </>
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
