import React, { useState, useEffect } from 'react';
import AgentConsole from './components/AgentConsole';

function App() {
  const [agents, setAgents] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [envConfigs, setEnvConfigs] = useState({});
  const [activeSession, setActiveSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch agents on load
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
    <div className="app-container">
      {/* Left Panel: Configuration */}
      <div className="bento-panel control-panel">
        <div className="header">
          <h1>Emdash Console</h1>
          <p>Enterprise Agent Orchestration</p>
        </div>

        {error && (
          <div style={{ color: '#ff3b30', fontSize: '0.85rem', marginBottom: '16px', padding: '12px', background: 'rgba(255, 59, 48, 0.1)', borderRadius: '8px' }}>
            {error}
          </div>
        )}

        <div className="form-group">
          <label>Select Agent</label>
          <select 
            className="select-input"
            value={selectedAgentId} 
            onChange={e => setSelectedAgentId(e.target.value)}
            disabled={activeSession !== null || isLoading}
          >
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </div>

        {selectedAgent && selectedAgent.env_required.length > 0 && (
          <div className="form-group">
            <label>Environment Variables</label>
            <div className="env-inputs">
              {selectedAgent.env_required.map(env => (
                <div className="env-row" key={env}>
                  <span className="env-label">{env}</span>
                  <input 
                    type={env.includes('KEY') || env.includes('TOKEN') ? 'password' : 'text'}
                    className="text-input"
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

        {activeSession ? (
          <button 
            className="btn-primary" 
            style={{ backgroundColor: '#ff3b30' }}
            onClick={() => {
              // MVP simply unmounts, actual backend termination would require another API call
              setActiveSession(null);
            }}
          >
            Stop Session
          </button>
        ) : (
          <button 
            className="btn-primary" 
            onClick={handleStartSession}
            disabled={isLoading || !selectedAgentId || (selectedAgent?.env_required.some(env => !envConfigs[env]))}
          >
            {isLoading ? 'Starting...' : 'Launch Agent'}
          </button>
        )}
      </div>

      {/* Right Panel: Terminal */}
      <div className="bento-panel terminal-panel">
        {activeSession ? (
          <AgentConsole 
            sessionId={activeSession.sessionId} 
            agentName={activeSession.agentName} 
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">⌘</div>
            <h3>No Active Session</h3>
            <p>Configure and launch an agent to start the terminal</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
