import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';

import AgentConsole from '../components/AgentConsole';
import Button from '../components/Button';
import Input, { FormLabel } from '../components/Input';
import PageHeader from '../components/PageHeader';
import SelectMenu from '../components/SelectMenu';
import SecretFields from '../components/settings/SecretFields';
import {
  ConsoleDialogShell,
  ConsoleStructuredDialogBody,
  ConsoleStructuredDialogFooter,
  ConsoleStructuredDialogHeader,
} from '../components/ConsoleDialog';
import { useSecrets } from '../hooks/useSecrets';
import { useToast } from '../components/Toast';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import {
  consoleCardClass,
  consoleDialogLgClass,
  consoleEmptyStateClass,
  consoleIconButtonClass,
  consoleIconButtonDangerClass,
  consolePageStackClass,
  consolePageTitleClass,
  consoleStatusBadgeClass,
  consoleStatusIconSlotClass,
  consoleToolPageClass,
} from '../lib/consoleTokens';
import { formatQuotaExceeded } from '../lib/quotaLabels';

const DEFAULT_TERMINAL_THEME_ID = 'nord';
const SLUG_WORDS = [
  'calm', 'bright', 'silent', 'swift', 'clear', 'fresh', 'gentle', 'bold', 'warm', 'quiet',
  'stone', 'river', 'forest', 'cloud', 'north', 'south', 'east', 'west', 'field', 'spark',
];
const ORPHAN_ID = '_orphan';

