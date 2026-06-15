import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { Plus, Download, KeyRound, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { AuthContext } from '../App';
import Button from '../components/Button';
import Input from '../components/Input';
import SelectMenu from '../components/SelectMenu';
import PageHeader from '../components/PageHeader';
import { ConsoleDialogShell } from '../components/ConsoleDialog';
import { useToast } from '../components/Toast';
import {
  consoleDialogAdminFormPanelClass,
  consolePageStackClass,
  consoleSectionLabelClass,
  consoleTableBodyCellClass,
  consoleTableHeadCellClass,
  consoleTableShellClass,
} from '../lib/consoleTokens';
import { loadAdminAgentsCache, saveAdminAgentsCache } from '../lib/adminAgentsCache';
import { getSecretLabel, isSecretPasswordField } from '../lib/secretLabels';
import { getApiBase } from '../lib/api';

const EMPTY_SPAWN_DRAFT = {
  OPENROUTER_API_KEY: '',
  OPENROUTER_BASE_URL: '',
  launch_command: '',
};

function statusBadge(installed) {
  return installed
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
}

const ACTION_PROGRESS_LABEL = {
  install: 'Installing',
  uninstall: 'Removing',
  update: 'Updating',
};

const ACTION_LOADING_HINT = {
  install: 'This may take several minutes.',
};

function formatLifecycleTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function patchAgentLifecycle(agents, agentId, lastLifecycle) {
  if (!lastLifecycle) return agents;
  return agents.map((agent) => (
    agent.id === agentId ? { ...agent, last_lifecycle: lastLifecycle } : agent
  ));
}

function getGatewaySpawnFieldDefs(agent) {
  if (!agent) return [];
  const envRequired = agent.env_required || [];
  const usesOpenRouter = agent.id === 'hermes'
    || envRequired.includes('OPENROUTER_API_KEY')
    || envRequired.includes('HERMES_API_KEY');
  if (!usesOpenRouter) return [];
  return [
    {
      key: 'OPENROUTER_API_KEY',
      label: 'OpenRouter API Key',
      source: 'Router API Key',
      password: true,
    },
    {
      key: 'OPENROUTER_BASE_URL',
      label: 'OpenRouter Base URL',
      source: 'Router Base URL (+ /v1)',
      password: false,
    },
  ];
}

export default function AgentsAdmin() {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const [agents, setAgents] = useState(() => loadAdminAgentsCache());
  const [gatewayProviders, setGatewayProviders] = useState([]);
  const [loading, setLoading] = useState(() => loadAdminAgentsCache().length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keysAgent, setKeysAgent] = useState(null);
  const [authDraft, setAuthDraft] = useState({ llm_auth_mode: 'byok', provider: '', model: '' });
  const [savingKeys, setSavingKeys] = useState(false);
  const [gatewayPreview, setGatewayPreview] = useState(null);
  const [gatewayPreviewLoading, setGatewayPreviewLoading] = useState(false);
  const [spawnDraft, setSpawnDraft] = useState(EMPTY_SPAWN_DRAFT);
  const spawnHydratedRef = useRef(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [editAgent, setEditAgent] = useState(null);
  const [editDraft, setEditDraft] = useState({ cmd: '', args: '' });
  const [savingExecutable, setSavingExecutable] = useState(false);
  const [newAgent, setNewAgent] = useState({
    id: '',
    name: '',
    cmd: '',
    args: '[]',
    env_required: '[]',
  });

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const fetchAgents = useCallback(({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    return fetch(`${getApiBase()}/api/v1/admin/agents`, { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(data);
          saveAdminAgentsCache(data);
        }
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [authHeaders]);

  useEffect(() => {
    fetchAgents({ silent: agents.length > 0 });
  }, [fetchAgents]);

  useEffect(() => {
    if (!token) return;
    fetch(`${getApiBase()}/api/v1/admin/gateway/providers`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGatewayProviders(data?.data || []))
      .catch(() => {});
  }, [token, authHeaders]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const parsedArgs = JSON.parse(newAgent.args);
      const parsedEnv = JSON.parse(newAgent.env_required);

      const res = await fetch(`${getApiBase()}/api/v1/agents`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          ...newAgent,
          args: parsedArgs,
          env_required: parsedEnv,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast('success', 'Agent registered.');
      setDialogOpen(false);
      setNewAgent({ id: '', name: '', cmd: '', args: '[]', env_required: '[]' });
      fetchAgents({ silent: true });
    } catch (err) {
      showToast('error', err.message || 'Invalid JSON in Args or Env Required');
    }
  };

  const openKeysDialog = (agent) => {
    spawnHydratedRef.current = false;
    const overrides = agent.gateway_config?.env_overrides || {};
    setSpawnDraft({
      OPENROUTER_API_KEY: overrides.OPENROUTER_API_KEY || '',
      OPENROUTER_BASE_URL: overrides.OPENROUTER_BASE_URL || '',
      launch_command: [agent.cmd, ...(agent.args || [])].filter(Boolean).join(' '),
    });
    setKeysAgent(agent);
    setAuthDraft({
      llm_auth_mode: agent.llm_auth_mode || agent.gateway_config?.llm_auth_mode || 'byok',
      provider: agent.gateway_config?.provider || '',
      model: agent.gateway_config?.model || '',
    });
  };

  const closeKeysDialog = () => {
    setKeysAgent(null);
    setAuthDraft({ llm_auth_mode: 'byok', provider: '', model: '' });
    setGatewayPreview(null);
    setSpawnDraft(EMPTY_SPAWN_DRAFT);
    spawnHydratedRef.current = false;
  };

  const fetchGatewayPreview = useCallback(async (agentId, model, llmAuthMode) => {
    setGatewayPreviewLoading(true);
    try {
      const params = new URLSearchParams();
      if (model?.trim()) params.set('model', model.trim());
      if (llmAuthMode) params.set('llm_auth_mode', llmAuthMode);
      const qs = params.toString();
      const res = await fetch(`${getApiBase()}/api/v1/admin/agents/${agentId}/gateway-spawn-preview${qs ? `?${qs}` : ''}`, {
        headers: authHeaders,
      });
      const data = await res.json();
      setGatewayPreview(res.ok ? data : null);
    } catch {
      setGatewayPreview(null);
    } finally {
      setGatewayPreviewLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (!keysAgent || authDraft.llm_auth_mode !== 'gateway') {
      setGatewayPreview(null);
      return undefined;
    }
    fetchGatewayPreview(keysAgent.id, authDraft.model, authDraft.llm_auth_mode);
    return undefined;
  }, [keysAgent, authDraft.llm_auth_mode, authDraft.model, fetchGatewayPreview]);

  const gatewaySpawnFields = useMemo(
    () => getGatewaySpawnFieldDefs(keysAgent),
    [keysAgent],
  );

  useEffect(() => {
    if (!gatewayPreview || spawnHydratedRef.current) return;
    spawnHydratedRef.current = true;
    setSpawnDraft((prev) => ({
      OPENROUTER_API_KEY: prev.OPENROUTER_API_KEY
        || gatewayPreview.fields?.find((f) => f.key === 'OPENROUTER_API_KEY')?.value
        || gatewayPreview.defaults?.OPENROUTER_API_KEY
        || '',
      OPENROUTER_BASE_URL: prev.OPENROUTER_BASE_URL
        || gatewayPreview.fields?.find((f) => f.key === 'OPENROUTER_BASE_URL')?.value
        || gatewayPreview.defaults?.OPENROUTER_BASE_URL
        || '',
      launch_command: prev.launch_command || gatewayPreview.launch?.command_line || '',
    }));
  }, [gatewayPreview]);

  const buildEnvOverridesPayload = () => {
    const defaults = gatewayPreview?.defaults || {};
    const out = {};
    const apiKey = spawnDraft.OPENROUTER_API_KEY.trim();
    const baseUrl = spawnDraft.OPENROUTER_BASE_URL.trim();
    if (apiKey && apiKey !== (defaults.OPENROUTER_API_KEY || '').trim()) {
      out.OPENROUTER_API_KEY = apiKey;
    }
    if (baseUrl && baseUrl !== (defaults.OPENROUTER_BASE_URL || '').trim()) {
      out.OPENROUTER_BASE_URL = baseUrl;
    }
    return out;
  };

  const handleSaveKeys = async (e) => {
    e.preventDefault();
    if (!keysAgent) return;
    const mode = authDraft.llm_auth_mode;
    if (mode === 'gateway' && !authDraft.model?.trim()) {
      showToast('error', 'Select a model for gateway mode.');
      return;
    }
    const launchLine = spawnDraft.launch_command.trim();
    if (mode === 'gateway' && !launchLine) {
      showToast('error', 'Launch command is required.');
      return;
    }
    setSavingKeys(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/admin/gateway/agent-configs/${keysAgent.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          llm_auth_mode: mode,
          provider: mode === 'gateway' ? (authDraft.provider || undefined) : undefined,
          model: mode === 'gateway' ? authDraft.model.trim() : undefined,
          env_overrides: mode === 'gateway' ? buildEnvOverridesPayload() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (mode === 'gateway') {
        const parts = launchLine.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        const currentLine = [keysAgent.cmd, ...(keysAgent.args || [])].filter(Boolean).join(' ');
        if (launchLine !== currentLine) {
          const execRes = await fetch(`${getApiBase()}/api/v1/agents/${keysAgent.id}`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({ cmd, args }),
          });
          const execData = await execRes.json();
          if (!execRes.ok) throw new Error(execData.error);
        }
      }

      showToast('success', 'Agent configuration saved.');
      closeKeysDialog();
      fetchAgents({ silent: true });
    } catch (err) {
      showToast('error', err.message || 'Failed to save configuration.');
    } finally {
      setSavingKeys(false);
    }
  };

  const openEditDialog = (agent) => {
    setEditAgent(agent);
    setEditDraft({
      cmd: agent.cmd,
      args: agent.args.join(' '),
    });
  };

  const closeEditDialog = () => {
    setEditAgent(null);
    setEditDraft({ cmd: '', args: '' });
  };

  const handleSaveExecutable = async (e) => {
    e.preventDefault();
    if (!editAgent) return;
    const cmd = editDraft.cmd.trim();
    if (!cmd) {
      showToast('error', 'Command is required.');
      return;
    }
    const args = editDraft.args.trim() ? editDraft.args.trim().split(/\s+/) : [];
    setSavingExecutable(true);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/agents/${editAgent.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ cmd, args }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('success', 'Executable updated.');
      closeEditDialog();
      fetchAgents({ silent: true });
    } catch (err) {
      showToast('error', err.message || 'Failed to update executable.');
    } finally {
      setSavingExecutable(false);
    }
  };

  const runAgentAction = async (agentId, action, { agentName, method = 'POST', successMsg, onSuccess } = {}) => {
    const label = ACTION_PROGRESS_LABEL[action] || 'Processing';
    const name = agentName || agentId;
    const hint = ACTION_LOADING_HINT[action];
    showToast('loading', hint ? `${label} ${name}… ${hint}` : `${label} ${name}…`);
    setActionLoading(`${agentId}:${action}`);
    try {
      const res = await fetch(`${getApiBase()}/api/v1/admin/agents/${agentId}/${action}`, {
        method,
        headers: authHeaders,
        ...(method !== 'GET' ? { body: '{}' } : {}),
      });
      const data = await res.json();
      if (data.last_lifecycle) {
        setAgents((prev) => {
          const next = patchAgentLifecycle(prev, agentId, data.last_lifecycle);
          saveAdminAgentsCache(next);
          return next;
        });
      }
      if (!res.ok) throw new Error(data.error);
      if (onSuccess) onSuccess(data);
      else if (successMsg) showToast('success', successMsg);
      fetchAgents({ silent: true });
      return data;
    } catch (err) {
      showToast('error', err.message || 'Action failed.');
      return null;
    } finally {
      setActionLoading(null);
    }
  };

  const handleInstall = (agent) => runAgentAction(agent.id, 'install', {
    agentName: agent.name,
    onSuccess: (data) => showToast(
      'success',
      data.already_installed ? `${agent.name} is already installed.` : `${agent.name} installed.`,
    ),
  });

  const handleUninstall = async (agent) => {
    if (!window.confirm(`Uninstall ${agent.name} from this server?`)) return;
    await runAgentAction(agent.id, 'uninstall', {
      agentName: agent.name,
      onSuccess: (data) => showToast(
        'success',
        data.already_removed ? `${agent.name} is already removed.` : `${agent.name} uninstalled.`,
      ),
    });
  };

  const handleCheckAndUpdate = async (agent) => {
    setActionLoading(`${agent.id}:update`);
    try {
      const checkRes = await fetch(`${getApiBase()}/api/v1/admin/agents/${agent.id}/check-update`, {
        headers: authHeaders,
      });
      const check = await checkRes.json();
      if (!checkRes.ok) throw new Error(check.error);
      if (!check.installed) {
        showToast('error', `${agent.name} is not installed.`);
        return;
      }

      const shouldUpdate = check.update_available || !check.latest_version;
      if (!shouldUpdate) {
        showToast('success', `${agent.name} is up to date (${check.local_version}).`);
        return;
      }

      showToast('loading', `Updating ${agent.name}…`);
      const updateRes = await fetch(`${getApiBase()}/api/v1/admin/agents/${agent.id}/update`, {
        method: 'POST',
        headers: authHeaders,
        body: '{}',
      });
      const updated = await updateRes.json();
      if (updated.last_lifecycle) {
        setAgents((prev) => {
          const next = patchAgentLifecycle(prev, agent.id, updated.last_lifecycle);
          saveAdminAgentsCache(next);
          return next;
        });
      }
      if (!updateRes.ok) throw new Error(updated.error);

      const newVersion = updated.local_version || check.latest_version;
      if (check.update_available && check.local_version && newVersion) {
        showToast('success', `${agent.name} updated (${check.local_version} → ${newVersion}).`);
      } else {
        showToast('success', newVersion ? `${agent.name} updated to ${newVersion}.` : `${agent.name} updated.`);
      }
      fetchAgents({ silent: true });
    } catch (err) {
      showToast('error', err.message || 'Update failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const isActionLoading = (agentId, action) => actionLoading === `${agentId}:${action}`;

  const canSaveKeys = keysAgent && (
    authDraft.llm_auth_mode === 'gateway'
      ? Boolean(authDraft.model?.trim())
      : true
  );

  const providerOptions = useMemo(
    () => [
      { value: '', label: 'Any provider' },
      ...gatewayProviders.map((p) => ({ value: p.name, label: p.name })),
    ],
    [gatewayProviders],
  );

  const modelOptions = useMemo(() => {
    const selected = gatewayProviders.find((p) => p.name === authDraft.provider);
    const models = selected?.models?.length
      ? selected.models
      : gatewayProviders.flatMap((p) => p.models || []);
    const unique = [...new Set(models.filter(Boolean))];
    return unique.map((m) => ({ value: m, label: m }));
  }, [gatewayProviders, authDraft.provider]);

  return (
    <div className={`w-full ${consolePageStackClass}`}>
      <PageHeader
        title="Agents"
        description={
          refreshing
            ? 'Refreshing agent status…'
            : 'Install agents on the server, configure platform API keys, and manage the registry.'
        }
        actions={(
          <Button type="button" onClick={() => setDialogOpen(true)} size="md" className="shrink-0">
            <Plus className="w-4 h-4" />
            Add Agent
          </Button>
        )}
      />

      {dialogOpen && (
        <ConsoleDialogShell
          fitContent
          onClose={() => setDialogOpen(false)}
          panelClassName={`${consoleDialogAdminFormPanelClass} p-6`}
        >
              <h2 className="font-bold text-lg text-zinc-900 mb-4">Register new agent</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={`block mb-1 ${consoleSectionLabelClass}`}>ID</label>
                    <Input
                      required
                      value={newAgent.id}
                      onChange={(e) => setNewAgent({ ...newAgent, id: e.target.value })}
                      className="h-9 py-1.5"
                    />
                  </div>
                  <div>
                    <label className={`block mb-1 ${consoleSectionLabelClass}`}>Display name</label>
                    <Input
                      required
                      value={newAgent.name}
                      onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                      className="h-9 py-1.5"
                    />
                  </div>
                  <div>
                    <label className={`block mb-1 ${consoleSectionLabelClass}`}>Command</label>
                    <Input
                      required
                      value={newAgent.cmd}
                      onChange={(e) => setNewAgent({ ...newAgent, cmd: e.target.value })}
                      className="h-9 py-1.5"
                    />
                  </div>
                  <div>
                    <label className={`block mb-1 ${consoleSectionLabelClass}`}>Arguments (JSON)</label>
                    <Input
                      required
                      value={newAgent.args}
                      onChange={(e) => setNewAgent({ ...newAgent, args: e.target.value })}
                      className="h-9 py-1.5 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className={`block mb-1 ${consoleSectionLabelClass}`}>Required env (JSON)</label>
                    <Input
                      required
                      value={newAgent.env_required}
                      onChange={(e) => setNewAgent({ ...newAgent, env_required: e.target.value })}
                      className="h-9 py-1.5 font-mono"
                    />
                    <p className="mt-1 text-xs text-zinc-400">
                      Configure API keys on this page after registration.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="secondary" size="md" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="md">
                    Save
                  </Button>
                </div>
              </form>
        </ConsoleDialogShell>
      )}

      {editAgent && (
        <ConsoleDialogShell
          fitContent
          onClose={closeEditDialog}
          panelClassName={`${consoleDialogAdminFormPanelClass} p-6`}
        >
          <h2 className="font-bold text-lg text-zinc-900 mb-1">Executable — {editAgent.name}</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Command and arguments used when launching this agent.
          </p>
          <form onSubmit={handleSaveExecutable} className="space-y-4">
            <div>
              <label className={`block mb-1 ${consoleSectionLabelClass}`}>Command</label>
              <Input
                required
                value={editDraft.cmd}
                onChange={(e) => setEditDraft({ ...editDraft, cmd: e.target.value })}
                className="h-9 py-1.5 font-mono"
                placeholder="claude"
              />
            </div>
            <div>
              <label className={`block mb-1 ${consoleSectionLabelClass}`}>Arguments</label>
              <Input
                value={editDraft.args}
                onChange={(e) => setEditDraft({ ...editDraft, args: e.target.value })}
                className="h-9 py-1.5 font-mono"
                placeholder="--not-interactive"
              />
              <p className="mt-1 text-xs text-zinc-400">Space-separated. Leave empty if none.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" size="md" onClick={closeEditDialog}>
                Cancel
              </Button>
              <Button type="submit" size="md" disabled={savingExecutable}>
                {savingExecutable ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        </ConsoleDialogShell>
      )}

      {keysAgent && (
        <ConsoleDialogShell
          fitContent
          onClose={closeKeysDialog}
          panelClassName={`${consoleDialogAdminFormPanelClass} p-6`}
        >
              <h2 className="font-bold text-lg text-zinc-900 mb-1">
                Configure — {keysAgent.name}
              </h2>
              <p className="text-sm text-zinc-500 mb-4">
                Choose BYOK (users enter keys in Settings → BYOK) or Gateway (shared router + model).
              </p>
              <form onSubmit={handleSaveKeys} className="space-y-4">
                <div>
                  <label className={`block mb-1 ${consoleSectionLabelClass}`}>LLM auth</label>
                  <SelectMenu
                    value={authDraft.llm_auth_mode}
                    onChange={(v) => setAuthDraft((d) => ({
                      ...d,
                      llm_auth_mode: v,
                      provider: v === 'gateway' ? d.provider : '',
                      model: v === 'gateway' ? d.model : '',
                    }))}
                    options={[
                      { value: 'byok', label: 'BYOK' },
                      { value: 'gateway', label: 'Gateway' },
                    ]}
                  />
                </div>
                {authDraft.llm_auth_mode === 'gateway' && (
                  <>
                    <div>
                      <label className={`block mb-1 ${consoleSectionLabelClass}`}>Provider</label>
                      <SelectMenu
                        value={authDraft.provider}
                        onChange={(v) => setAuthDraft((d) => ({ ...d, provider: v, model: '' }))}
                        options={providerOptions}
                        placeholder="Any provider"
                      />
                    </div>
                    <div>
                      <label className={`block mb-1 ${consoleSectionLabelClass}`}>Model</label>
                      <SelectMenu
                        value={authDraft.model}
                        onChange={(v) => setAuthDraft((d) => ({ ...d, model: v }))}
                        options={modelOptions}
                        placeholder={modelOptions.length ? 'Select model…' : 'Add models in Settings → Gateway'}
                        disabled={modelOptions.length === 0}
                      />
                    </div>
                    <div className="space-y-4 border-t border-zinc-100 pt-4">
                      <p className={`${consoleSectionLabelClass}`}>Injected at session start</p>
                      {gatewayPreviewLoading && !gatewayPreview ? (
                        <p className="text-sm text-zinc-500">Loading defaults…</p>
                      ) : null}
                      {!gatewayPreviewLoading && gatewayPreview && !gatewayPreview.gateway_running && (
                        <p className="text-sm text-amber-700">
                          UniGateway is not running. Start it under Settings → Gateway.
                        </p>
                      )}
                      {(gatewaySpawnFields).map((field) => (
                        <div key={field.key}>
                          <label className={`block mb-1 ${consoleSectionLabelClass}`}>
                            {field.label || getSecretLabel(field.key)}
                          </label>
                          <Input
                            type={field.password || isSecretPasswordField(field.key) ? 'password' : 'text'}
                            value={spawnDraft[field.key] || ''}
                            onChange={(ev) => setSpawnDraft((d) => ({ ...d, [field.key]: ev.target.value }))}
                            className="h-9 py-1.5 font-mono"
                            placeholder={field.key === 'OPENROUTER_BASE_URL' ? 'http://127.0.0.1:8741/v1' : 'From Router API Key'}
                          />
                          <p className="mt-1 text-xs text-zinc-400">{field.source}</p>
                        </div>
                      ))}
                      <div>
                        <label className={`block mb-1 ${consoleSectionLabelClass}`}>Launch command</label>
                        <Input
                          value={spawnDraft.launch_command}
                          onChange={(ev) => setSpawnDraft((d) => ({ ...d, launch_command: ev.target.value }))}
                          className="h-9 py-1.5 font-mono"
                          placeholder="hermes chat --ignore-user-config --provider openrouter"
                        />
                        <p className="mt-1 text-xs text-zinc-400">Command and arguments used when launching this agent.</p>
                      </div>
                    </div>
                  </>
                )}
                {authDraft.llm_auth_mode === 'byok' && (
                  <p className="text-sm text-zinc-500">
                    Users configure their own API keys under Settings → BYOK before launching this agent.
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="secondary" size="md" onClick={closeKeysDialog}>
                    Cancel
                  </Button>
                  <Button type="submit" size="md" disabled={savingKeys || !canSaveKeys}>
                    {savingKeys ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </form>
        </ConsoleDialogShell>
      )}

      <div className={consoleTableShellClass}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-zinc-200 bg-white">
              <tr>
                <th className={`${consoleTableHeadCellClass}`}>Name / ID</th>
                <th className={`${consoleTableHeadCellClass}`}>Status</th>
                <th className={`${consoleTableHeadCellClass}`}>Version</th>
                <th className={`${consoleTableHeadCellClass}`}>Path</th>
                <th className={`${consoleTableHeadCellClass}`}>Executable</th>
                <th className={`${consoleTableHeadCellClass}`}>Auth</th>
                <th className={`${consoleTableHeadCellClass}`}>Model</th>
                <th className={`${consoleTableHeadCellClass}`}>Ready</th>
                <th className={`${consoleTableHeadCellClass}`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {loading && agents.length === 0 ? (
                <tr>
                  <td colSpan={9} className={`${consoleTableBodyCellClass} text-zinc-500`}>
                    Loading...
                  </td>
                </tr>
              ) : agents.length === 0 ? (
                <tr>
                  <td colSpan={9} className={`${consoleTableBodyCellClass} text-zinc-500`}>
                    No agents registered yet.
                  </td>
                </tr>
              ) : agents.map((agent) => {
                const isGateway = agent.llm_auth_mode === 'gateway';
                const executable = [agent.cmd, ...agent.args].filter(Boolean).join(' ');
                return (
                  <tr key={agent.id} className="hover:bg-zinc-50/50">
                    <td className={consoleTableBodyCellClass}>
                      <div className="font-medium text-zinc-900">{agent.name}</div>
                      <div className="font-mono text-xs text-zinc-400">{agent.id}</div>
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      <div className="space-y-1">
                        <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${statusBadge(agent.installed)}`}>
                          {agent.installed ? 'Installed' : 'Not installed'}
                        </span>
                        {agent.last_lifecycle && (
                          <p
                            className={`max-w-[12rem] truncate text-xs ${
                              agent.last_lifecycle.ok ? 'text-zinc-500' : 'text-red-600'
                            }`}
                            title={`${agent.last_lifecycle.message} (${formatLifecycleTime(agent.last_lifecycle.finished_at)})`}
                          >
                            {agent.last_lifecycle.ok
                              ? `${agent.last_lifecycle.action} OK · ${formatLifecycleTime(agent.last_lifecycle.finished_at)}`
                              : `${agent.last_lifecycle.action} failed · ${agent.last_lifecycle.message}`}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      {agent.local_version ? (
                        <span className="font-mono text-xs text-zinc-500">v{agent.local_version}</span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      {agent.executable_path ? (
                        <span
                          className="block max-w-[12rem] truncate font-mono text-xs text-zinc-500"
                          title={agent.executable_path}
                        >
                          {agent.executable_path_display || agent.executable_path}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      <span className="inline-flex max-w-[14rem] truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700" title={executable}>
                        {executable}
                      </span>
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      <span className="text-xs font-medium text-zinc-700 capitalize">
                        {isGateway ? 'Gateway' : 'BYOK'}
                      </span>
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      {isGateway && agent.gateway_config?.model ? (
                        <span className="font-mono text-xs text-zinc-700">{agent.gateway_config.model}</span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${
                        isGateway
                          ? (agent.keys_ready
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700')
                          : 'border-zinc-200 bg-zinc-50 text-zinc-600'
                      }`}
                      >
                        {isGateway
                          ? (agent.keys_ready ? 'Ready' : 'Needs model')
                          : 'User keys'}
                      </span>
                    </td>
                    <td className={consoleTableBodyCellClass}>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditDialog(agent)}
                          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                          title="Edit executable"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {!agent.installed ? (
                          <button
                            type="button"
                            disabled={isActionLoading(agent.id, 'install')}
                            onClick={() => handleInstall(agent)}
                            className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none"
                            title="Install on server"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={isActionLoading(agent.id, 'update')}
                              onClick={() => handleCheckAndUpdate(agent)}
                              className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 disabled:pointer-events-none"
                              title="Check and update"
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isActionLoading(agent.id, 'update') ? 'animate-spin' : ''}`} />
                            </button>
                            <button
                              type="button"
                              disabled={isActionLoading(agent.id, 'uninstall')}
                              onClick={() => handleUninstall(agent)}
                              className="p-1.5 rounded-md text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40 disabled:pointer-events-none"
                              title="Uninstall from server"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => openKeysDialog(agent)}
                          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                          title="Configure LLM auth"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
