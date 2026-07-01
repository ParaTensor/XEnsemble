import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw, Square, Trash2 } from 'lucide-react';

import AgentConsole from '../components/AgentConsole';
import Button from '../components/Button';
import Input, { FormLabel } from '../components/Input';
import PageHeader from '../components/PageHeader';
import SelectMenu from '../components/SelectMenu';
import SecretFields from '../components/settings/SecretFields';
import { ConsoleDialogShell, ConsoleStructuredDialogBody, ConsoleStructuredDialogFooter, ConsoleStructuredDialogHeader } from '../components/ConsoleDialog';
import { useSecrets } from '../hooks/useSecrets';
import { useToast } from '../components/Toast';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import {
  consoleCardClass,
  consoleEmptyStateClass,
  consoleIconButtonClass,
  consoleIconButtonDangerClass,
  consolePageStackClass,
  consolePageTitleClass,
  consoleStatusBadgeClass,
  consoleStatusIconSlotClass,
  consoleToolPageClass,
  consoleDialogLgClass,
} from '../lib/consoleTokens';
import { formatQuotaExceeded } from '../lib/quotaLabels';

const DEFAULT_TERMINAL_THEME_ID = 'nord';

const SLUG_WORDS = [
  'calm', 'bright', 'silent', 'swift', 'clear', 'fresh', 'gentle', 'bold', 'warm', 'quiet',
  'stone', 'river', 'forest', 'cloud', 'north', 'south', 'east', 'west', 'field', 'spark',
];

