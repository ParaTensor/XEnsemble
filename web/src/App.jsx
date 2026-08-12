import React, { useState, useRef, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Sessions from './pages/Sessions';
import AgentsAdmin from './pages/AgentsAdmin';
import ImagesManager from './pages/ImagesManager';
import UsersAdmin from './pages/UsersAdmin';
import GatewayAdmin from './pages/GatewayAdmin';
import AppSidebar from './components/AppSidebar';
import SettingsModal from './components/SettingsModal';
import { useWorkspaces } from './hooks/useWorkspaces';
import { cn } from './lib/utils';
import { APP_SHELL_ADMIN_CLASS } from './lib/appShellLayout';
import { bgCanvas } from './lib/consoleTheme';
import { getAccessToken, setTokens, clearTokens, apiFetch, isStoredAuthStale, setAuthExpiredHandler } from './lib/api';
import { TerminalThemeProvider } from './hooks/useTerminalTheme.jsx';

export const AuthContext = React.createContext(null);

function AuthenticatedLayout({
  token,
  user,
  agents,
  projects,
  setProjects,
  sessions,
  setSessions,
  activeSession,
  setActiveSession,
  fetchWorkspaces,
  logout,
  showSettingsModal,
  setShowSettingsModal,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const sessionsRef = useRef(null);
  const [launchPanelOpen, setLaunchPanelOpen] = useState(false);

  const isSessions = location.pathname === '/sessions';
  const isAgentsAdmin = location.pathname === '/admin/agents';
  const isUsersAdmin = location.pathname === '/admin/users';
  const isGatewayAdmin = location.pathname === '/admin/gateway';
  const isImagesAdmin = location.pathname === '/admin/images';
  const isCustomImages = location.pathname === '/custom-images';
  const isImagesManager = isCustomImages || isImagesAdmin;

  const offRouteClass = 'pointer-events-none invisible absolute inset-0 z-0 [&_*]:pointer-events-none';

  const onSelectSession = useCallback((session) => {
    setActiveSession({
      sessionId: session.id,
      agentId: session.agentId,
      agentName: agents.find((a) => a.id === session.agentId)?.name || session.agentId,
      projectId: session.projectId ?? null,
      projectName: session.projectName ?? null,
    });
    if (location.pathname !== '/sessions') navigate('/sessions');
  }, [setActiveSession, agents, navigate, location.pathname]);

  const onArchiveSession = useCallback((sessionId) => {
    if (activeSession?.sessionId === sessionId) setActiveSession(null);
  }, [activeSession?.sessionId, setActiveSession]);

  return (
    <div className={`h-full flex ${bgCanvas}`}>
      <AppSidebar
        agents={agents}
        projects={projects}
        sessions={sessions}
        activeSession={activeSession}
        fetchWorkspaces={fetchWorkspaces}
        onSelectSession={onSelectSession}
        onCreateWorkspace={() => sessionsRef.current?.openLaunchModal?.('workspace')}
        onImportFromGit={() => sessionsRef.current?.openImportDialog?.()}
        onNewAgent={() => { setLaunchPanelOpen(true); sessionsRef.current?.openLaunchModal?.('session'); }}
        onRequestDeleteSession={(session, ws) => sessionsRef.current?.requestDeleteSession?.(session, ws)}
        onRequestDeleteWorkspace={(ws) => sessionsRef.current?.requestDeleteWorkspace?.(ws)}
        onArchiveSession={onArchiveSession}
        user={user}
        onOpenSettings={() => setShowSettingsModal(true)}
        onLogout={logout}
      />
      <main
        className={`relative flex h-full min-h-0 flex-1 flex-col min-w-0 ${bgCanvas}`}
      >
        <Sessions
          ref={sessionsRef}
          token={token}
          user={user}
          agents={agents}
          projects={projects}
          setProjects={setProjects}
          sessions={sessions}
          setSessions={setSessions}
          activeSession={activeSession}
          setActiveSession={setActiveSession}
          fetchWorkspaces={fetchWorkspaces}
          launchPanelOpen={launchPanelOpen}
          onLaunchPanelClose={() => setLaunchPanelOpen(false)}
          className={cn(
            'flex h-full min-h-0 flex-1 flex-col',
            (isSessions || launchPanelOpen) ? 'relative z-20' : offRouteClass,
          )}
          aria-hidden={!isSessions && !launchPanelOpen}
        />
        {user?.role === 'admin' && isAgentsAdmin && (
            <div
              className={cn(
                'relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
              )}
            >
              <AgentsAdmin />
            </div>
        )}
        {user?.role === 'admin' && isUsersAdmin && (
            <div
              className={cn(
                'relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
              )}
            >
              <UsersAdmin />
            </div>
        )}
        {user?.role === 'admin' && isGatewayAdmin && (
            <div
              className={cn(
                'relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
              )}
            >
              <GatewayAdmin />
            </div>
        )}
        {isImagesManager && (
            <div
              className={cn(
                'relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
              )}
            >
              <ImagesManager />
            </div>
        )}
      </main>
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const navigate = useNavigate();

  const {
    agents,
    projects,
    setProjects,
    sessions,
    setSessions,
    activeSession,
    setActiveSession,
    fetchWorkspaces,
  } = useWorkspaces(user);

  React.useEffect(() => {
    setAuthExpiredHandler(() => {
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
      navigate('/login', { replace: true });
    });
    return () => setAuthExpiredHandler(null);
  }, [navigate]);

  React.useEffect(() => {
    const openSettings = () => setShowSettingsModal(true);
    window.addEventListener('xe:open-settings', openSettings);
    return () => window.removeEventListener('xe:open-settings', openSettings);
  }, []);

  React.useEffect(() => {
    (async () => {
      const accessToken = getAccessToken();
      let storedUser = null;
      const userRaw = localStorage.getItem('user');
      if (userRaw) {
        try { storedUser = JSON.parse(userRaw); } catch { storedUser = null; }
      }

      if (accessToken && isStoredAuthStale()) {
        clearTokens();
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
        setAuthReady(true);
        return;
      }

      if (accessToken) {
        try {
          const res = await apiFetch('/api/v1/auth/me');
          if (!res.ok) {
            clearTokens();
            localStorage.removeItem('user');
            setToken(null);
            setUser(null);
            setAuthReady(true);
            return;
          }
          const me = await res.json();
          setToken(getAccessToken());
          setUser(me?.user || (me?.id ? me : null) || storedUser);
          setAuthReady(true);
          return;
        } catch {
          setToken(accessToken);
          setUser(storedUser);
          setAuthReady(true);
          return;
        }
      }

      setToken(null);
      setUser(storedUser);
      setAuthReady(true);
    })();
  }, []);

  const login = async (accessToken, refreshToken, user) => {
    await setTokens(accessToken, refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(accessToken);
    setUser(user);
    navigate('/sessions', { replace: true });
  };

  const logout = async () => {
    await clearTokens();
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    navigate('/login', { replace: true });
  };

  if (!authReady) {
    return (
      <div className="flex h-full items-center justify-center bg-[#F4F5F6]">
        <div className="text-sm text-[#5F6368]">Loading…</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      <TerminalThemeProvider token={token}>
        <div className="h-full">
          <Routes>
            <Route
              path="/login"
              element={!token ? <Login /> : <Navigate to="/sessions" replace />}
            />

            <Route
              element={
                token ? (
                  <AuthenticatedLayout
                    token={token}
                    user={user}
                    agents={agents}
                    projects={projects}
                    setProjects={setProjects}
                    sessions={sessions}
                    setSessions={setSessions}
                    activeSession={activeSession}
                    setActiveSession={setActiveSession}
                    fetchWorkspaces={fetchWorkspaces}
                    logout={logout}
                    showSettingsModal={showSettingsModal}
                    setShowSettingsModal={setShowSettingsModal}
                  />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            >
              <Route path="/sessions" element={null} />
              <Route path="/custom-images" element={null} />
              <Route path="/console" element={<Navigate to="/sessions" replace />} />
              <Route
                path="/admin/agents"
                element={user?.role === 'admin' ? null : <Navigate to="/sessions" replace />}
              />
              <Route
                path="/admin/users"
                element={user?.role === 'admin' ? null : <Navigate to="/sessions" replace />}
              />
              <Route
                path="/admin/gateway"
                element={user?.role === 'admin' ? null : <Navigate to="/sessions" replace />}
              />
              <Route
                path="/admin/images"
                element={user?.role === 'admin' ? null : <Navigate to="/custom-images" replace />}
              />
            </Route>

            <Route path="/settings" element={<Navigate to="/sessions" replace />} />
            <Route path="/admin/boxlite-images" element={<Navigate to="/admin/images" replace />} />
            <Route path="/admin/platform" element={<Navigate to="/sessions" replace />} />
            <Route path="/" element={<Navigate to={token ? '/sessions' : '/login'} replace />} />
            <Route path="*" element={<Navigate to={token ? '/sessions' : '/login'} replace />} />
          </Routes>
        </div>
      </TerminalThemeProvider>
    </AuthContext.Provider>
  );
}

export default App;
