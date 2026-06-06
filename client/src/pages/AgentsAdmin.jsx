import React, { useState, useEffect, useContext } from 'react';
import { Plus } from 'lucide-react';
import { AuthContext } from '../App';
import Button from '../components/Button';
import Input from '../components/Input';
import PageHeader from '../components/PageHeader';
import { ConsoleDialogBackdrop, ConsoleDialogPanel } from '../components/ConsoleDialog';
import { useToast } from '../components/Toast';
import {
  consoleDialogMdClass,
  consolePageStackClass,
  consoleSectionLabelClass,
  consoleTableBodyCellClass,
  consoleTableHeadCellClass,
  consoleTableShellClass,
} from '../lib/consoleTokens';

export default function AgentsAdmin() {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();
  const [agents, setAgents] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newAgent, setNewAgent] = useState({
    id: '',
    name: '',
    cmd: '',
    args: '[]',
    env_required: '[]',
  });

  const fetchAgents = () => {
    fetch('http://localhost:3000/api/v1/agents', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setAgents(data));
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const parsedArgs = JSON.parse(newAgent.args);
      const parsedEnv = JSON.parse(newAgent.env_required);

      const res = await fetch('http://localhost:3000/api/v1/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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

  return (
    <div className={`w-full ${consolePageStackClass}`}>
      <PageHeader
        title="Agent Registry"
        description="Register tools and LLM agents in the database."
        actions={(
          <Button type="button" onClick={() => setDialogOpen(true)} size="md" className="shrink-0">
            <Plus className="w-4 h-4" />
            Add Agent
          </Button>
        )}
      />

      {dialogOpen && (
        <>
          <ConsoleDialogBackdrop className="z-[100]" onClick={() => setDialogOpen(false)} />
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
            <ConsoleDialogPanel className={`pointer-events-auto ${consoleDialogMdClass} max-h-[calc(100vh-2rem)] overflow-y-auto p-6`}>
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
                      Users configure these keys under Settings → Agents.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="secondary" size="md" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="md">
                    Save to registry
                  </Button>
                </div>
              </form>
            </ConsoleDialogPanel>
          </div>
        </>
      )}

      <div className={consoleTableShellClass}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="border-b border-zinc-200 bg-white">
              <tr>
                <th className={`${consoleTableHeadCellClass} w-1/4`}>Name / ID</th>
                <th className={`${consoleTableHeadCellClass} w-1/4`}>Executable</th>
                <th className={`${consoleTableHeadCellClass} w-1/2`}>Required variables</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {agents.map((agent) => (
                <tr key={agent.id} className="hover:bg-zinc-50/50">
                  <td className={consoleTableBodyCellClass}>
                    <div className="font-medium text-zinc-900">{agent.name}</div>
                    <div className="font-mono text-xs text-zinc-400">{agent.id}</div>
                  </td>
                  <td className={consoleTableBodyCellClass}>
                    <span className="inline-flex rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700">
                      {agent.cmd} {agent.args.join(' ')}
                    </span>
                  </td>
                  <td className={consoleTableBodyCellClass}>
                    <div className="flex flex-wrap gap-1">
                      {agent.env_required.length === 0 ? (
                        <span className="text-xs text-zinc-400">None</span>
                      ) : (
                        agent.env_required.map((env) => (
                          <span
                            key={env}
                            className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600"
                          >
                            {env}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