function defaultWorkspaceName() {
  const pick = () => SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${pick()}-${pick()}`;
}

function statusLabel(session) {
  if (session?.alive) return session?.status || 'running';
  return session?.status || 'ended';
}

function sessionSortValue(session) {
  const ts = session?.created_at || session?.createdAt || session?.updated_at || session?.updatedAt;
  const parsed = ts ? new Date(ts).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function SessionStatusPill({ session }) {
  const label = statusLabel(session);
  const live = Boolean(session?.alive);
  const tone =
    label === 'running'
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

export default function Console() {
  const { secrets, saveSecrets } = useSecrets();
  const { showToast } = useToast();
  const [agents, setAgents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [busySessionId, setBusySessionId] = useState(null);
  const [busySessionAction, setBusySessionAction] = useState(null);
  const [workspaceMode, setWorkspaceMode] = useState('new');
  const [workspaceName, setWorkspaceName] = useState(defaultWorkspaceName());
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [secretsDialogOpen, setSecretsDialogOpen] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState(null);
  const [secretDrafts, setSecretDrafts] = useState({});
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

  useEffect(() => {
    if (workspaceMode === 'existing' && projects.length > 0 && (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId))) {
      setSelectedProjectId(projects[0].id);
    }
    if (workspaceMode === 'existing' && projects.length === 0) {
      setWorkspaceMode('new');
    }
  }, [projects, selectedProjectId, workspaceMode]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => sessionSortValue(b) - sessionSortValue(a)),
    [sessions],
  );

  useEffect(() => {
    if (sortedSessions.length === 0) {
      setSelectedSessionId(null);
      return;
    }
    if (!selectedSessionId || !sortedSessions.some((session) => session.id === selectedSessionId)) {
      const next = sortedSessions.find((session) => session.alive) ?? sortedSessions[0];
      setSelectedSessionId(next?.id ?? null);
    }
  }, [selectedSessionId, sortedSessions]);

  const selectedSession = useMemo(
    () => sortedSessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sortedSessions],
  );

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const agentOptions = useMemo(
    () => agents.map((agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

  const workspaceOptions = useMemo(
    () => projects.map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );

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

  const openSecretsModal = useCallback((launchContext, nextDrafts = {}) => {
    const agent = agents.find((item) => item.id === launchContext.agentId) ?? null;
    const required = agent?.env_required || [];
    setPendingLaunch(launchContext);
    setSecretDrafts(
      required.reduce((acc, key) => {
        acc[key] = nextDrafts[key] || '';
        return acc;
      }, {}),
    );
    setSecretsDialogOpen(true);
  }, [agents]);

  const startSession = useCallback(async ({
    agentId,
    projectId,
    projectName,
  }, { allowSecretsPrompt = true } = {}) => {
    const agent = agents.find((item) => item.id === agentId) ?? null;
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
      openSecretsModal({ agentId, projectId, projectName }, missing.reduce((acc, key) => {
        acc[key] = '';
        return acc;
      }, {}));
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
          if (allowSecretsPrompt) {
            openSecretsModal({ agentId, projectId, projectName });
          } else {
            showToast('error', message);
          }
          return false;
        }
        throw new Error(message);
      }

      const sessionRow = {
        id: data.session_id,
        agentId,
        projectId,
        status: data.status || 'running',
        alive: true,
        created_at: new Date().toISOString(),
        projectName,
      };
      setSessions((prev) => [sessionRow, ...prev.filter((session) => session.id !== sessionRow.id)]);
      setSelectedSessionId(sessionRow.id);
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
    if (!selectedAgent) {
      showToast('error', 'Select an agent first.');
      return;
    }

    let project;
    if (workspaceMode === 'existing') {
      project = selectedProject;
      if (!project) {
        showToast('error', 'Select a workspace first.');
        return;
      }
    } else {
      const name = workspaceName.trim() || defaultWorkspaceName();
      try {
        project = await createProject(name);
      } catch (error) {
        showToast('error', error.message);
        return;
      }
    }

    await startSession({
      agentId: selectedAgent.id,
      projectId: project.id,
      projectName: project.name,
    });
  }, [createProject, selectedAgent, selectedProject, startSession, workspaceMode, workspaceName, showToast]);

  const handleSaveSecrets = useCallback(async (event) => {
    event.preventDefault();
    if (!pendingLaunch) return;

    const payload = {};
    const keys = Object.keys(secretDrafts);
    keys.forEach((key) => {
      const value = secretDrafts[key]?.trim();
      if (value) payload[key] = value;
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
    await startSession(launch, { allowSecretsPrompt: false });
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
      if (selectedSessionId === session.id) {
        setSelectedSessionId(null);
      }
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

  const launchModeOptions = useMemo(() => ([
    { value: 'new', label: 'Create new workspace' },
    { value: 'existing', label: 'Use existing workspace' },
  ]), []);

  const agentNeedsSecrets = selectedAgent && selectedAgent.llm_auth_mode !== 'gateway' && (selectedAgent.env_required || []).length > 0;

  return (
    <div className={cn(consoleToolPageClass, consolePageStackClass)}>
      {secretsDialogOpen && pendingLaunch ? (
        <ConsoleDialogShell
          onClose={() => {
            setSecretsDialogOpen(false);
            setPendingLaunch(null);
          }}
          panelClassName={consoleDialogLgClass}
        >
          <ConsoleStructuredDialogHeader
            title="Configure required secrets"
            subtitle={`Needed to launch ${agents.find((agent) => agent.id === pendingLaunch.agentId)?.name || 'this agent'}.`}
          />
          <form onSubmit={handleSaveSecrets} className="flex min-h-0 flex-1 flex-col">
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
              <Button type="button" variant="secondary" onClick={() => {
                setSecretsDialogOpen(false);
                setPendingLaunch(null);
              }}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={launching}>
                {launching ? 'Saving…' : 'Save & launch'}
              </Button>
            </ConsoleStructuredDialogFooter>
          </form>
        </ConsoleDialogShell>
      ) : null}

      <PageHeader
        title="Console"
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

      <div className="grid flex-1 min-h-0 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-6">
          <section className={cn(consoleCardClass, 'flex flex-col gap-4 p-4')}>
            <div>
              <h2 className={consolePageTitleClass}>Start session</h2>
              <p className="mt-1 text-sm text-zinc-500">Launch a BoxLite-backed session in a new or existing workspace.</p>
            </div>
            <form className="space-y-4" onSubmit={handleLaunch}>
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
                {agentNeedsSecrets ? (
                  <p className="text-xs text-zinc-500">
                    {selectedAgent?.env_required.length} secret{selectedAgent?.env_required.length === 1 ? '' : 's'} required.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <FormLabel>Workspace mode</FormLabel>
                <SelectMenu
                  value={workspaceMode}
                  onChange={setWorkspaceMode}
                  options={launchModeOptions}
                  placeholder="Choose workspace mode"
                />
              </div>

              {workspaceMode === 'new' ? (
                <div className="space-y-2">
                  <FormLabel>Workspace name</FormLabel>
                  <Input
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    placeholder="my-workspace"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <FormLabel>Workspace</FormLabel>
                  <SelectMenu
                    value={selectedProjectId}
                    onChange={setSelectedProjectId}
                    options={workspaceOptions}
                    placeholder={projects.length > 0 ? 'Select a workspace' : 'No workspaces yet'}
                    searchable
                    searchPlaceholder="Search workspaces…"
                    disabled={projects.length === 0}
                  />
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={launching || agents.length === 0 || (workspaceMode === 'existing' && projects.length === 0)}
              >
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start session
              </Button>
            </form>
          </section>

          <section className={cn(consoleCardClass, 'min-h-0 flex flex-1 flex-col overflow-hidden')}>
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className={consolePageTitleClass}>Sessions</h2>
                <p className="text-sm text-zinc-500">{sortedSessions.length} total</p>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className={cn(consoleEmptyStateClass, 'min-h-[10rem] gap-2 p-6 text-sm text-zinc-500')}>
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                  Loading sessions…
                </div>
              ) : sortedSessions.length === 0 ? (
                <div className={cn(consoleEmptyStateClass, 'min-h-[10rem] p-6 text-center text-sm text-zinc-500')}>
                  No sessions yet. Start one above to open a terminal.
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedSessions.map((session) => {
                    const active = session.id === selectedSessionId;
                    const project = projects.find((item) => item.id === session.projectId);
                    const agent = agents.find((item) => item.id === session.agentId);
                    return (
                      <div
                        key={session.id}
                        className={cn(
                          'group flex items-start justify-between gap-3 rounded-lg border p-3 transition-colors',
                          active ? 'border-black bg-zinc-50' : 'border-zinc-200 bg-white hover:bg-zinc-50',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedSessionId(session.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium text-zinc-900">
                              {agent?.name || session.agentId}
                            </span>
                            <SessionStatusPill session={session} />
                          </div>
                          <p className="mt-1 truncate text-xs text-zinc-500">
                            {project?.name || session.projectName || session.projectId || 'Unassigned'}
                          </p>
                        </button>
                        <div className="flex items-center gap-1">
                          {session.alive ? (
                            <button
                              type="button"
                              title={busySessionId === session.id && busySessionAction === 'stop' ? 'Stopping…' : 'Stop session'}
                              aria-label="Stop session"
                              onClick={() => handleStopOrDelete(session)}
                              disabled={busySessionId === session.id}
                              className={consoleIconButtonClass}
                            >
                              {busySessionId === session.id && busySessionAction === 'stop' ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Square className="h-4 w-4" />
                              )}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title={busySessionId === session.id && busySessionAction === 'delete' ? 'Deleting…' : 'Delete session'}
                            aria-label="Delete session"
                            onClick={() => handleStopOrDelete(session)}
                            disabled={busySessionId === session.id}
                            className={consoleIconButtonDangerClass}
                          >
                            {busySessionId === session.id && busySessionAction === 'delete' ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
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
