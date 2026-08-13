import { useState } from 'react';
import Button from '../Button';
import Input from '../Input';
import {
  ConsoleDialogShell,
} from '../ConsoleDialog';
import { useToast } from '../Toast';
import {
  consoleDialogAdminFormPanelClass,
  consoleSectionLabelClass,
} from '../../lib/consoleTheme';
import { apiFetch } from '../../lib/api';

const EMPTY_AGENT = { id: '', name: '', cmd: '', args: '[]', env_required: '[]' };

export default function AgentRegisterDialog({ open, onClose, onRegistered }) {
  const { showToast } = useToast();
  const [newAgent, setNewAgent] = useState(EMPTY_AGENT);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const parsedArgs = JSON.parse(newAgent.args);
      const parsedEnv = JSON.parse(newAgent.env_required);

      const res = await apiFetch('/api/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          ...newAgent,
          args: parsedArgs,
          env_required: parsedEnv,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast('success', 'Agent registered.');
      setNewAgent(EMPTY_AGENT);
      onClose();
      onRegistered?.();
    } catch (err) {
      showToast('error', err.message || 'Invalid JSON in Args or Env Required');
    }
  };

  if (!open) return null;

  return (
    <ConsoleDialogShell
      fitContent
      onClose={onClose}
      panelClassName={`${consoleDialogAdminFormPanelClass} p-6`}
    >
      <h2 className="font-bold text-lg text-zinc-900 mb-4">Register new agent</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className={`block mb-1 ${consoleSectionLabelClass}`}>ID</label>
            <Input
              required
              autoFocus
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
          <div>
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
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="md">
            Save
          </Button>
        </div>
      </form>
    </ConsoleDialogShell>
  );
}
