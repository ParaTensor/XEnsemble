import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../App';
import { Database, Plus } from 'lucide-react';

export default function AgentsAdmin() {
  const { token } = useContext(AuthContext);
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  
  const [newAgent, setNewAgent] = useState({
    id: '', name: '', cmd: '', args: '[]', env_required: '[]'
  });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchAgents = () => {
    fetch('http://localhost:3000/api/v1/agents')
      .then(res => res.json())
      .then(data => setAgents(data));
  };

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const parsedArgs = JSON.parse(newAgent.args);
      const parsedEnv = JSON.parse(newAgent.env_required);

      const res = await fetch('http://localhost:3000/api/v1/agents', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...newAgent,
          args: parsedArgs,
          env_required: parsedEnv
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setSuccess('Agent successfully registered!');
      setShowForm(false);
      setNewAgent({ id: '', name: '', cmd: '', args: '[]', env_required: '[]' });
      fetchAgents();
    } catch (err) {
      setError(err.message || 'Invalid JSON format in Args or Env Required');
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Agent Registry (Admin)</h1>
          <p className="text-sm text-zinc-500">Dynamically register new tools or LLM agents to the database.</p>
        </div>
        <button 
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 h-9 px-4 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800"
        >
          <Plus className="w-4 h-4" /> Add Agent
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">{error}</div>}
      {success && <div className="mb-4 p-3 bg-green-50 text-green-700 border border-green-200 rounded-md text-sm">{success}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-zinc-200 rounded-lg p-5 mb-6 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider mb-2">Register New Agent</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">ID (e.g., custom-claude)</label>
              <input required value={newAgent.id} onChange={e => setNewAgent({...newAgent, id: e.target.value})} className="w-full h-9 px-3 border border-zinc-200 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">Display Name</label>
              <input required value={newAgent.name} onChange={e => setNewAgent({...newAgent, name: e.target.value})} className="w-full h-9 px-3 border border-zinc-200 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">Command (CLI Executable)</label>
              <input required value={newAgent.cmd} onChange={e => setNewAgent({...newAgent, cmd: e.target.value})} className="w-full h-9 px-3 border border-zinc-200 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">Arguments (JSON Array)</label>
              <input required value={newAgent.args} onChange={e => setNewAgent({...newAgent, args: e.target.value})} className="w-full h-9 px-3 border border-zinc-200 rounded-md text-sm font-mono" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-500 mb-1">Required Env Variables (JSON Array)</label>
              <input required value={newAgent.env_required} onChange={e => setNewAgent({...newAgent, env_required: e.target.value})} className="w-full h-9 px-3 border border-zinc-200 rounded-md text-sm font-mono" />
              <p className="text-xs text-zinc-400 mt-1">Users will need to have these keys in their Vault to launch this agent.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" onClick={() => setShowForm(false)} className="h-9 px-4 rounded-md text-sm font-medium border border-zinc-200 hover:bg-zinc-50">Cancel</button>
            <button type="submit" className="h-9 px-4 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800">Save to Registry</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 flex items-center gap-2">
          <Database className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900">Active Registry</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold w-1/4">Name / ID</th>
                <th className="px-4 py-3 font-semibold w-1/4">Executable</th>
                <th className="px-4 py-3 font-semibold w-1/2">Required Variables</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {agents.map(agent => (
                <tr key={agent.id} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">{agent.name}</div>
                    <div className="text-xs text-zinc-400">{agent.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded inline-flex text-xs">
                      {agent.cmd} {agent.args.join(' ')}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {agent.env_required.length === 0 ? <span className="text-zinc-400 text-xs">None</span> : 
                        agent.env_required.map(env => (
                          <span key={env} className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-200 rounded text-xs text-zinc-600 font-mono">
                            {env}
                          </span>
                        ))
                      }
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
