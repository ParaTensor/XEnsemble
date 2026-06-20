import React, { useState, useEffect, useMemo, useContext } from 'react';
import { AuthContext } from '../../App';
import Button from '../Button';
import SelectMenu from '../SelectMenu';
import { useToast } from '../Toast';
import { consoleSectionLabelClass } from '../../lib/consoleTokens';
import { apiFetch } from '../../lib/api';
import SecretFields from './SecretFields';

export default function AgentSettingsPanel({ secretsState }) {
  
  const { showToast } = useToast();
  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const { secrets, setSecrets, loading, saving, saveSecrets } = secretsState;

  useEffect(() => {
    
    apiFetch('/api/v1/agents')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAgents(data);
          setSelectedAgentId((prev) => prev || data[0]?.id || '');
        }
      })
      .finally(() => setAgentsLoading(false));
  }, []);

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
    <div className="space-y-5">
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

      {loading || agentsLoading ? (
        <p className="text-sm text-zinc-500">Loading...</p>
      ) : !selectedAgent ? (
        <p className="text-sm text-zinc-500">Select an agent.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-zinc-500">
            Your personal API keys for this agent. Stored encrypted in your vault and used when the platform is in bring-your-own-key mode.
          </p>
          <SecretFields
            keys={requiredKeys}
            secrets={secrets}
            savedHints={savedHints}
            mono
            onChange={(key, value) => setSecrets((prev) => ({ ...prev, [key]: value }))}
          />
          {requiredKeys.length > 0 && (
            <div className="pt-2 flex justify-end">
              <Button type="submit" disabled={saving || !canSave} size="md">
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
