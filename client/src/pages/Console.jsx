import React, { useState, useEffect, useContext } from 'react';
import AgentConsole from '../components/AgentConsole';
import { TerminalSquare, Play, Square, Settings2, History, FolderOpen, FileText, X, RefreshCw } from 'lucide-react';
import { AuthContext } from '../App';

export default function Console() {
  const { token } = useContext(AuthContext);
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Workspace File Explorer states
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  // Modals state
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [configKeys, setConfigKeys] = useState({});
  const [configSaving, setConfigSaving] = useState(false);

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

  const fetchWorkspaceFiles = () => {
    if (!activeSession) return;
    setIsLoadingFiles(true);
    fetch('http://localhost:3000/api/v1/workspace/files', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setWorkspaceFiles(data);
      })
      .finally(() => setIsLoadingFiles(false));
  };

  // Poll workspace files occasionally when session is active
  useEffect(() => {
    if (activeSession) {
      fetchWorkspaceFiles();
      const interval = setInterval(fetchWorkspaceFiles, 10000);
      return () => clearInterval(interval);
    } else {
      setWorkspaceFiles([]);
      setViewingFile(null);
    }
  }, [activeSession, token]);

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
      setShowErrorModal(true);
    } finally {
      setIsLoading(false);
    }
  };

  const openConfigModal = () => {
    const required = selectedAgent?.env_required || [];
    const initialKeys = {};
    required.forEach(k => initialKeys[k] = '');
    setConfigKeys(initialKeys);
    setShowConfigModal(true);
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setConfigSaving(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(configKeys)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save keys');
      setShowConfigModal(false);
      // Optional: immediately launch the agent after saving keys
      // handleStartSession();
    } catch (err) {
      setError(err.message);
      setShowErrorModal(true);
    } finally {
      setConfigSaving(false);
    }
  };

  const handleOpenFile = async (file) => {
    if (file.type !== 'file') return;
    try {
      const res = await fetch(`http://localhost:3000/api/v1/workspace/file?path=${encodeURIComponent(file.path)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setViewingFile(file);
        setFileContent(data.content);
      } else {
        alert('Could not read file: ' + data.error);
      }
    } catch (e) {
      alert('Failed to fetch file content');
    }
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <>
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 shrink-0">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-zinc-900">Active Session</h1>
          <p className="text-sm text-zinc-500 max-w-2xl">
            Run your enterprise agent in a restricted workspace jail. View generated files directly in the browser.
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

      {/* Dialog Modals */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden border border-zinc-200">
            <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-red-50 text-red-600">
              <X className="w-5 h-5 shrink-0" />
              <h3 className="font-semibold text-sm">Action Failed</h3>
            </div>
            <div className="p-5 text-sm text-zinc-600 break-words">
              {error}
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end">
              <button 
                onClick={() => setShowErrorModal(false)}
                className="h-9 px-4 bg-zinc-900 text-white rounded-md text-sm font-medium hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden border border-zinc-200">
            <form onSubmit={handleSaveConfig}>
              <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50">
                <Settings2 className="w-5 h-5 shrink-0 text-zinc-500" />
                <h3 className="font-semibold text-sm text-zinc-900">Configure {selectedAgent?.name}</h3>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-zinc-500 mb-4">
                  Please provide the required API keys for this agent. They will be securely saved to your personal vault.
                </p>
                {selectedAgent?.env_required?.length === 0 ? (
                  <p className="text-sm font-medium text-zinc-900">No special API keys required for this agent.</p>
                ) : (
                  selectedAgent?.env_required?.map(key => (
                    <div key={key}>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">{key}</label>
                      <input 
                        type={key.includes('KEY') || key.includes('TOKEN') ? 'password' : 'text'}
                        required
                        className="w-full h-9 px-3 border border-zinc-200 rounded-md focus:border-black focus:ring-1 focus:ring-black text-sm font-mono"
                        value={configKeys[key] || ''}
                        onChange={e => setConfigKeys({...configKeys, [key]: e.target.value})}
                        placeholder={`Enter ${key}`}
                      />
                    </div>
                  ))
                )}
              </div>
              <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
                <button 
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="h-9 px-4 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
                >
                  Cancel
                </button>
                {selectedAgent?.env_required?.length > 0 && (
                  <button 
                    type="submit"
                    disabled={configSaving}
                    className="h-9 px-4 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {configSaving ? 'Saving...' : 'Save Keys'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Split Layout */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">
        
        {/* Left Panel: Explorer or Setup */}
        <div className="w-full lg:w-80 shrink-0 flex flex-col gap-6">
          {activeSession ? (
            // Workspace File Explorer (Only visible during active session)
            <div className="bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 p-4">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-zinc-500" />
                  <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">Workspace</h2>
                </div>
                <button onClick={fetchWorkspaceFiles} className="text-zinc-400 hover:text-black">
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-2">
                {workspaceFiles.filter(f => f.type === 'file').length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500">No files generated yet.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {workspaceFiles.filter(f => f.type === 'file').map((file, idx) => (
                      <button 
                        key={idx}
                        onClick={() => handleOpenFile(file)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left truncate transition-colors ${viewingFile?.path === file.path ? 'bg-zinc-100 text-black font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                        <span className="truncate">{file.path}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Setup Panel (Visible when no active session)
            <>
              <div className="bg-white border border-zinc-200 rounded-lg shadow-sm p-5 flex flex-col gap-5">
                <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
                  <Settings2 className="w-4 h-4 text-zinc-500" />
                  <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">New Instance</h2>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">Target Agent</label>
                    <select 
                      className="w-full appearance-none bg-white border border-zinc-200 rounded-md px-3 py-2 text-sm focus:border-black focus:ring-1 focus:ring-black"
                      value={selectedAgentId} 
                      onChange={e => setSelectedAgentId(e.target.value)}
                    >
                      {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                    </select>
                  </div>
                  {selectedAgent?.env_required?.length > 0 && (
                    <button 
                      onClick={openConfigModal}
                      className="w-full flex items-center justify-center gap-2 h-9 border border-zinc-200 rounded-md text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                    >
                      <Settings2 className="w-4 h-4" /> Configure Keys
                    </button>
                  )}
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
                        className="text-left p-3 rounded-md border text-sm border-zinc-200 hover:border-zinc-300 transition-colors"
                      >
                        <div className="font-medium text-zinc-900">{s.agentId}</div>
                        <div className="text-xs text-zinc-500 font-mono truncate">{s.id}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Panel: Terminal and File Viewer */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          {/* File Viewer Modal / Inline Panel */}
          {viewingFile && (
            <div className="h-1/2 bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col overflow-hidden shrink-0">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-500" />
                  <span className="text-sm font-semibold text-zinc-900">{viewingFile.name}</span>
                  <span className="text-xs text-zinc-400 font-mono">{viewingFile.path}</span>
                </div>
                <button onClick={() => setViewingFile(null)} className="text-zinc-400 hover:text-black p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 bg-zinc-50/30 text-sm font-mono text-zinc-800 whitespace-pre">
                {fileContent}
              </div>
            </div>
          )}

          {/* Terminal View */}
          <div className="flex-1 min-h-0 bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col overflow-hidden">
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

      </div>
    </>
  );
}
