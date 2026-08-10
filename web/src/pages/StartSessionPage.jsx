import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import StartSessionForm from '../components/StartSessionForm';
import RepoImportDialog from '../components/git/RepoImportDialog';
import { useToast } from '../components/Toast';
import { useTerminalTheme } from '../hooks/useTerminalTheme.jsx';
import { apiFetch } from '../lib/api';
import { formatQuotaExceeded } from '../lib/quotaLabels';
import {
  rememberRecentAgent,
  rememberRecentSession,
  sortAgentsByRecentUsage,
  loadSidebarPrefs,
} from '../lib/sidebarPrefs';
import {
  bgCanvas,
  textPrimary,
  textSecondary,
  textPlaceholder,
  hoverBgSecondary,
  transitionBase,
  consoleButtonFocusClass,
} from '../lib/consoleTheme.js';

const SLUG_WORDS = [
  'small', 'heavy', 'many', 'quiet', 'swift', 'bright', 'calm', 'bold', 'brave', 'clear',
  'dark', 'fast', 'fresh', 'grand', 'keen', 'light', 'neat', 'proud', 'sharp', 'warm',
];

function defaultWorkspaceName() {
  const pick = () => SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${pick()}-${pick()}`;
}

export default function StartSessionPage({
  agents,
  projects,
  setProjects,
  setSessions,
  setActiveSession,
  fetchWorkspaces,
  fetchProjects,
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const { themeId } = useTerminalTheme();

  const [workspaceSource, setWorkspaceSource] = useState('existing');
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [customImageId, setCustomImageId] = useState('');
  const [customImages, setCustomImages] = useState([]);
  const [error, setError] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [projectCreating, setProjectCreating] = useState(false);
  const [agentKeysReady, setAgentKeysReady] = useState(true);
  const [authChecking, setAuthChecking] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [projectsHydrated, setProjectsHydrated] = useState(false);

  const [configFiles, setConfigFiles] = useState([]);
  const [envVars, setEnvVars] = useState([{ key: '', value: '' }]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState(null);
  const configInitialKeysRef = useRef(null);

  const sortedAgents = useMemo(
    () => sortAgentsByRecentUsage(agents, loadSidebarPrefs()),
    [agents],
  );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );

  const fetchCustomImages = useCallback(() => {
    return apiFetch('/api/v1/custom-images').then((res) => res.json()).then((data) => {
      const list = data.images || (Array.isArray(data) ? data : []);
      setCustomImages(list.filter((img) => img.status === 'ready'));
    }).catch(() => setCustomImages([]));
  }, []);

  const checkAgentKeysReady = useCallback(async (agent) => {
    if (!agent || agent.llm_auth_mode === 'gateway') return true;
    const required = agent.env_required || [];
    if (required.length === 0) return true;
    try {
      const res = await apiFetch('/api/v1/secrets');
      const data = await res.json();
      if (!res.ok) return false;
      return required.every((k) => Boolean(data[k]));
    } catch {
      return false;
    }
  }, []);

  const loadAgentConfig = useCallback(async (agent) => {
    const required = agent?.env_required || [];
    setConfigError(null);
    setConfigLoading(true);
    try {
      const res = await apiFetch('/api/v1/secrets');
      const data = await res.json();
      if (res.ok) {
        const allKeys = Object.keys(data);
        const seen = new Set();
        const nextEnvVars = [];
        for (const key of required) {
          const val = data[key];
          nextEnvVars.push({ key, value: val === '***' ? '' : (val || '') });
          seen.add(key);
        }
        for (const key of allKeys) {
          if (!seen.has(key)) {
            nextEnvVars.push({ key, value: data[key] === '***' ? '' : (data[key] || '') });
          }
        }
        setEnvVars(nextEnvVars);
        configInitialKeysRef.current = new Set(allKeys);
      } else {
        setEnvVars(required.map((key) => ({ key, value: '' })));
      }
    } catch {
      setEnvVars(required.map((key) => ({ key, value: '' })));
      setConfigError('Could not load saved keys.');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchProjects();
      if (!cancelled) setProjectsHydrated(true);
    })();
    fetchCustomImages();
    fetchWorkspaces();
    return () => { cancelled = true; };
  }, [fetchCustomImages, fetchWorkspaces, fetchProjects]);

  useEffect(() => {
    if (!launchWorkspaceId || projects.length === 0) return;
    if (projects.some((p) => p.id === launchWorkspaceId)) return;
    setLaunchWorkspaceId('');
    setWorkspaceSource(projects.length > 0 ? 'existing' : 'empty');
    setError('Selected workspace is no longer available. Pick another one or create a new workspace.');
  }, [projects, launchWorkspaceId]);

  useEffect(() => {
    if (!projectsHydrated) return;
    const projectId = searchParams.get('project');
    if (!projectId) return;
    const ws = projects.find((p) => p.id === projectId);
    if (ws) {
      setWorkspaceSource('existing');
      setLaunchWorkspaceId(ws.id);
      setNewProjectName(ws.name);
      setError(null);
      return;
    }
    if (projects.length > 0) {
      setError('Imported workspace is not ready yet. Wait a moment and refresh, or pick another workspace.');
    }
  }, [searchParams, projects, projectsHydrated]);

  useEffect(() => {
    if (!projectsHydrated) return;
    if (searchParams.get('project')) return;
    if (projects.length === 0) {
      setWorkspaceSource('empty');
      setLaunchWorkspaceId('');
      return;
    }
    if (!searchParams.get('project') && !launchWorkspaceId) {
      const prefs = loadSidebarPrefs();
      let defaultWs = null;
      for (const sessionId of prefs.recentSessionIds || []) {
        const snap = prefs.recentSessionSnapshots?.[sessionId];
        if (snap?.projectId) {
          defaultWs = projects.find((p) => p.id === snap.projectId);
          if (defaultWs) break;
        }
      }
      if (!defaultWs) {
        defaultWs = [...projects].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
      }
      if (defaultWs) {
        setWorkspaceSource('existing');
        setLaunchWorkspaceId(defaultWs.id);
        setNewProjectName(defaultWs.name);
      }
    }
  }, [projects, searchParams, launchWorkspaceId, projectsHydrated]);

  useEffect(() => {
    setConfigFiles([]);
  }, [selectedAgentId]);

  useEffect(() => {
    if (agents.length === 0) return;
    setSelectedAgentId((prev) => {
      if (prev && agents.some((a) => a.id === prev)) return prev;
      return sortedAgents[0]?.id || '';
    });
  }, [agents, sortedAgents]);

  useEffect(() => {
    let cancelled = false;
    setAuthChecking(true);
    checkAgentKeysReady(selectedAgent).then((ok) => {
      if (!cancelled) {
        setAgentKeysReady(ok);
        if (!ok && ((selectedAgent.env_required || []).length > 0 || selectedAgent.config_schema)) {
          setAdvancedOpen(true);
        }
      }
    }).finally(() => {
      if (!cancelled) setAuthChecking(false);
    });
    loadAgentConfig(selectedAgent);
    return () => { cancelled = true; };
  }, [selectedAgent, checkAgentKeysReady, loadAgentConfig]);

  const handleSaveConfig = async () => {
    setConfigError(null);
    const payload = {};
    for (const { key, value } of envVars) {
      const k = (key || '').trim();
      if (!k) continue;
      payload[k] = (value || '').trim();
    }
    if (configInitialKeysRef.current) {
      for (const k of configInitialKeysRef.current) {
        if (!(k in payload)) payload[k] = '';
      }
    }
    configInitialKeysRef.current = null;
    if (Object.keys(payload).length === 0) return;

    setConfigSaving(true);
    try {
      const res = await apiFetch('/api/v1/secrets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save keys');
      showToast('success', 'Configuration saved.');
      if (selectedAgent) {
        const ok = await checkAgentKeysReady(selectedAgent);
        setAgentKeysReady(ok);
      }
    } catch (err) {
      setConfigError(err.message);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleCreateProject = async (name) => {
    setProjectCreating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({ name }),
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
      setError(err.message);
      return null;
    } finally {
      setProjectCreating(false);
    }
  };

  const handleLaunch = async () => {
    setError(null);

    if (workspaceSource === 'existing') {
      if (!launchWorkspaceId) {
        setError('Select a workspace first.');
        return;
      }
      if (!projects.some((p) => p.id === launchWorkspaceId)) {
        setError('Selected workspace is no longer available. Pick another one or create a new workspace.');
        fetchWorkspaces();
        return;
      }
    }
    if (!selectedAgentId || !selectedAgent) {
      setError('Select a coding agent first.');
      return;
    }
    if (selectedAgent.llm_auth_mode === 'gateway' && !selectedAgent.gateway_model) {
      setError('This agent needs a gateway model. Choose another agent or ask an admin.');
      return;
    }

    setAuthChecking(true);
    const ready = await checkAgentKeysReady(selectedAgent);
    setAuthChecking(false);
    setAgentKeysReady(ready);
    if (!ready && selectedAgent.llm_auth_mode !== 'gateway') {
      setError('Configure required API keys in Advanced settings before starting.');
      setAdvancedOpen(true);
      return;
    }

    setLaunching(true);
    try {
      let projectId = launchWorkspaceId;
      let projectName = projects.find((p) => p.id === projectId)?.name || projectId;

      if (workspaceSource === 'empty') {
        const name = newProjectName.trim() || defaultWorkspaceName();
        const created = await handleCreateProject(name);
        if (!created) return;
        projectId = created.id;
        projectName = created.name;
        setProjects((prev) => {
          if (prev.some((p) => p.id === created.id)) return prev;
          return [...prev, { id: created.id, name: created.name, createdAt: Date.now() }];
        });
      }

      const cleanConfigFiles = configFiles.filter((f) => f.path && f.content);
      const requiredSet = new Set(selectedAgent.env_required || []);
      const cleanCustomEnv = {};
      for (const { key, value } of envVars) {
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
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = data.detail || data.error || data.message || 'Failed to start session';
        if (response.status === 401 || msg === 'Unauthorized') {
          setError('登录已过期，请重新登录。');
          return;
        }
        if (data.error === 'agent_not_granted') {
          setError('You do not have permission to use this agent.');
          return;
        }
        if (data.error === 'quota_exceeded') {
          setError(formatQuotaExceeded(data.dimension, data.current, data.limit));
          fetchWorkspaces();
          return;
        }
        if (data.error === 'Project not found' || msg === 'Project not found') {
          setLaunchWorkspaceId('');
          setWorkspaceSource(projects.length > 0 ? 'existing' : 'empty');
          setError('Workspace not found. It may have been deleted — pick another or create a new one.');
          fetchWorkspaces();
          return;
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
      navigate('/sessions');
    } catch (err) {
      setError(err.message);
    } finally {
      setLaunching(false);
    }
  };

  const busy = launching || projectCreating;

  return (
    <div className={`flex h-full min-h-0 flex-col ${bgCanvas}`}>
      <header className="shrink-0 border-b border-[#E8EAED] px-6 py-4">
        <button
          type="button"
          onClick={() => navigate('/sessions')}
          className={`mb-3 flex items-center gap-1.5 text-sm ${textPlaceholder} hover:text-[#202124] ${transitionBase} ${consoleButtonFocusClass}`}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Back to sessions
        </button>
        <h1 className={`text-lg font-semibold ${textPrimary}`}>Start session</h1>
        <p className={`mt-0.5 text-sm ${textSecondary}`}>
          Pick a workspace and coding agent to begin.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {busy && !launching ? (
          <div className={`mb-4 flex items-center gap-2 text-sm ${textSecondary}`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating workspace…
          </div>
        ) : null}

        <StartSessionForm
          workspaceSource={workspaceSource}
          onWorkspaceSourceChange={setWorkspaceSource}
          projects={projects}
          launchWorkspaceId={launchWorkspaceId}
          onLaunchWorkspaceIdChange={setLaunchWorkspaceId}
          newProjectName={newProjectName}
          onNewProjectNameChange={setNewProjectName}
          agents={sortedAgents}
          selectedAgentId={selectedAgentId}
          onSelectedAgentIdChange={setSelectedAgentId}
          selectedAgent={selectedAgent}
          customImages={customImages}
          customImageId={customImageId}
          onCustomImageIdChange={setCustomImageId}
          error={error}
          agentKeysReady={agentKeysReady}
          advancedOpen={advancedOpen}
          onAdvancedOpenChange={setAdvancedOpen}
          configFiles={configFiles}
          onConfigFilesChange={setConfigFiles}
          envVars={envVars}
          onEnvVarsChange={setEnvVars}
          configLoading={configLoading}
          configSaving={configSaving}
          configError={configError}
          onSaveConfig={handleSaveConfig}
          onOpenImport={() => setShowImportDialog(true)}
          onLaunch={handleLaunch}
          launching={busy || authChecking}
          authChecking={authChecking}
        />
      </div>

      {showImportDialog ? (
        <RepoImportDialog
          open={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          onImported={(projectId) => {
            fetchWorkspaces();
            if (projectId) {
              navigate(`/sessions/new?project=${encodeURIComponent(projectId)}`, { replace: true });
            }
          }}
          fetchWorkspaces={fetchWorkspaces}
        />
      ) : null}
    </div>
  );
}