function defaultWorkspaceName() {
  const pick = () => SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${pick()}-${pick()}`;
}

function sessionStatusLabel(session) {
  if (session?.alive) return session.status || 'running';
  return session?.status || 'ended';
}

function sortSessionRows(list) {
  return [...list].sort((a, b) => {
    const aLive = a.alive === true ? 1 : 0;
    const bLive = b.alive === true ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const aTs = new Date(a.created_at || a.createdAt || a.updated_at || a.updatedAt || 0).getTime();
    const bTs = new Date(b.created_at || b.createdAt || b.updated_at || b.updatedAt || 0).getTime();
    return bTs - aTs;
  });
}

function buildWorkspaces(projects, sessions) {
  const byProject = new Map();
  const projectOrder = new Map(projects.map((project, index) => [project.id, index]));

  projects.forEach((project) => {
    byProject.set(project.id, {
      id: project.id,
      name: project.name,
      createdAt: project.created_at || project.createdAt || 0,
      sessions: [],
    });
  });

  sessions.forEach((session) => {
    const key = session.projectId || ORPHAN_ID;
    if (!byProject.has(key)) {
      byProject.set(key, {
        id: key,
        name: 'Unassigned',
        createdAt: 0,
        sessions: [],
      });
    }
    byProject.get(key).sessions.push(session);
  });

  return [...byProject.values()]
    .map((workspace) => {
      const sessionsForWorkspace = sortSessionRows(workspace.sessions);
      const lastActivity = Math.max(
        workspace.createdAt ? new Date(workspace.createdAt).getTime() : 0,
        ...sessionsForWorkspace.map((session) => new Date(session.created_at || session.createdAt || session.updated_at || session.updatedAt || 0).getTime()),
      );
      return {
        ...workspace,
        sessions: sessionsForWorkspace,
        liveCount: sessionsForWorkspace.filter((session) => session.alive === true).length,
        lastActivity: Number.isFinite(lastActivity) ? lastActivity : 0,
      };
    })
    .sort((a, b) => {
      const aIndex = projectOrder.has(a.id) ? projectOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bIndex = projectOrder.has(b.id) ? projectOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return b.lastActivity - a.lastActivity;
    });
}

function SessionStatusPill({ session }) {
  const label = sessionStatusLabel(session);
  const live = session.alive === true;
  const tone = live
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : label === 'starting' || label === 'pending'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-zinc-200 bg-zinc-50 text-zinc-600';

  return (
    <span className={cn(consoleStatusBadgeClass, 'rounded-full border px-2.5 py-0.5', tone)}>
      <span className={consoleStatusIconSlotClass} aria-hidden>
        <span className={cn('h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-zinc-400')} />
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

function WorkspaceRow({
  workspace,
  expanded,
  onToggle,
  onSelectSession,
  onOpenNewSession,
  onStopOrDelete,
  busySessionId,
  busySessionAction,
  selectedSessionId,
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onToggle}
        >
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />}
          <span className="min-w-0 truncate text-sm font-medium text-zinc-900">{workspace.name}</span>
          <span className="text-xs text-zinc-500">({workspace.sessions.length})</span>
          {workspace.liveCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {workspace.liveCount} live
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={consoleIconButtonClass}
          title="New session in workspace"
          onClick={onOpenNewSession}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {expanded ? (
        <div className="divide-y divide-zinc-100">
          {workspace.sessions.length === 0 ? (
            <div className="px-4 py-3 text-sm text-zinc-500">No sessions in this workspace.</div>
          ) : (
            workspace.sessions.map((session) => {
              const selected = session.id === selectedSessionId;
              const isBusy = busySessionId === session.id;
              return (
                <div
                  key={session.id}
                  className={cn(
                    'flex items-start justify-between gap-3 px-4 py-3',
                    selected ? 'bg-zinc-50' : 'bg-white hover:bg-zinc-50/70',
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', session.alive ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400')} />
                      <span className="truncate text-sm font-medium text-zinc-900">
                        {session.agentName || session.agentId}
                      </span>
                      <SessionStatusPill session={session} />
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                      {session.projectName || workspace.name}
                    </p>
                  </button>
                  <div className="flex items-center gap-1">
                    {session.alive ? (
                      <button
                        type="button"
                        aria-label="Stop session"
                        title="Stop session"
                        onClick={() => onStopOrDelete(session)}
                        disabled={isBusy}
                        className={consoleIconButtonClass}
                      >
                        {isBusy && busySessionAction === 'stop' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Delete session"
                      title="Delete session"
                      onClick={() => onStopOrDelete(session)}
                      disabled={isBusy}
                      className={consoleIconButtonDangerClass}
                    >
                      {isBusy && busySessionAction === 'delete' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function Sessions() {
  const { secrets, saveSecrets } = useSecrets();
  const { showToast } = useToast();
  const [agents, setAgents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchMode, setLaunchMode] = useState('new');
  const [launchProjectId, setLaunchProjectId] = useState('');
  const [launchWorkspaceName, setLaunchWorkspaceName] = useState(defaultWorkspaceName());
  const [launchError, setLaunchError] = useState('');
  const [launching, setLaunching] = useState(false);
  const [busySessionId, setBusySessionId] = useState(null);
  const [busySessionAction, setBusySessionAction] = useState(null);
  const [secretsDialogOpen, setSecretsDialogOpen] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState(null);
  const [secretDrafts, setSecretDrafts] = useState({});
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState(() => new Set());
  const launchBusyRef = useRef(false);

  const fetchAgents = useCallback(async () => {
    const res = await apiFetch('/api/v1/agents');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load agents');
    setAgents(Array.isArray(data) ? data : []);
  }, []);

  const fetchProjects = useCallback(async () => {
    const res = await apiFetch('/api/v1/projects');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load workspaces');
    setProjects(Array.isArray(data) ? data : []);
  }, []);

  const fetchSessions = useCallback(async () => {
    const res = await apiFetch('/api/v1/sessions');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load sessions');
    setSessions(Array.isArray(data) ? data : []);
  }, []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    setRefreshing(true);
    const errors = [];
    await Promise.all([
      fetchAgents().catch((err) => errors.push(`Agents: ${err.message}`)),
      fetchProjects().catch((err) => errors.push(`Workspaces: ${err.message}`)),
      fetchSessions().catch((err) => errors.push(`Sessions: ${err.message}`)),
    ]);
    setRefreshing(false);
    if (errors.length > 0 && !silent) {
      showToast('error', errors[0]);
    }
  }, [fetchAgents, fetchProjects, fetchSessions, showToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refresh({ silent: true });
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      refresh({ silent: true });
    }, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (agents.length === 0) return;
    if (!selectedAgentId || !agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  const workspaces = useMemo(() => buildWorkspaces(projects, sessions), [projects, sessions]);

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    const selectedSession = sessions.find((session) => session.id === selectedSessionId);
    if (!selectedSession || !sessions.some((session) => session.id === selectedSessionId)) {
      const next = sessions.find((session) => session.alive) ?? sessions[0];
      setSelectedSessionId(next?.id || null);
    }
  }, [selectedSessionId, sessions, workspaces.length]);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) || null,
    [selectedSessionId, sessions],
  );

  useEffect(() => {
    if (!selectedSession?.projectId) return;
    setExpandedWorkspaceIds((prev) => {
      if (prev.has(selectedSession.projectId)) return prev;
      const next = new Set(prev);
      next.add(selectedSession.projectId);
      return next;
    });
  }, [selectedSession?.projectId]);

  useEffect(() => {
    if (launchMode === 'existing' && !projects.some((project) => project.id === launchProjectId)) {
      setLaunchProjectId(projects[0]?.id || '');
      if (projects.length === 0) setLaunchMode('new');
    }
  }, [launchMode, launchProjectId, projects]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

  const openLaunchModal = useCallback((mode = 'new', workspaceId = '') => {
    setLaunchError('');
    setLaunchMode(mode);
    setLaunchProjectId(workspaceId || '');
    setLaunchWorkspaceName(mode === 'new' ? defaultWorkspaceName() : '');
    setLaunchOpen(true);
    if (selectedAgentId) return;
    if (agents[0]?.id) setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  const createProject = useCallback(async (name) => {
    const res = await apiFetch('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'quota_exceeded') {
        throw new Error(formatQuotaExceeded(data.dimension || 'max_projects', data.current, data.limit));
      }
      throw new Error(data.error || 'Failed to create workspace');
    }
    const project = { id: data.id, name: data.name || name };
    setProjects((prev) => (prev.some((item) => item.id === project.id) ? prev : [project, ...prev]));
    return project;
  }, []);

  const openSecretsModal = useCallback((launchContext) => {
    const agent = agents.find((item) => item.id === launchContext.agentId) || null;
    const required = agent?.env_required || [];
    setPendingLaunch(launchContext);
    setSecretDrafts(required.reduce((acc, key) => {
      acc[key] = '';
      return acc;
    }, {}));
    setSecretsDialogOpen(true);
  }, [agents]);

  const startSession = useCallback(async ({ agentId, projectId, projectName }, { allowSecretsPrompt = true } = {}) => {
    const agent = agents.find((item) => item.id === agentId) || null;
    if (!agent) {
      showToast('error', 'Select an agent first.');
      return false;
    }
    if (!projectId) {
      showToast('error', 'Select or create a workspace first.');
      return false;
    }

    const required = agent.llm_auth_mode === 'gateway' ? [] : (agent.env_required || []);
    const missing = required.filter((key) => !secrets[key]);
    if (allowSecretsPrompt && missing.length > 0) {
      openSecretsModal({ agentId, projectId, projectName });
      return false;
    }

    if (launchBusyRef.current) return false;
    launchBusyRef.current = true;
    setLaunching(true);
    try {
      const res = await apiFetch('/api/v1/session/start', {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId,
          project_id: projectId,
          terminal_theme_id: DEFAULT_TERMINAL_THEME_ID,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || data.message || 'Failed to start session';
        if (data.error === 'agent_not_granted') {
          showToast('error', 'You do not have permission to use this agent.');
          return false;
        }
        if (data.error === 'quota_exceeded') {
          showToast('error', formatQuotaExceeded(data.dimension, data.current, data.limit));
          return false;
        }
        if (/Missing required env|Secrets Vault/i.test(message)) {
          if (allowSecretsPrompt) openSecretsModal({ agentId, projectId, projectName });
          else showToast('error', message);
          return false;
        }
        throw new Error(message);
      }

      const sessionRow = {
        id: data.session_id,
        agentId,
        projectId,
        projectName,
        status: data.status || 'running',
        alive: true,
        created_at: new Date().toISOString(),
      };
      setSessions((prev) => [sessionRow, ...prev.filter((session) => session.id !== sessionRow.id)]);
      setSelectedSessionId(sessionRow.id);
      setExpandedWorkspaceIds((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      showToast('success', 'Session started.');
      refresh({ silent: true });
      return true;
    } catch (error) {
      showToast('error', error.message);
      return false;
    } finally {
      setLaunching(false);
      launchBusyRef.current = false;
    }
  }, [agents, openSecretsModal, refresh, secrets, showToast]);

  const handleLaunch = useCallback(async (event) => {
    event.preventDefault();
    setLaunchError('');
    if (!selectedAgent) {
      setLaunchError('Select an agent first.');
      return;
    }

    let project;
    if (launchMode === 'existing') {
      project = projects.find((item) => item.id === launchProjectId) || null;
      if (!project) {
        setLaunchError('Select a workspace first.');
        return;
      }
    } else {
      const name = launchWorkspaceName.trim() || defaultWorkspaceName();
      try {
        project = await createProject(name);
      } catch (error) {
        setLaunchError(error.message);
        showToast('error', error.message);
        return;
      }
    }

    const started = await startSession({
      agentId: selectedAgent.id,
      projectId: project.id,
      projectName: project.name,
    });
    if (started) {
      setLaunchOpen(false);
      setLaunchError('');
    }
  }, [createProject, launchMode, launchProjectId, launchWorkspaceName, projects, selectedAgent, startSession, showToast]);

  const handleSaveSecrets = useCallback(async (event) => {
    event.preventDefault();
    if (!pendingLaunch) return;

    const payload = {};
    Object.entries(secretDrafts).forEach(([key, value]) => {
      const trimmed = value.trim();
      if (trimmed) payload[key] = trimmed;
    });
    if (Object.keys(payload).length === 0) {
      showToast('error', 'Enter the required secrets first.');
      return;
    }

    const ok = await saveSecrets(payload, { successMessage: 'Secrets saved.' });
    if (!ok) return;

    const launch = pendingLaunch;
    setPendingLaunch(null);
    setSecretsDialogOpen(false);
    setSecretDrafts({});
    const started = await startSession(launch, { allowSecretsPrompt: false });
    if (started) {
      setLaunchOpen(false);
      setLaunchError('');
    }
  }, [pendingLaunch, saveSecrets, secretDrafts, startSession, showToast]);

  const handleStopOrDelete = useCallback(async (session) => {
    setBusySessionId(session.id);
    setBusySessionAction(session.alive ? 'stop' : 'delete');
    try {
      const res = await apiFetch(`/api/v1/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove session');
      showToast('success', session.alive ? 'Session stopped.' : 'Session deleted.');
      if (selectedSessionId === session.id) setSelectedSessionId(null);
      await refresh({ silent: true });
    } catch (error) {
      showToast('error', error.message);
    } finally {
      setBusySessionId(null);
      setBusySessionAction(null);
    }
  }, [refresh, selectedSessionId, showToast]);

  const handleSessionEnd = useCallback(() => {
    refresh({ silent: true });
  }, [refresh]);

  const selectedSessionWorkspace = useMemo(() => {
    if (!selectedSession) return null;
    return workspaces.find((workspace) => workspace.id === (selectedSession.projectId || ORPHAN_ID)) || null;
  }, [selectedSession, workspaces]);

  useEffect(() => {
    if (selectedSessionWorkspace?.id) {
      setExpandedWorkspaceIds((prev) => {
        if (prev.has(selectedSessionWorkspace.id)) return prev;
        const next = new Set(prev);
        next.add(selectedSessionWorkspace.id);
        return next;
      });
    }
  }, [selectedSessionWorkspace?.id]);

  const workspaceLaunchOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );

  const launchModal = launchOpen ? (
    <ConsoleDialogShell
      onClose={() => {
        setLaunchOpen(false);
        setLaunchError('');
      }}
      panelClassName={consoleDialogLgClass}
      fitContent
    >
      <form onSubmit={handleLaunch} className="flex flex-col">
        <ConsoleStructuredDialogHeader
          title={launchMode === 'new' ? 'New workspace' : 'New session'}
          subtitle={launchMode === 'new'
            ? 'Create a workspace, then start an agent session in it.'
            : 'Start another agent session in an existing workspace.'}
        />
        <ConsoleStructuredDialogBody>
          {launchError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {launchError}
            </div>
          ) : null}

          <div className="space-y-2">
            <FormLabel>Agent</FormLabel>
            <SelectMenu
              value={selectedAgentId}
              onChange={setSelectedAgentId}
              options={agentOptions}
              placeholder={agents.length > 0 ? 'Select an agent' : 'No agents available'}
              searchable
              searchPlaceholder="Search agents…"
              disabled={agents.length === 0}
            />
          </div>

          <div className="space-y-2">
            <FormLabel>Workspace mode</FormLabel>
            <SelectMenu
              value={launchMode}
              onChange={(next) => {
                setLaunchMode(next);
                setLaunchError('');
                if (next === 'new') {
                  setLaunchWorkspaceName(defaultWorkspaceName());
                } else if (!launchProjectId) {
                  setLaunchProjectId(projects[0]?.id || '');
                }
              }}
              options={[
                { value: 'new', label: 'Create new workspace' },
                { value: 'existing', label: 'Use existing workspace' },
              ]}
              placeholder="Choose workspace mode"
            />
          </div>

          {launchMode === 'new' ? (
            <div className="space-y-2">
              <FormLabel>Workspace name</FormLabel>
              <Input
                value={launchWorkspaceName}
                onChange={(event) => setLaunchWorkspaceName(event.target.value)}
                placeholder="my-workspace"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <FormLabel>Workspace</FormLabel>
              <SelectMenu
                value={launchProjectId}
                onChange={setLaunchProjectId}
                options={workspaceLaunchOptions}
                placeholder={projects.length > 0 ? 'Select a workspace' : 'No workspaces yet'}
                searchable
                searchPlaceholder="Search workspaces…"
                disabled={projects.length === 0}
              />
            </div>
          )}
        </ConsoleStructuredDialogBody>
        <ConsoleStructuredDialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setLaunchOpen(false);
              setLaunchError('');
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={launching || agents.length === 0}>
            {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Start session
          </Button>
        </ConsoleStructuredDialogFooter>
      </form>
    </ConsoleDialogShell>
  ) : null;

  const secretsModal = secretsDialogOpen && pendingLaunch ? (
    <ConsoleDialogShell
      onClose={() => {
        setSecretsDialogOpen(false);
        setPendingLaunch(null);
      }}
      panelClassName={consoleDialogLgClass}
      fitContent
    >
      <form onSubmit={handleSaveSecrets} className="flex flex-col">
        <ConsoleStructuredDialogHeader
          title="Configure required secrets"
          subtitle={`Needed to launch ${agents.find((agent) => agent.id === pendingLaunch.agentId)?.name || 'this agent'}.`}
        />
        <ConsoleStructuredDialogBody>
          <SecretFields
            keys={agents.find((agent) => agent.id === pendingLaunch.agentId)?.env_required || []}
            secrets={secretDrafts}
            onChange={(key, value) => setSecretDrafts((prev) => ({ ...prev, [key]: value }))}
            savedHints={secrets}
            missingKeys={(agents.find((agent) => agent.id === pendingLaunch.agentId)?.env_required || []).filter(
              (key) => !secrets[key] && !secretDrafts[key]?.trim(),
            )}
            mono
          />
        </ConsoleStructuredDialogBody>
        <ConsoleStructuredDialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSecretsDialogOpen(false);
              setPendingLaunch(null);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={launching}>
            {launching ? 'Saving…' : 'Save & launch'}
          </Button>
        </ConsoleStructuredDialogFooter>
      </form>
    </ConsoleDialogShell>
  ) : null;

  return (
    <div className={cn(consoleToolPageClass, consolePageStackClass)}>
      {launchModal}
      {secretsModal}

      <PageHeader
        title="Sessions"
        description="Create a workspace, start an agent session, and interact with the live terminal."
        actions={(
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => refresh()}
              disabled={refreshing}
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        )}
        className="border-b-0 pb-0"
      />

      <div className="grid flex-1 min-h-0 gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4">
          <section className={cn(consoleCardClass, 'flex items-center justify-between gap-3 px-4 py-3')}>
            <div>
              <h2 className={consolePageTitleClass}>Workspaces</h2>
              <p className="text-sm text-zinc-500">{workspaces.length} total</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openLaunchModal('new')}
              >
                <Plus className="h-4 w-4" />
                New workspace
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openLaunchModal(projects.length > 0 ? 'existing' : 'new', selectedSession?.projectId || projects[0]?.id || '')}
              >
                <Plus className="h-4 w-4" />
                New session
              </Button>
            </div>
          </section>

          <section className={cn(consoleCardClass, 'min-h-0 flex flex-1 flex-col overflow-hidden')}>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading ? (
                <div className={cn(consoleEmptyStateClass, 'min-h-[10rem] gap-2 p-6 text-sm text-zinc-500')}>
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  Loading sessions…
                </div>
              ) : workspaces.length === 0 ? (
                <div className={cn(consoleEmptyStateClass, 'min-h-[10rem] gap-3 p-6 text-center text-sm text-zinc-500')}>
                  <p className="text-base font-medium text-zinc-900">No workspaces yet.</p>
                  <p>Create one to start a session.</p>
                  <Button type="button" variant="primary" size="sm" onClick={() => openLaunchModal('new')}>
                    <Plus className="h-4 w-4" />
                    New workspace
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {workspaces.map((workspace) => {
                    const expanded = expandedWorkspaceIds.has(workspace.id) || workspace.sessions.some((session) => session.id === selectedSessionId);
                    return (
                      <WorkspaceRow
                        key={workspace.id}
                        workspace={workspace}
                        expanded={expanded}
                        onToggle={() => {
                          setExpandedWorkspaceIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(workspace.id)) next.delete(workspace.id);
                            else next.add(workspace.id);
                            return next;
                          });
                        }}
                        onSelectSession={(sessionId) => setSelectedSessionId(sessionId)}
                        onOpenNewSession={() => openLaunchModal('existing', workspace.id)}
                        onStopOrDelete={handleStopOrDelete}
                        busySessionId={busySessionId}
                        busySessionAction={busySessionAction}
                        selectedSessionId={selectedSessionId}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </aside>

        <section className="flex min-h-0 flex-col">
          {selectedSession ? (
            <AgentConsole
              key={selectedSession.id}
              sessionId={selectedSession.id}
              agentName={agents.find((agent) => agent.id === selectedSession.agentId)?.name || selectedSession.agentId}
              sessionLive={Boolean(selectedSession.alive)}
              onSessionEnd={handleSessionEnd}
            />
          ) : (
            <div className={cn(consoleCardClass, 'flex min-h-[32rem] flex-1 items-center justify-center p-8')}>
              <div className={cn(consoleEmptyStateClass, 'w-full max-w-md gap-3 p-8 text-center text-sm text-zinc-500')}>
                <p className="text-lg font-medium text-zinc-900">No session selected</p>
                <p>Start a session to open a live terminal here.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
