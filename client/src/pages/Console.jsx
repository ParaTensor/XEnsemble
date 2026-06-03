import React, { useState, useEffect, useContext } from 'react';
import AgentConsole from '../components/AgentConsole';
import { TerminalSquare, Play, Square, Settings2, History } from 'lucide-react';
import { AuthContext } from '../App';

export default function Console() {
  const { token } = useContext(AuthContext);
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/v1/agents')
      .then(res => res.json())
      .then(data => {
        setAgents(data);
        if (data.length > 0) setSelectedAgentId(data[0].id);
      })
      .catch(err => setError("Could not connect to backend server."));
    
    fetchSessions();
  }, []);

  const fetchSessions = () => {
    fetch('http://localhost:3000/api/v1/sessions', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if(Array.isArray(data)) setSessions(data);
      });
  };

  const handleStartSession = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('http://localhost:3000/api/v1/session/start', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ agent_id: selectedAgentId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      
      setActiveSession({ sessionId: data.session_id, agentName: agents.find(a=>a.id===selectedAgentId)?.name });
      fetchSessions();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <>
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 shrink-0">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-zinc-900">Active Session</h1>
          <p className="text-sm text-zinc-500 max-w-2xl">
            Run your enterprise agent in a restricted workspace jail. Output streams via local PTY bridge.
          </p>
        </div>
        <div className="flex flex-nowrap items-end justify-end gap-2 shrink-0 lg:ml-auto">
          {activeSession ? (
            <button 
              onClick={() => setActiveSession(null)}
              className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-medium border border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50"
            >
              <Square className="w-4 h-4" /> Disconnect View
            </button>
          ) : (
            <button 
              onClick={handleStartSession}
              disabled={isLoading || !selectedAgentId}
              className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-medium bg-black text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> {isLoading ? 'Starting...' : 'Launch Agent'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm font-medium">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">
        
        {/* Left Panel */}
        <div className="w-full lg:w-80 shrink-0 flex flex-col gap-6">
          <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-5 flex flex-col gap-5">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
              <Settings2 className="w-4 h-4 text-zinc-500" />
              <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">New Instance</h2>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">Target Agent</label>
              <select 
                className="w-full appearance-none bg-white border border-zinc-200 rounded-md px-3 py-2 text-sm focus:border-black focus:ring-1 focus:ring-black"
                value={selectedAgentId} 
                onChange={e => setSelectedAgentId(e.target.value)}
              >
                {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <p className="text-xs text-zinc-500 mt-2">
                Make sure required keys are saved in <a href="/settings" className="underline text-black">Settings</a> before launching.
              </p>
            </div>
          </div>

          <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-5 flex flex-col gap-3 flex-1 overflow-auto">
            <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 mb-1">
              <History className="w-4 h-4 text-zinc-500" />
              <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">Recent Sessions</h2>
            </div>
            {sessions.length === 0 ? (
              <p className="text-sm text-zinc-500">No recent sessions.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sessions.map(s => (
                  <button 
                    key={s.id} 
                    onClick={() => setActiveSession({ sessionId: s.id, agentName: s.agentId })}
                    className={`text-left p-3 rounded-md border text-sm ${activeSession?.sessionId === s.id ? 'border-black bg-zinc-50' : 'border-zinc-200 hover:border-zinc-300'}`}
                  >
                    <div className="font-medium text-zinc-900">{s.agentId}</div>
                    <div className="text-xs text-zinc-500 font-mono truncate">{s.id}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Terminal Panel */}
        <div className="flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col overflow-hidden">
          {activeSession ? (
            <AgentConsole sessionId={activeSession.sessionId} agentName={activeSession.agentName} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 p-8 text-center bg-zinc-50/50">
              <TerminalSquare className="w-12 h-12 mb-4 text-zinc-300" strokeWidth={1} />
              <h3 className="text-base font-medium text-zinc-900 mb-1">No Active Session</h3>
              <p className="text-sm">Select a recent session from the left or launch a new agent.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
