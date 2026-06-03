import React, { useState, useEffect } from 'react';
import AgentConsole from './components/AgentConsole';
import { TerminalSquare, Play, Square, Settings2 } from 'lucide-react';

function App() {
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [envConfigs, setEnvConfigs] = useState({});
  const [activeSession, setActiveSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/v1/agents')
      .then(res => res.json())
      .then(data => {
        setAgents(data);
        if (data.length > 0) {
          setSelectedAgentId(data[0].id);
        }
      })
      .catch(err => {
        console.error("Failed to fetch agents:", err);
        setError("Could not connect to backend server. Ensure it's running on port 3000.");
      });
  }, []);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const handleEnvChange = (key, value) => {
    setEnvConfigs(prev => ({ ...prev, [key]: value }));
  };

  const handleStartSession = async () => {
    if (!selectedAgent) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('http://localhost:3000/api/v1/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: selectedAgent.id,
          configs: envConfigs
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to start session');
      }
      
      setActiveSession({
        sessionId: data.session_id,
        agentName: selectedAgent.name
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col font-sans">
      {/* Navbar / Shell header */}
      <header className="flex-none bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900">
          <TerminalSquare className="w-5 h-5" />
          <span className="font-bold text-lg tracking-tight">Agent Console</span>
        </div>
        <nav className="text-sm font-medium text-zinc-500 flex gap-6">
          <a href="#" className="text-zinc-900 hover:text-black">Sessions</a>
          <a href="#" className="hover:text-black">Models</a>
          <a href="#" className="hover:text-black">Settings</a>
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden p-8 flex flex-col max-w-[1600px] w-full mx-auto gap-6">
        
        {/* Page Header (Console Style) */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 shrink-0">
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-zinc-900">Active Session</h1>
            <p className="text-sm text-zinc-500 max-w-2xl">
              Configure environment variables and run your enterprise agent directly from the browser. 
              Output streams via local PTY bridge.
            </p>
          </div>
          
          {/* Toolbar area */}
          <div className="flex flex-nowrap items-end justify-end gap-2 shrink-0 lg:ml-auto">
            {activeSession ? (
              <button 
                onClick={() => setActiveSession(null)}
                className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-medium border border-zinc-300 text-zinc-700 bg-white hover:bg-zinc-50 transition-colors duration-150"
              >
                <Square className="w-4 h-4" />
                Terminate Process
              </button>
            ) : (
              <button 
                onClick={handleStartSession}
                disabled={isLoading || !selectedAgentId || (selectedAgent?.env_required.some(env => !envConfigs[env]))}
                className="flex items-center gap-2 h-9 px-4 rounded-md text-sm font-medium bg-black text-white hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
              >
                <Play className="w-4 h-4" />
                {isLoading ? 'Starting...' : 'Launch Agent'}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="shrink-0 p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm font-medium flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 shrink-0"></div>
            {error}
          </div>
        )}

        {/* Split layout */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">
          
          {/* Configuration Panel */}
          <div className="w-full lg:w-80 shrink-0 flex flex-col gap-6">
            <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-5 flex flex-col gap-5">
              
              <div className="flex items-center gap-2 border-b border-zinc-100 pb-3 mb-1">
                <Settings2 className="w-4 h-4 text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">Configuration</h2>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Target Agent
                </label>
                <div className="relative">
                  <select 
                    className="w-full appearance-none bg-white border border-zinc-200 rounded-md px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:border-black focus:ring-1 focus:ring-black disabled:bg-zinc-50 disabled:text-zinc-500 transition-shadow duration-150"
                    value={selectedAgentId} 
                    onChange={e => setSelectedAgentId(e.target.value)}
                    disabled={activeSession !== null || isLoading}
                  >
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                  {/* Custom arrow for select */}
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                  </div>
                </div>
              </div>

              {selectedAgent && selectedAgent.env_required.length > 0 && (
                <div className="space-y-4">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Environment Variables
                  </label>
                  <div className="space-y-3">
                    {selectedAgent.env_required.map(env => (
                      <div key={env} className="space-y-1.5">
                        <label className="block text-xs font-mono text-zinc-600 truncate" title={env}>
                          {env}
                        </label>
                        <input 
                          type={env.includes('KEY') || env.includes('TOKEN') ? 'password' : 'text'}
                          className="w-full bg-white border border-zinc-200 rounded-md px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:border-black focus:ring-1 focus:ring-black disabled:bg-zinc-50 transition-shadow duration-150 font-mono"
                          placeholder={`Enter ${env}`}
                          value={envConfigs[env] || ''}
                          onChange={e => handleEnvChange(env, e.target.value)}
                          disabled={activeSession !== null || isLoading}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Terminal Panel */}
          <div className="flex-1 min-w-0 bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col overflow-hidden">
            {activeSession ? (
              <AgentConsole 
                sessionId={activeSession.sessionId} 
                agentName={activeSession.agentName} 
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 p-8 text-center bg-zinc-50/50">
                <TerminalSquare className="w-12 h-12 mb-4 text-zinc-300" strokeWidth={1} />
                <h3 className="text-base font-medium text-zinc-900 mb-1">No Active Session</h3>
                <p className="text-sm">Configure environment variables and launch the agent to view terminal output.</p>
              </div>
            )}
          </div>
          
        </div>
      </main>
    </div>
  );
}

export default App;
