import React, { useState, useEffect, useContext } from 'react';
import AgentConsole from '../components/AgentConsole';
import SelectMenu from '../components/SelectMenu';
import { TerminalSquare, Play, Unplug, Settings2, FolderOpen, FileText, X, RefreshCw, Plus, PanelRightOpen, PanelRightClose, Trash2, ChevronRight, ChevronDown, FolderPlus } from 'lucide-react';
import { AuthContext } from '../App';
import { getSecretLabel, isSecretPasswordField } from '../lib/secretLabels';

const DEFAULT_AGENT_ID = 'kimi-code';

const SLUG_WORDS = [
  'small', 'heavy', 'many', 'quiet', 'swift', 'bright', 'calm', 'bold', 'brave', 'clear',
  'dark', 'fast', 'fresh', 'grand', 'keen', 'light', 'neat', 'proud', 'sharp', 'warm',
  'flies', 'colts', 'items', 'signs', 'hounds', 'clouds', 'doors', 'fields', 'flames', 'gates',
  'hints', 'ideas', 'kites', 'lanes', 'maps', 'nodes', 'paths', 'roads', 'stars', 'trees',
  'film', 'play', 'argue', 'invent', 'travel', 'cheer', 'results', 'forest', 'river', 'stone',
];

function defaultWorkspaceName() {
  const pick = () => SLUG_WORDS[Math.floor(Math.random() * SLUG_WORDS.length)];
  return `${pick()}-${pick()}-${pick()}`;
}

function formatSessionTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildWorkspaces(projects, sessions) {
  const byProject = {};
  for (const s of sessions) {
    const pid = s.projectId || '_orphan';
    if (!byProject[pid]) byProject[pid] = [];
    byProject[pid].push(s);
  }
  const sortSessions = (list) => [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const list = projects.map((p) => {
    const sess = sortSessions(byProject[p.id] || []);
    const lastActivity = Math.max(
      p.createdAt || 0,
      ...sess.map((s) => s.createdAt || 0),
    );
    return { id: p.id, name: p.name, sessions: sess, lastActivity };
  });
  if (byProject._orphan?.length) {
    const sess = sortSessions(byProject._orphan);
    list.push({
      id: '_orphan',
      name: 'Unassigned',
      sessions: sess,
      lastActivity: Math.max(...sess.map((s) => s.createdAt || 0)),
    });
  }
  return list.sort((a, b) => b.lastActivity - a.lastActivity);
}

export default function Console() {
  const { token } = useContext(AuthContext);
  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState(() => new Set());
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [launchModalMode, setLaunchModalMode] = useState('workspace');
  const [launchWorkspaceId, setLaunchWorkspaceId] = useState('');
  const [projectCreating, setProjectCreating] = useState(false);
  const [launchModalError, setLaunchModalError] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Workspace File Explorer states
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [viewingFile, setViewingFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  // Modals state
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showNewInstanceModal, setShowNewInstanceModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [configKeys, setConfigKeys] = useState({});
  const [savedConfigKeys, setSavedConfigKeys] = useState({});
  const [configSaving, setConfigSaving] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState(null);

  useEffect(() => {
    if (!token) return;
    fetch('http://localhost:3000/api/v1/agents')
      .then(res => res.json())
      .then(data => {
        setAgents(data);
        if (data.length > 0) {
          const preferred = data.find((a) => a.id === DEFAULT_AGENT_ID) || data[0];
          setSelectedAgentId(preferred.id);
        }
      })
      .catch(() => setError('Could not connect to backend server.'));

    fetchWorkspaces();
    const poll = setInterval(fetchWorkspaces, 5000);
    return () => clearInterval(poll);
  }, [token]);

  useEffect(() => {
    if (!activeSession?.projectId) return;
    setExpandedWorkspaces((prev) => {
      if (prev.has(activeSession.projectId)) return prev;
      const next = new Set(prev);
      next.add(activeSession.projectId);
      return next;
    });
  }, [activeSession?.projectId]);

  useEffect(() => {
    const runningIds = [...new Set(sessions.filter((s) => s.alive && s.projectId).map((s) => s.projectId))];
    if (runningIds.length === 0) return;
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of runningIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sessions]);

  const fetchProjects = () =>
    fetch('http://localhost:3000/api/v1/projects', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        setProjects(
          data.map((p) => ({
            id: p.id,
            name: p.name,
            createdAt: p.created_at ?? p.createdAt ?? 0,
          })),
        );
      });

  const fetchSessions = () =>
    fetch('http://localhost:3000/api/v1/sessions', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSessions(data);
      });

  const fetchWorkspaces = () => {
    fetchProjects();
    fetchSessions();
  };

  const toggleWorkspaceExpanded = (workspaceId) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  };

  const fetchWorkspaceFiles = () => {
    if (!activeSession?.projectId) return;
    setIsLoadingFiles(true);
    fetch(`http://localhost:3000/api/v1/workspace/files?project_id=${encodeURIComponent(activeSession.projectId)}`, {
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
      setWorkspaceOpen(false);
    }
  }, [activeSession, token]);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const openConfigModal = async () => {
    const required = selectedAgent?.env_required || [];
    const initialKeys = {};
    required.forEach(k => { initialKeys[k] = ''; });
    setConfigKeys(initialKeys);
    setSavedConfigKeys({});
    setShowConfigModal(true);
    setConfigLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        const saved = {};
        required.forEach(k => {
          if (data[k]) saved[k] = data[k];
        });
        setSavedConfigKeys(saved);
        setConfigKeys(prev => {
          const next = { ...prev };
          required.forEach(k => {
            if (saved[k]) next[k] = saved[k];
          });
          return next;
        });
      }
    } catch {
      // Modal still opens; user can enter keys manually
    } finally {
      setConfigLoading(false);
    }
  };

  const ensureAgentSecrets = async (agent) => {
    const required = agent?.env_required || [];
    if (required.length === 0) return true;
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) return false;
      const missing = required.filter(k => !data[k]);
      if (missing.length === 0) return true;
      setError(`Missing required keys: ${missing.join(', ')}`);
      openConfigModal();
      return false;
    } catch {
      setError('Could not verify API keys. Open Settings from the account menu to configure them.');
      openConfigModal();
      return false;
    }
  };

  const handleCreateProject = async (nameOverride) => {
    const name = (nameOverride ?? newProjectName).trim() || defaultWorkspaceName();
    setProjectCreating(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3000/api/v1/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');
      return { id: data.id, name: data.name || name };
    } catch (err) {
      setLaunchModalError(err.message);
      return null;
    } finally {
      setProjectCreating(false);
    }
  };

  const handleStartSession = async (projectId, projectName, { closeLaunchModal = true } = {}) => {
    if (!selectedAgentId || !selectedAgent) return false;
    if (!projectId) {
      setLaunchModalError('Could not create workspace for this session.');
      return false;
    }
    setIsLoading(true);
    setLaunchModalError(null);
    setError(null);
    try {
      const ready = await ensureAgentSecrets(selectedAgent);
      if (!ready) {
        setLaunchModalError('Configure required API keys before launching.');
        return false;
      }

      const response = await fetch('http://localhost:3000/api/v1/session/start', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ agent_id: selectedAgentId, project_id: projectId })
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = data.error || data.message || 'Failed to start session';
        if (/Missing required env|Secrets Vault/i.test(msg)) {
          setLaunchModalError(msg);
          openConfigModal();
          return false;
        }
        throw new Error(msg);
      }

      setActiveSession({
        sessionId: data.session_id,
        agentName: selectedAgent.name,
        projectId,
        projectName: projectName || projectId,
      });
      fetchWorkspaces();
      setExpandedWorkspaces((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
      if (closeLaunchModal) setShowNewInstanceModal(false);
      return true;
    } catch (err) {
      setLaunchModalError(err.message);
      setError(err.message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const openLaunchModal = (mode = 'workspace', workspace = null) => {
    setLaunchModalError(null);
    setLaunchModalMode(mode);
    if (mode === 'session' && workspace) {
      setLaunchWorkspaceId(workspace.id);
      setNewProjectName(workspace.name);
    } else {
      setLaunchWorkspaceId('');
      setNewProjectName(defaultWorkspaceName());
    }
    setShowNewInstanceModal(true);
  };

  const handleLaunchFromModal = async () => {
    setLaunchModalError(null);
    if (launchModalMode === 'session') {
      if (!launchWorkspaceId) {
        setLaunchModalError('Select a workspace first.');
        return;
      }
      const ws = projects.find((p) => p.id === launchWorkspaceId);
      await handleStartSession(launchWorkspaceId, ws?.name || launchWorkspaceId, { closeLaunchModal: true });
      return;
    }
    const name = newProjectName.trim() || defaultWorkspaceName();
    const created = await handleCreateProject(name);
    if (!created) return;
    await handleStartSession(created.id, created.name, { closeLaunchModal: true });
  };

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    const required = selectedAgent?.env_required || [];
    const payload = {};
    required.forEach(k => {
      const value = configKeys[k]?.trim();
      if (value) payload[k] = value;
    });
    const missing = required.filter(k => !payload[k] && !savedConfigKeys[k]);
    if (missing.length > 0) {
      setError(`Missing required keys: ${missing.join(', ')}`);
      setShowErrorModal(true);
      return;
    }
    if (Object.keys(payload).length === 0) {
      setShowConfigModal(false);
      return;
    }
    setConfigSaving(true);
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save keys');
      setSavedConfigKeys(prev => ({ ...prev, ...payload }));
      setShowConfigModal(false);
      setLaunchModalError(null);
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
      const res = await fetch(
        `http://localhost:3000/api/v1/workspace/file?project_id=${encodeURIComponent(activeSession.projectId)}&path=${encodeURIComponent(file.path)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
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

  const handleSessionEnd = (sessionId) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, alive: false, memoryStatus: 'exited', status: 'exited' } : s
      )
    );
    fetchSessions();
  };

  const handleDeleteSession = async (sessionId) => {
    setDeletingSessionId(sessionId);
    try {
      const res = await fetch(`http://localhost:3000/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete session');
      if (activeSession?.sessionId === sessionId) setActiveSession(null);
      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
      setShowErrorModal(true);
    } finally {
      setDeletingSessionId(null);
    }
  };

  const getAgentLabel = (agentId) => agents.find((a) => a.id === agentId)?.name || agentId;
  const workspaces = buildWorkspaces(projects, sessions);
  const runningCount = sessions.filter((s) => s.alive === true).length;

  return (
    <>
      {/* Dialog Modals */}
      {showErrorModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200">
            <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-red-50 text-red-600">
              <X className="w-5 h-5 shrink-0" />
              <h3 className="font-semibold text-sm">Action Failed</h3>
            </div>
            <div className="p-5 text-sm text-zinc-600 break-words">
              {error}
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
              {/Missing required|Secrets Vault/i.test(error || '') && selectedAgent?.env_required?.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowErrorModal(false);
                    openConfigModal();
                  }}
                  className="h-9 px-4 flex items-center gap-2 border border-zinc-200 rounded-md text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 mr-auto"
                >
                  <Settings2 className="w-4 h-4" /> Configure Keys
                </button>
              )}
              <button 
                type="button"
                onClick={() => setShowErrorModal(false)}
                className="h-9 px-4 bg-zinc-900 text-white rounded-md text-sm font-medium hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewInstanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-sm w-full max-w-lg overflow-hidden border border-zinc-200">
            <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50">
              <Plus className="w-5 h-5 shrink-0 text-zinc-500" />
              <h3 className="font-semibold text-sm text-zinc-900">
                {launchModalMode === 'session' ? 'New session in workspace' : 'New workspace & session'}
              </h3>
            </div>
            <div className="p-5 space-y-4">
              {launchModalError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{launchModalError}</p>
              )}
              {launchModalMode === 'workspace' ? (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Workspace name</label>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    placeholder="quiet-forest-door"
                    className="w-full h-9 px-3 border border-zinc-200 rounded-md text-sm focus:border-black focus:ring-1 focus:ring-black"
                  />
                  <p className="text-xs text-zinc-500 mt-2">Creates an isolated project directory. You can add more parallel sessions later.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Workspace</label>
                  <SelectMenu
                    value={launchWorkspaceId}
                    onChange={setLaunchWorkspaceId}
                    placeholder="Select workspace"
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <p className="text-xs text-zinc-500 mt-2">Runs another agent in the same workspace for parallel development.</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">Agent</label>
                {agents.length === 0 ? (
                  <p className="text-sm text-zinc-500">No agents available.</p>
                ) : (
                  <SelectMenu
                    value={selectedAgentId}
                    onChange={setSelectedAgentId}
                    placeholder="Select agent"
                    options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                  />
                )}
              </div>
            </div>
            <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex flex-col sm:flex-row justify-end gap-2">
              {selectedAgent?.env_required?.length > 0 && (
                <button
                  type="button"
                  onClick={() => openConfigModal()}
                  className="h-9 px-4 flex items-center justify-center gap-2 border border-zinc-200 rounded-md text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 sm:mr-auto"
                >
                  <Settings2 className="w-4 h-4" /> Configure Keys
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowNewInstanceModal(false);
                  setLaunchModalError(null);
                }}
                className="h-9 px-4 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  !selectedAgentId
                  || isLoading
                  || (launchModalMode === 'workspace' && projectCreating)
                  || (launchModalMode === 'session' && !launchWorkspaceId)
                }
                onClick={handleLaunchFromModal}
                className="h-9 px-4 flex items-center justify-center gap-2 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
              >
                <Play className="w-4 h-4" /> {isLoading || projectCreating ? 'Starting...' : launchModalMode === 'session' ? 'Start session' : 'Create & launch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfigModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-sm w-full max-w-md overflow-hidden border border-zinc-200">
            <form onSubmit={handleSaveConfig}>
              <div className="p-5 border-b border-zinc-100 flex items-center gap-3 bg-zinc-50">
                <Settings2 className="w-5 h-5 shrink-0 text-zinc-500" />
                <h3 className="font-semibold text-sm text-zinc-900">Configure {selectedAgent?.name}</h3>
              </div>
              <div className="p-5 space-y-4">
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</p>
                )}
                <p className="text-sm text-zinc-500 mb-4">
                  Please provide the required API keys for this agent. They will be securely saved to your personal vault.
                </p>
                {configLoading ? (
                  <p className="text-sm text-zinc-500">Loading saved keys...</p>
                ) : selectedAgent?.env_required?.length === 0 ? (
                  <p className="text-sm font-medium text-zinc-900">No special API keys required for this agent.</p>
                ) : (
                  selectedAgent?.env_required?.map(key => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-zinc-900">{getSecretLabel(key)}</label>
                        {savedConfigKeys[key] && (
                          <span className="text-xs text-green-600 font-medium">Saved</span>
                        )}
                      </div>
                      <input 
                        type={isSecretPasswordField(key) ? 'password' : 'text'}
                        className="w-full h-9 px-3 border border-zinc-200 rounded-md focus:border-black focus:ring-1 focus:ring-black text-sm font-mono"
                        value={configKeys[key] || ''}
                        onChange={e => setConfigKeys({...configKeys, [key]: e.target.value})}
                        placeholder={savedConfigKeys[key] ? 'Leave unchanged or enter new value' : `Enter ${getSecretLabel(key)}`}
                      />
                    </div>
                  ))
                )}
              </div>
              <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">
                <button 
                  type="button"
                  onClick={() => {
                    setShowConfigModal(false);
                    setLaunchModalError(null);
                  }}
                  className="h-9 px-4 bg-white border border-zinc-200 text-zinc-700 rounded-md text-sm font-medium hover:bg-zinc-50"
                >
                  {showNewInstanceModal ? 'Back' : 'Cancel'}
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
        
        {/* Left Panel: Workspaces + Sessions */}
        <div className="w-full lg:w-80 shrink-0 flex flex-col gap-3 min-h-0">
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openLaunchModal('workspace')}
              disabled={isLoading || agents.length === 0}
              className="flex flex-1 items-center justify-center gap-2 h-9 px-3 rounded-md text-sm font-medium bg-black text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              <FolderPlus className="w-4 h-4" /> New workspace
            </button>
          </div>
          <div className="bg-white border border-zinc-200 rounded-lg shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 p-4 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className="w-4 h-4 text-zinc-500 shrink-0" />
                <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">Workspaces</h2>
              </div>
              {runningCount > 0 && (
                <span className="text-[10px] uppercase tracking-wider font-semibold text-green-600 shrink-0">
                  {runningCount} running
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto p-2">
              {workspaces.length === 0 ? (
                <p className="text-sm text-zinc-500 px-2 py-1">No workspaces yet. Create one to start parallel sessions.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {workspaces.map((ws) => {
                    const expanded = expandedWorkspaces.has(ws.id);
                    const liveInWs = ws.sessions.filter((s) => s.alive).length;
                    const isOrphan = ws.id === '_orphan';
                    return (
                      <div key={ws.id} className="rounded-md">
                        <div className="group flex items-center gap-0.5 rounded-md hover:bg-zinc-50">
                          <button
                            type="button"
                            onClick={() => toggleWorkspaceExpanded(ws.id)}
                            className="p-2 text-zinc-400 hover:text-zinc-700 shrink-0"
                            aria-expanded={expanded}
                          >
                            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleWorkspaceExpanded(ws.id)}
                            className="flex-1 min-w-0 text-left py-2 pr-1"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-zinc-800 truncate">{ws.name}</span>
                              {liveInWs > 0 && (
                                <span className="shrink-0 text-[10px] font-semibold text-green-600">{liveInWs}</span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate">
                              {ws.sessions.length === 0 ? 'No sessions' : `${ws.sessions.length} session${ws.sessions.length > 1 ? 's' : ''}`}
                            </div>
                          </button>
                          {!isOrphan && (
                            <button
                              type="button"
                              title="New session in this workspace"
                              disabled={isLoading || agents.length === 0}
                              onClick={() => openLaunchModal('session', { id: ws.id, name: ws.name })}
                              className="p-2 mr-1 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {expanded && (
                          <div className="ml-5 pl-2 border-l border-zinc-100 flex flex-col gap-1 pb-1">
                            {ws.sessions.length === 0 ? (
                              <p className="text-xs text-zinc-400 py-2 px-1">No sessions. Use + to add one.</p>
                            ) : (
                              ws.sessions.map((s) => {
                                const isActive = activeSession?.sessionId === s.id;
                                const isLive = s.alive === true;
                                const isDeleting = deletingSessionId === s.id;
                                return (
                                  <div
                                    key={s.id}
                                    className={`group/session relative rounded-md border text-sm transition-colors ${
                                      isActive
                                        ? 'border-black bg-zinc-50 ring-1 ring-black/5'
                                        : isLive
                                          ? 'border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                                          : 'border-zinc-200 opacity-60 hover:bg-zinc-50'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      disabled={isDeleting}
                                      onClick={() => {
                                        if (!isLive) {
                                          setError('This session has ended. Start a new session in this workspace (+).');
                                          setShowErrorModal(true);
                                          return;
                                        }
                                        setActiveSession({
                                          sessionId: s.id,
                                          agentName: getAgentLabel(s.agentId),
                                          projectId: s.projectId,
                                          projectName: s.projectName || ws.name,
                                        });
                                      }}
                                      className="w-full text-left p-2.5 pr-8 disabled:opacity-50"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className={`font-medium truncate text-xs ${isActive ? 'text-zinc-900' : 'text-zinc-700'}`}>
                                          {getAgentLabel(s.agentId)}
                                        </span>
                                        {isActive && isLive ? (
                                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-green-600">Live</span>
                                        ) : isLive ? (
                                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-zinc-400">Run</span>
                                        ) : (
                                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-zinc-400">End</span>
                                        )}
                                      </div>
                                      <div className="text-[11px] text-zinc-400 truncate mt-0.5">{formatSessionTime(s.createdAt)}</div>
                                    </button>
                                    <button
                                      type="button"
                                      title="Delete session"
                                      disabled={isDeleting}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteSession(s.id);
                                      }}
                                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-zinc-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover/session:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-50"
                                    >
                                      <Trash2 className={`w-3 h-3 ${isDeleting ? 'animate-pulse' : ''}`} />
                                    </button>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: Terminal and File Viewer */}
        <div className="flex-1 min-w-0 flex flex-col gap-6 min-h-0">
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
            <div className="flex h-10 shrink-0 items-center justify-end gap-2 px-3 border-b border-zinc-100">
              {activeSession && (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveSession(null)}
                    title="Disconnect view"
                    className="flex items-center justify-center h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    <Unplug className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceOpen(v => !v)}
                    title={workspaceOpen ? 'Hide workspace' : 'Show workspace'}
                    className="flex items-center justify-center h-8 w-8 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  >
                    {workspaceOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
                  </button>
                </>
              )}
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {activeSession ? (
                <AgentConsole
                  key={activeSession.sessionId}
                  sessionId={activeSession.sessionId}
                  agentName={activeSession.agentName}
                  onSessionEnd={handleSessionEnd}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 p-8 text-center bg-zinc-50/50">
                  <TerminalSquare className="w-12 h-12 mb-4 text-zinc-300" strokeWidth={1} />
                  <h3 className="text-base font-medium text-zinc-900 mb-1">No Active Session</h3>
                  <p className="text-sm">Expand a workspace and select a session, or create a new workspace.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Workspace */}
        {activeSession && workspaceOpen && (
            <div className="w-full lg:w-72 shrink-0 flex flex-col min-h-0 bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen className="w-4 h-4 text-zinc-500 shrink-0" />
                  <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider truncate" title={activeSession.projectName}>
                    {activeSession.projectName || 'Workspace'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={fetchWorkspaceFiles}
                  title="Refresh files"
                  className="p-1.5 text-zinc-400 hover:text-black rounded-md hover:bg-zinc-100"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingFiles ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-2 min-h-0">
                {workspaceFiles.filter(f => f.type === 'file').length === 0 ? (
                  <div className="p-4 text-center text-xs text-zinc-500">No files generated yet.</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {workspaceFiles.filter(f => f.type === 'file').map((file, idx) => (
                      <button
                        key={idx}
                        type="button"
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
        )}

      </div>
    </>
  );
}
