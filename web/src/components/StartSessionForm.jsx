import { useMemo } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import SelectMenu from './SelectMenu';
import AgentConfigEditor from './AgentConfigEditor';
import {
  consoleInputClass,
  textPrimary,
  textPlaceholder,
  borderHairline,
  transitionBase,
  hoverBgSecondary,
  bgCanvas,
} from '../lib/consoleTheme.js';

function getAgentAuthHint(agent) {
  if (!agent) return null;
  if (agent.llm_auth_mode === 'gateway') {
    return { ok: Boolean(agent.gateway_model), detail: agent.gateway_model || 'Needs model' };
  }
  return { ok: null, detail: 'BYOK' };
}

function AgentCard({ agent, selected, onSelect, authHint, keysReady }) {
  const authOk = agent.llm_auth_mode === 'gateway' ? authHint?.ok : keysReady !== false;

  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className={`flex flex-col rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? 'border-[#202124] bg-[#FAFBFC] ring-1 ring-[#202124]'
          : 'border-[#E8EAED] bg-white hover:border-[#DADCE0] hover:bg-[#FAFBFC]'
      } ${transitionBase}`}
    >
      <span className="truncate text-sm font-medium text-[#202124]">{agent.name}</span>
      <span className={`mt-0.5 truncate text-xs ${authOk === false ? 'text-amber-600' : 'text-[#9AA0A6]'}`}>
        {agent.llm_auth_mode === 'gateway'
          ? (authHint?.ok ? `Gateway · ${authHint.detail}` : 'Gateway · needs model')
          : keysReady === false
            ? `BYOK · ${(agent.env_required || []).length} keys missing`
            : 'BYOK'}
      </span>
    </button>
  );
}

function SectionLabel({ children }) {
  return (
    <label className={`mb-1.5 block text-xs font-semibold uppercase tracking-wider ${textPlaceholder}`}>
      {children}
    </label>
  );
}

