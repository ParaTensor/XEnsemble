import React, { useState, useEffect, useMemo, useContext } from 'react';
import { AuthContext } from '../../App';
import Button from '../Button';
import SelectMenu from '../SelectMenu';
import { useToast } from '../Toast';
import { consoleSectionLabelClass } from '../../lib/consoleTokens';
import SecretFields from './SecretFields';

export default function AgentSettingsPanel({ secretsState }) {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const { secrets, setSecrets, loading, saving, saveSecrets } = secretsState;

  useEffect(() => {
    if (!token) return;
    fetch('http://localhost:3000/api/v1/agents', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(data);
          setSelectedAgentId((prev) => prev || data[0]?.id || '');
        }
      })
      .finally(() => setAgentsLoading(false));
  }, [token]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const requiredKeys = selectedAgent?.env_required || [];
  const agentOptions = agents.map((a) => ({ value: a.id, label: a.name }));

  const savedHints = useMemo(() => {
    const hints = {};
    requiredKeys.forEach((k) => {
      if (secrets[k]) hints[k] = true;
    });
    return hints;
  }, [secrets, requiredKeys]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAgent) return;
    const payload = {};
    requiredKeys.forEach((k) => {
      const v = secrets[k]?.trim();
      if (v) payload[k] = v;
    });
    const missing = requiredKeys.filter((k) => !payload[k] && !savedHints[k]);
    if (missing.length > 0) {
      showToast('error', 'Fill in all required keys before saving.');
      return;
    }
    await saveSecrets(payload, { successMessage: 'API keys saved.' });
  };

  const canSave =
    requiredKeys.length === 0
    || requiredKeys.every((k) => (secrets[k]?.trim() || savedHints[k]));

  return (
    <div className="h-full flex flex-col gap-5">
      <div>
        <label className={`block mb-1 ${consoleSectionLabelClass}`}>Agent</label>
        {agentsLoading ? (
          <p className="text-sm text-zinc-500 h-9 flex items-center">Loading agents...</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-zinc-500">No agents available.</p>
        ) : (
          <SelectMenu
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            placeholder="Select agent"
            options={agentOptions}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {loading || agentsLoading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : !selectedAgent ? (
          <p className="text-sm text-zinc-500">Select an agent.</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
            <p className="text-sm text-zinc-500 mb-4 shrink-0">
              API keys required to launch this agent. Stored encrypted in your vault.
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <SecretFields
                keys={requiredKeys}
                secrets={secrets}
                savedHints={savedHints}
                mono
                onChange={(key, value) => setSecrets((prev) => ({ ...prev, [key]: value }))}
              />
            </div>
            {requiredKeys.length > 0 && (
              <div className="pt-6 flex justify-end shrink-0">
                <Button type="submit" disabled={saving || !canSave} size="md">
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
