import React, { useState, useRef } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Sessions from './pages/Sessions';
import AgentsAdmin from './pages/AgentsAdmin';
import BoxLiteImagesAdmin from './pages/BoxLiteImagesAdmin';
import UsersAdmin from './pages/UsersAdmin';
import GatewayAdmin from './pages/GatewayAdmin';
import AppSidebar from './components/AppSidebar';
import SettingsModal from './components/SettingsModal';
import { useWorkspaces } from './hooks/useWorkspaces';
import { cn } from './lib/utils';
import { APP_SHELL_ADMIN_CLASS } from './lib/appShellLayout';
import { bgCanvas } from './lib/consoleTheme';
import { getAccessToken, setTokens, clearTokens } from './lib/api';
import { TerminalThemeProvider } from './hooks/useTerminalTheme.jsx';

export const AuthContext = React.createContext(null);

async function loadStoredAuth() {
  const accessToken = getAccessToken();
  const userRaw = localStorage.getItem('user');
  let user = null;
  if (userRaw) {
    try { user = JSON.parse(userRaw); } catch { user = null; }
  }
  return { accessToken, user };
}

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

  const isSessions = location.pathname === '/sessions';
  const isAgentsAdmin = location.pathname === '/admin/agents';
  const isUsersAdmin = location.pathname === '/admin/users';
  const isGatewayAdmin = location.pathname === '/admin/gateway';
  const isBoxLiteImagesAdmin = location.pathname === '/admin/boxlite-images';

  const offRouteClass = 'pointer-events-none invisible absolute inset-0 z-0 [&_*]:pointer-events-none';

  return (
    <div className={`h-full flex ${bgCanvas}`}>
      <AppSidebar
        agents={agents}
        projects={projects}
        sessions={sessions}
        activeSession={activeSession}
        fetchWorkspaces={fetchWorkspaces}
        onSelectSession={(session) => {
          setActiveSession({
            sessionId: session.id,
            agentId: session.agentId,
            agentName: agents.find((a) => a.id === session.agentId)?.name || session.agentId,
            projectId: session.projectId ?? null,
            projectName: session.projectName ?? null,
          });
          if (location.pathname !== '/sessions') navigate('/sessions');
        }}
        onCreateWorkspace={() => sessionsRef.current?.openLaunchModal?.('workspace')}
        onImportFromGit={() => sessionsRef.current?.openImportDialog?.()}
        onNewAgent={() => sessionsRef.current?.openLaunchModal?.('session')}
        onRequestDeleteSession={(session, ws) => sessionsRef.current?.requestDeleteSession?.(session, ws)}
        onRequestDeleteWorkspace={(ws) => sessionsRef.current?.requestDeleteWorkspace?.(ws)}
        onArchiveSession={(sessionId) => {
          if (activeSession?.sessionId === sessionId) setActiveSession(null);
        }}
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
          className={cn(
            'flex h-full min-h-0 flex-1 flex-col',
            isSessions ? 'relative z-10' : offRouteClass,
          )}
          aria-hidden={!isSessions}
        />
        {user?.role === 'admin' && (
          <>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
                isAgentsAdmin ? 'relative z-10' : offRouteClass,
              )}
              aria-hidden={!isAgentsAdmin}
            >
              <AgentsAdmin />
            </div>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
                isUsersAdmin ? 'relative z-10' : offRouteClass,
              )}
              aria-hidden={!isUsersAdmin}
            >
              <UsersAdmin />
            </div>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
                isGatewayAdmin ? 'relative z-10' : offRouteClass,
              )}
              aria-hidden={!isGatewayAdmin}
            >
              <GatewayAdmin />
            </div>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                APP_SHELL_ADMIN_CLASS,
                isBoxLiteImagesAdmin ? 'relative z-10' : offRouteClass,
              )}
              aria-hidden={!isBoxLiteImagesAdmin}
            >
              <BoxLiteImagesAdmin />
            </div>
          </>
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
    loadStoredAuth().then(({ accessToken, user }) => {
      setToken(accessToken);
      setUser(user);
      setAuthReady(true);
    });
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
                path="/admin/boxlite-images"
                element={user?.role === 'admin' ? null : <Navigate to="/sessions" replace />}
              />
            </Route>

            <Route path="/settings" element={<Navigate to="/sessions" replace />} />
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
