import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
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

const API = 'http://localhost:3000';

function statusBadge(installed) {
  return installed
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-amber-50 text-amber-700 border-amber-200';
}

export default function AgentsAdmin() {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const [agents, setAgents] = useState([]);
  const [gatewayProviders, setGatewayProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keysAgent, setKeysAgent] = useState(null);
  const [authDraft, setAuthDraft] = useState({ llm_auth_mode: 'byok', provider: '', model: '' });
  const [savingKeys, setSavingKeys] = useState(false);
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

  const fetchAgents = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/v1/admin/agents`, { headers: authHeaders })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setAgents(data);
      })
      .finally(() => setLoading(false));
  }, [authHeaders]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/api/v1/admin/gateway/providers`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setGatewayProviders(data?.data || []))
      .catch(() => {});
  }, [token, authHeaders]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const parsedArgs = JSON.parse(newAgent.args);
      const parsedEnv = JSON.parse(newAgent.env_required);

      const res = await fetch(`${API}/api/v1/agents`, {
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
      fetchAgents();
    } catch (err) {
      showToast('error', err.message || 'Invalid JSON in Args or Env Required');
    }
  };

  const openKeysDialog = (agent) => {
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
  };

  const handleSaveKeys = async (e) => {
    e.preventDefault();
    if (!keysAgent) return;
    const mode = authDraft.llm_auth_mode;
    if (mode === 'gateway' && !authDraft.model?.trim()) {
      showToast('error', 'Select a model for gateway mode.');
      return;
    }
    setSavingKeys(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/gateway/agent-configs/${keysAgent.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          llm_auth_mode: mode,
          provider: mode === 'gateway' ? (authDraft.provider || undefined) : undefined,
          model: mode === 'gateway' ? authDraft.model.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('success', 'Agent configuration saved.');
      closeKeysDialog();
      fetchAgents();
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
      const res = await fetch(`${API}/api/v1/agents/${editAgent.id}`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ cmd, args }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast('success', 'Executable updated.');
      closeEditDialog();
      fetchAgents();
    } catch (err) {
      showToast('error', err.message || 'Failed to update executable.');
    } finally {
      setSavingExecutable(false);
    }
  };

  const runAgentAction = async (agentId, action, { method = 'POST', successMsg, onSuccess } = {}) => {
    setActionLoading(`${agentId}:${action}`);
    try {
      const res = await fetch(`${API}/api/v1/admin/agents/${agentId}/${action}`, {
        method,
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (onSuccess) onSuccess(data);
      else if (successMsg) showToast('success', successMsg);
      fetchAgents();
      return data;
    } catch (err) {
      showToast('error', err.message || 'Action failed.');
      return null;
    } finally {
      setActionLoading(null);
    }
  };

  const handleInstall = (agent) => runAgentAction(agent.id, 'install', {
    successMsg: 'Agent installed.',
    onSuccess: (data) => showToast('success', data.already_installed ? 'Already installed.' : 'Agent installed.'),
  });

  const handleUninstall = async (agent) => {
    if (!window.confirm(`Uninstall ${agent.name} from this server?`)) return;
    await runAgentAction(agent.id, 'uninstall', {
      onSuccess: (data) => showToast('success', data.already_removed ? 'Already removed.' : 'Agent uninstalled.'),
    });
  };

  const handleCheckAndUpdate = async (agent) => {
    setActionLoading(`${agent.id}:update`);
    try {
      const checkRes = await fetch(`${API}/api/v1/admin/agents/${agent.id}/check-update`, {
        headers: authHeaders,
      });
      const check = await checkRes.json();
      if (!checkRes.ok) throw new Error(check.error);
      if (!check.installed) {
        showToast('error', 'Agent is not installed.');
        return;
      }

      const shouldUpdate = check.update_available || !check.latest_version;
      if (!shouldUpdate) {
        showToast('success', `Up to date (${check.local_version})`);
        return;
      }

      const updateRes = await fetch(`${API}/api/v1/admin/agents/${agent.id}/update`, {
        method: 'POST',
        headers: authHeaders,
      });
      const updated = await updateRes.json();
      if (!updateRes.ok) throw new Error(updated.error);

      const newVersion = updated.local_version || check.latest_version;
      if (check.update_available && check.local_version && newVersion) {
        showToast('success', `Updated ${check.local_version} → ${newVersion}`);
      } else {
        showToast('success', newVersion ? `Updated to ${newVersion}` : 'Agent updated.');
      }
      fetchAgents();
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
        description="Install agents on the server, configure platform API keys, and manage the registry."
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
              {loading ? (
                <tr>
                  <td colSpan={9} className={`${consoleTableBodyCellClass} text-zinc-500`}>
                    Loading...
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
                      <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${statusBadge(agent.installed)}`}>
                        {agent.installed ? 'Installed' : 'Not installed'}
                      </span>
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
                            title={isActionLoading(agent.id, 'install') ? 'Installing...' : 'Install on server'}
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
                              title={isActionLoading(agent.id, 'update') ? 'Updating...' : 'Check and update'}
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
