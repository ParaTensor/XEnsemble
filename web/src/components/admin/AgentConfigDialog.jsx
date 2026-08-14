import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Button from '../Button';
import Input from '../Input';
import SelectMenu from '../SelectMenu';
import { ConsoleDialogShell } from '../ConsoleDialog';
import { useToast } from '../Toast';
import {
  consoleDialogAdminFormPanelClass,
  consoleSectionLabelClass,
} from '../../lib/consoleTokens';
import { isSecretPasswordField } from '../../lib/secretLabels';
import { apiFetch } from '../../lib/api';

const EMPTY_SPAWN_DRAFT = {
  envVars: [{ key: '', value: '' }],
  launch_command: '',
};

function SectionDivider({ children }) {
  return <div className="border-t border-zinc-100 pt-4">{children}</div>;
}

function SectionLabel({ children }) {
  return <p className={`${consoleSectionLabelClass} mb-2`}>{children}</p>;
}

export default function AgentConfigDialog({ agent, gatewayProviders, onClose, onSaved }) {
  const { showToast } = useToast();
  const [authDraft, setAuthDraft] = useState({ llm_auth_mode: 'byok', provider: '', model: '' });
  const [savingKeys, setSavingKeys] = useState(false);
  const [gatewayPreview, setGatewayPreview] = useState(null);
  const [gatewayPreviewLoading, setGatewayPreviewLoading] = useState(false);
  const [spawnDraft, setSpawnDraft] = useState(EMPTY_SPAWN_DRAFT);
  const spawnHydratedRef = useRef(false);
  const [vmResources, setVmResources] = useState({ disk_size_gb: '', cpus: '', memory_mib: '' });
  const [vmResourcesLoaded, setVmResourcesLoaded] = useState(false);
  const [savingVmResources, setSavingVmResources] = useState(false);

  useEffect(() => {
    if (!agent) return;

    spawnHydratedRef.current = false;
    const overrides = agent.gateway_config?.env_overrides || {};
    const envVars = Object.keys(overrides).length > 0
      ? Object.entries(overrides).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }];
    setSpawnDraft({
      envVars,
      launch_command: [agent.cmd, ...(agent.args || [])].filter(Boolean).join(' '),
    });
    setVmResources({ disk_size_gb: '', cpus: '', memory_mib: '' });
    setVmResourcesLoaded(false);
    apiFetch(`/api/v1/admin/agents/${agent.id}/vm-resources`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.vm_resources) {
          setVmResources({
            disk_size_gb: data.vm_resources.disk_size_gb != null ? String(data.vm_resources.disk_size_gb) : '',
            cpus: data.vm_resources.cpus != null ? String(data.vm_resources.cpus) : '',
            memory_mib: data.vm_resources.memory_mib != null ? String(data.vm_resources.memory_mib) : '',
          });
        }
        setVmResourcesLoaded(true);
      })
      .catch(() => setVmResourcesLoaded(true));
    setAuthDraft({
      llm_auth_mode: agent.llm_auth_mode || agent.gateway_config?.llm_auth_mode || 'byok',
      provider: agent.gateway_config?.provider || '',
      model: agent.gateway_config?.model || '',
    });
  }, [agent]);

  const fetchGatewayPreview = useCallback(async (agentId, model, llmAuthMode) => {
    setGatewayPreviewLoading(true);
    try {
      const params = new URLSearchParams();
      if (model?.trim()) params.set('model', model.trim());
      if (llmAuthMode) params.set('llm_auth_mode', llmAuthMode);
      const qs = params.toString();
      const res = await apiFetch(`/api/v1/admin/agents/${agentId}/gateway-spawn-preview${qs ? `?${qs}` : ''}`);
      const data = await res.json();
      setGatewayPreview(res.ok ? data : null);
    } catch {
      setGatewayPreview(null);
    } finally {
      setGatewayPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!agent || authDraft.llm_auth_mode !== 'gateway') {
      setGatewayPreview(null);
      return undefined;
    }
    fetchGatewayPreview(agent.id, authDraft.model, authDraft.llm_auth_mode);
    return undefined;
  }, [agent, authDraft.llm_auth_mode, authDraft.model, fetchGatewayPreview]);

  useEffect(() => {
    if (!gatewayPreview || spawnHydratedRef.current) return;
    spawnHydratedRef.current = true;
    setSpawnDraft((prev) => ({
      ...prev,
      launch_command: prev.launch_command || gatewayPreview.launch?.command_line || '',
    }));
  }, [gatewayPreview]);

  useEffect(() => {
    if (gatewayProviders.length === 0) return;
    setAuthDraft((d) => {
      if (d.llm_auth_mode === 'gateway' && !d.provider) {
        return { ...d, provider: gatewayProviders[0].name };
      }
      return d;
    });
  }, [gatewayProviders]);

  const buildEnvOverridesPayload = () => {
    const out = {};
    for (const { key, value } of spawnDraft.envVars) {
      const k = (key || '').trim();
      if (!k) continue;
      out[k] = (value || '').trim();
    }
    return out;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!agent) return;
    const mode = authDraft.llm_auth_mode;
    if (mode === 'gateway' && !authDraft.provider?.trim()) {
      showToast('error', 'Select a provider for gateway mode.');
      return;
    }
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
      const res = await apiFetch(`/api/v1/admin/gateway/agent-configs/${agent.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          llm_auth_mode: mode,
          provider: mode === 'gateway' ? (authDraft.provider || undefined) : undefined,
          model: mode === 'gateway' ? authDraft.model.trim() : undefined,
          env_overrides: buildEnvOverridesPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (mode === 'gateway') {
        const parts = launchLine.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        const currentLine = [agent.cmd, ...(agent.args || [])].filter(Boolean).join(' ');
        if (launchLine !== currentLine) {
          const execRes = await apiFetch(`/api/v1/agents/${agent.id}`, {
            method: 'PUT',
            body: JSON.stringify({ cmd, args }),
          });
          const execData = await execRes.json();
          if (!execRes.ok) throw new Error(execData.error);
        }
      }

      if (data.warning) {
        showToast('warning', data.warning, { durationMs: 12000 });
      } else {
        showToast('success', 'Agent configuration saved.');
      }
      const diskGb = vmResources.disk_size_gb.trim();
      const cpus = vmResources.cpus.trim();
      const memMb = vmResources.memory_mib.trim();
      if (diskGb || cpus || memMb) {
        try {
          setSavingVmResources(true);
          const body = {};
          if (diskGb) body.disk_size_gb = Number(diskGb);
          if (cpus) body.cpus = Number(cpus);
          if (memMb) body.memory_mib = Number(memMb);
          const vrRes = await apiFetch(`/api/v1/admin/agents/${agent.id}/vm-resources`, {
            method: 'PUT',
            body: JSON.stringify(body),
          });
          const vrData = await vrRes.json();
          if (!vrRes.ok) throw new Error(vrData.error);
          setSavingVmResources(false);
        } catch (err) {
          setSavingVmResources(false);
          showToast('error', 'VM resources saved, but: ' + (err.message || 'failed'));
        }
      }
      onClose();
      onSaved?.();
    } catch (err) {
      showToast('error', err.message || 'Failed to save configuration.');
    } finally {
      setSavingKeys(false);
    }
  };

  const canSave = agent && (
    authDraft.llm_auth_mode === 'gateway'
      ? Boolean(authDraft.model?.trim())
      : true
  );

  const providerOptions = useMemo(
    () => gatewayProviders.map((p) => ({ value: p.name, label: p.name })),
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

  if (!agent) return null;

  return (
    <ConsoleDialogShell
      fitContent
      onClose={onClose}
      panelClassName={`${consoleDialogAdminFormPanelClass} p-6`}
    >
      <h2 className="font-bold text-lg text-zinc-900 mb-1">
        Configure - {agent.name}
      </h2>
      <p className="text-sm text-zinc-500 mb-4">
        Choose BYOK (users enter keys in Settings - API Keys) or Gateway (shared router + model).
      </p>
      <form onSubmit={handleSave} className="space-y-4">
        {/* Section: LLM Auth */}
        <div>
          <label className={`block mb-1 ${consoleSectionLabelClass}`}>LLM auth</label>
          <SelectMenu
            value={authDraft.llm_auth_mode}
            onChange={(v) => setAuthDraft((d) => ({
              ...d,
              llm_auth_mode: v,
              provider: v === 'gateway' ? (d.provider || gatewayProviders[0]?.name || '') : '',
              model: v === 'gateway' ? d.model : '',
            }))}
            options={[
              { value: 'byok', label: 'BYOK' },
              { value: 'gateway', label: 'Gateway' },
            ]}
          />
        </div>

        {/* Section: Gateway config (conditional) */}
        {authDraft.llm_auth_mode === 'gateway' && (
          <SectionDivider>
            <div className="space-y-3">
              <SectionLabel>Gateway</SectionLabel>
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
                  placeholder={modelOptions.length ? 'Select model...' : 'Add models in Settings - Gateway'}
                  disabled={modelOptions.length === 0}
                />
              </div>
              {gatewayPreviewLoading && !gatewayPreview && (
                <p className="text-sm text-zinc-500">Loading defaults...</p>
              )}
              {!gatewayPreviewLoading && gatewayPreview && !gatewayPreview.gateway_running && (
                <p className="text-sm text-amber-700">
                  UniGateway is not running. Start it under Settings - Gateway.
                </p>
              )}
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
          </SectionDivider>
        )}

        {/* Section: Environment variables */}
        <SectionDivider>
          <div className="space-y-3">
            <SectionLabel>Environment variables</SectionLabel>
            <p className="text-xs text-zinc-400">
              Injected at session start in both BYOK and Gateway modes. Highest priority, overrides all other env sources. Leave value empty to clear a key (e.g. ANTHROPIC_API_KEY) so lower-priority sources won't inject it.
            </p>
            {spawnDraft.envVars.map((pair, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <Input
                  value={pair.key}
                  onChange={(ev) => setSpawnDraft((d) => ({
                    ...d,
                    envVars: d.envVars.map((p, i) => i === idx ? { ...p, key: ev.target.value } : p),
                  }))}
                  className="h-9 py-1.5 font-mono text-xs flex-1 min-w-0 w-1/2"
                  placeholder="ENV_VAR_NAME"
                />
                <Input
                  type={isSecretPasswordField(pair.key) ? 'password' : 'text'}
                  value={pair.value}
                  onChange={(ev) => setSpawnDraft((d) => ({
                    ...d,
                    envVars: d.envVars.map((p, i) => i === idx ? { ...p, value: ev.target.value } : p),
                  }))}
                  className="h-9 py-1.5 font-mono text-xs flex-1 min-w-0 w-1/2"
                  placeholder="value"
                />
                <button
                  type="button"
                  onClick={() => setSpawnDraft((d) => ({
                    ...d,
                    envVars: d.envVars.filter((_, i) => i !== idx),
                  }))}
                  className="flex-shrink-0 text-zinc-400 hover:text-red-500"
                  title="Remove"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setSpawnDraft((d) => ({
                ...d,
                envVars: [...d.envVars, { key: '', value: '' }],
              }))}
              className="text-sm text-zinc-500 hover:text-zinc-700"
            >
              + Add env var
            </button>
          </div>
        </SectionDivider>

        {/* Section: BYOK hint (conditional) */}
        {authDraft.llm_auth_mode === 'byok' && (
          <p className="text-sm text-zinc-500">
            Users configure their own API keys in the Sessions page before launching this agent.
          </p>
        )}

        {/* Section: VM Resources */}
        <SectionDivider>
          <div className="space-y-3">
            <SectionLabel>VM Resources</SectionLabel>
            <p className="text-xs text-zinc-400">
              CPU / memory / disk limits for the sandbox VM. Leave empty to use system defaults.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Disk (GB)</label>
                <Input
                  type="number"
                  min="1"
                  value={vmResources.disk_size_gb}
                  onChange={(ev) => setVmResources((d) => ({ ...d, disk_size_gb: ev.target.value }))}
                  className="h-9 py-1.5"
                  placeholder="Default"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">CPUs</label>
                <Input
                  type="number"
                  min="1"
                  value={vmResources.cpus}
                  onChange={(ev) => setVmResources((d) => ({ ...d, cpus: ev.target.value }))}
                  className="h-9 py-1.5"
                  placeholder="Default"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Memory (MB)</label>
                <Input
                  type="number"
                  min="1"
                  value={vmResources.memory_mib}
                  onChange={(ev) => setVmResources((d) => ({ ...d, memory_mib: ev.target.value }))}
                  className="h-9 py-1.5"
                  placeholder="Default"
                />
              </div>
            </div>
          </div>
        </SectionDivider>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={savingKeys || !canSave}>
            {savingKeys ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </ConsoleDialogShell>
  );
}