export default function StartSessionForm({
  workspaceSource,
  onWorkspaceSourceChange,
  projects,
  launchWorkspaceId,
  onLaunchWorkspaceIdChange,
  newProjectName,
  onNewProjectNameChange,
  agents,
  selectedAgentId,
  onSelectedAgentIdChange,
  selectedAgent,
  customImages,
  customImageId,
  onCustomImageIdChange,
  error,
  agentKeysReady,
  advancedOpen,
  onAdvancedOpenChange,
  configFiles,
  onConfigFilesChange,
  envVars,
  onEnvVarsChange,
  configLoading,
  configSaving,
  configError,
  onSaveConfig,
  onOpenImport,
  onLaunch,
  launching,
  authChecking,
}) {
  const authHint = useMemo(() => getAgentAuthHint(selectedAgent), [selectedAgent]);

  const filteredAgents = useMemo(() => {
    if (!customImageId) return agents;
    const img = customImages.find((c) => c.id === customImageId);
    if (!img) return agents;
    const agentComp = (img.components || []).find((c) => (c.component_id || '').startsWith('agent:'));
    if (!agentComp) return agents;
    const boundId = agentComp.component_id.replace('agent:', '');
    return agents.filter((a) => a.id === boundId);
  }, [agents, customImageId, customImages]);

  const authSummary = useMemo(() => {
    if (!selectedAgent) return null;
    if (selectedAgent.llm_auth_mode === 'gateway') {
      return authHint?.ok
        ? `Gateway · ${selectedAgent.gateway_model}`
        : 'Gateway · needs model';
    }
    if ((selectedAgent.env_required || []).length === 0) return 'BYOK · no keys required';
    return agentKeysReady ? 'BYOK · keys ready' : 'BYOK · keys missing';
  }, [selectedAgent, authHint, agentKeysReady]);

  const workspaceReady = workspaceSource === 'empty' || Boolean(launchWorkspaceId);
  const agentReady = Boolean(selectedAgentId) && (
    selectedAgent?.llm_auth_mode === 'gateway'
      ? Boolean(authHint?.ok)
      : agentKeysReady !== false
  );
  const busy = launching || authChecking;
  const canLaunch = workspaceReady && agentReady && !busy;

  const showAdvancedToggle = selectedAgent && (
    (selectedAgent.env_required || []).length > 0 || selectedAgent.config_schema
  );

  const workspaceSelectValue = workspaceSource === 'empty' ? '__new__' : launchWorkspaceId;

  const handleWorkspaceSelect = (value) => {
    if (value === '__new__') {
      onWorkspaceSourceChange('empty');
      onLaunchWorkspaceIdChange('');
      return;
    }
    onWorkspaceSourceChange('existing');
    onLaunchWorkspaceIdChange(value);
    const ws = projects.find((p) => p.id === value);
    if (ws) onNewProjectNameChange(ws.name);
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 pb-8">
      {error ? (
        <p className="rounded-md border border-[#FADBD8] bg-[#FDECEA] px-3 py-2 text-sm text-[#C06C5D]">
          {error}
        </p>
      ) : null}

      <section>
        <SectionLabel>Workspace</SectionLabel>
        {projects.length > 0 ? (
          <SelectMenu
            value={workspaceSelectValue}
            onChange={handleWorkspaceSelect}
            options={[
              ...projects.map((p) => ({ value: p.id, label: p.name })),
              { value: '__new__', label: 'New workspace…' },
            ]}
            placeholder="Select workspace"
          />
        ) : null}
        {(projects.length === 0 || workspaceSource === 'empty') ? (
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => onNewProjectNameChange(e.target.value)}
            placeholder="Optional — auto-generated if empty"
            className={`${consoleInputClass}${projects.length > 0 ? ' mt-2' : ''}`}
            autoFocus={projects.length === 0}
          />
        ) : null}
        {onOpenImport ? (
          <button
            type="button"
            onClick={onOpenImport}
            className={`mt-2 text-xs font-medium text-[#1967D2] hover:text-[#174EA6] ${transitionBase}`}
          >
            Import from Git instead
          </button>
        ) : null}
      </section>

      <section>
        <SectionLabel>Coding agent</SectionLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={selectedAgentId === agent.id}
              onSelect={onSelectedAgentIdChange}
              authHint={getAgentAuthHint(agent)}
              keysReady={
                agent.llm_auth_mode === 'gateway' || (agent.env_required || []).length === 0
                  ? true
                  : agent.id === selectedAgentId
                    ? agentKeysReady
                    : null
              }
            />
          ))}
        </div>
      </section>

      {customImages.length > 0 ? (
        <section>
          <SectionLabel>Runtime image</SectionLabel>
          <SelectMenu
            value={customImageId ? 'custom' : ''}
            onChange={(v) => {
              if (v === 'custom') {
                const first = customImages[0];
                onCustomImageIdChange(first?.id || '');
                const agentComp = (first?.components || []).find((c) => (c.component_id || '').startsWith('agent:'));
                const agentId = agentComp ? agentComp.component_id.replace('agent:', '') : '';
                if (agentId && agents.find((a) => a.id === agentId)) {
                  onSelectedAgentIdChange(agentId);
                }
              } else {
                onCustomImageIdChange('');
              }
            }}
            options={[
              { value: '', label: 'Built-in (recommended)' },
              { value: 'custom', label: 'Custom image' },
            ]}
            placeholder="Built-in (recommended)"
          />
          {customImageId ? (
            <div className="mt-2">
              <SelectMenu
                value={customImageId}
                onChange={(v) => {
                  onCustomImageIdChange(v);
                  const img = customImages.find((c) => c.id === v);
                  if (img) {
                    const agentComp = (img.components || []).find((c) => (c.component_id || '').startsWith('agent:'));
                    const agentId = agentComp ? agentComp.component_id.replace('agent:', '') : '';
                    if (agentId && agents.find((a) => a.id === agentId)) {
                      onSelectedAgentIdChange(agentId);
                    }
                  }
                }}
                options={customImages.map((img) => ({ value: img.id, label: img.name }))}
                placeholder="Select image"
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedAgent && authSummary ? (
        <section className="rounded-lg border border-[#E8EAED] bg-[#FAFBFC] px-4 py-3">
          <SectionLabel>Authentication</SectionLabel>
          <p className={`-mt-1 text-sm ${textPrimary}`}>{authSummary}</p>
        </section>
      ) : null}

      {showAdvancedToggle ? (
        <section className="rounded-lg border border-[#E8EAED]">
          <button
            type="button"
            onClick={() => onAdvancedOpenChange(!advancedOpen)}
            className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium ${textPrimary} hover:bg-[#FAFBFC] ${transitionBase}`}
          >
            <span>Advanced settings</span>
            <ChevronDown className={`h-4 w-4 text-[#9AA0A6] transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>
          {advancedOpen ? (
            <div className="space-y-4 border-t border-[#E8EAED] px-4 py-4">
              {configError ? (
                <p className="rounded-md border border-[#FADBD8] bg-[#FDECEA] px-3 py-2 text-sm text-[#C06C5D]">
                  {configError}
                </p>
              ) : null}
              <AgentConfigEditor
                configSchema={selectedAgent?.config_schema || null}
                configFiles={configFiles}
                envVars={envVars}
                onConfigFilesChange={onConfigFilesChange}
                onEnvVarsChange={onEnvVarsChange}
                loading={configLoading}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={configSaving || configLoading}
                  onClick={onSaveConfig}
                  className={`h-9 rounded-md border px-4 text-sm font-medium ${bgCanvas} ${borderHairline} ${textPrimary} ${hoverBgSecondary} disabled:opacity-50 ${transitionBase}`}
                >
                  {configSaving ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </span>
                  ) : 'Save keys'}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={!canLaunch}
          onClick={onLaunch}
          className={`flex h-10 items-center justify-center gap-2 rounded-md bg-[#202124] px-5 text-sm font-medium text-white hover:bg-[#3C4043] disabled:opacity-50 ${transitionBase}`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Starting…' : 'Start session'}
        </button>
      </div>
    </div>
  );
}
