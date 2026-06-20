import React, { useState, useRef } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import SessionsPage from './pages/SessionsPage';
import AgentsAdmin from './pages/AgentsAdmin';
import UsersAdmin from './pages/UsersAdmin';
import AppSidebar from './components/AppSidebar';
import SettingsModal from './components/SettingsModal';
import { useWorkspaces } from './hooks/useWorkspaces';
import { cn } from './lib/utils';
import { TerminalThemeProvider } from './hooks/useTerminalTheme.jsx';

export const AuthContext = React.createContext(null);

async function loadStoredAuth() {
  if (typeof window !== 'undefined' && window.xensembleDesktopAPI) {
    const token = await window.xensembleDesktopAPI.getAccessToken();
    const userRaw = localStorage.getItem('user');
    return { token, user: userRaw ? JSON.parse(userRaw) : null };
  }
  return {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user')),
  };
}

/** Keep main pages mounted (invisible off-route) so state and terminal sessions stay alive with stable layout. */
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
  const sessionsPageRef = useRef(null);

  const isSessions = location.pathname === '/sessions';
  const isAgentsAdmin = location.pathname === '/admin/agents';
  const isUsersAdmin = location.pathname === '/admin/users';

  const offRouteClass = 'pointer-events-none invisible absolute inset-0 z-0';

  return (
    <div className="h-full flex">
      <AppSidebar
        agents={agents}
        projects={projects}
        sessions={sessions}
        activeSession={activeSession}
        onSelectSession={(session) =>
          setActiveSession({
            sessionId: session.id,
            agentId: session.agentId,
            agentName: agents.find((a) => a.id === session.agentId)?.name || session.agentId,
            projectId: session.projectId ?? null,
            projectName: session.projectName ?? null,
          })
        }
        onCreateWorkspace={() => sessionsPageRef.current?.openLaunchModal?.('workspace')}
        onCreateSessionInWorkspace={(ws) => sessionsPageRef.current?.openLaunchModal?.('session', ws)}
        onRequestDeleteSession={(session, ws) =>
          sessionsPageRef.current?.requestDeleteSession?.(session, ws)
        }
        onRequestDeleteWorkspace={(ws, anchorRect) =>
          sessionsPageRef.current?.requestDeleteWorkspace?.(ws, anchorRect)
        }
        onArchiveSession={(sessionId) => {
          if (activeSession?.sessionId === sessionId) setActiveSession(null);
        }}
        user={user}
        onOpenSettings={() => setShowSettingsModal(true)}
        onLogout={logout}
      />
      <main className="relative flex h-full min-h-0 flex-1 flex-col min-w-0 bg-white">
        <SessionsPage
          ref={sessionsPageRef}
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
          className={cn('flex h-full min-h-0 flex-1 flex-col', !isSessions && offRouteClass)}
          aria-hidden={!isSessions}
        />
        {user?.role === 'admin' && (
          <>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                isAgentsAdmin ? 'relative z-10' : offRouteClass,
              )}
              aria-hidden={!isAgentsAdmin}
            >
              <AgentsAdmin />
            </div>
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden',
                isUsersAdmin ? 'relative z-10' : offRouteClass,
              )}
              aria-hidden={!isUsersAdmin}
            >
              <UsersAdmin />
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
  } = useWorkspaces(token, user);

  React.useEffect(() => {
    loadStoredAuth().then(({ token, user }) => {
      setToken(token);
      setUser(user);
      setAuthReady(true);
    });
  }, []);

  const login = async (token, user) => {
    if (typeof window !== 'undefined' && window.xensembleDesktopAPI) {
      await window.xensembleDesktopAPI.setAccessToken(token);
    } else {
      localStorage.setItem('token', token);
    }
    localStorage.setItem('user', JSON.stringify(user));
    setToken(token);
    setUser(user);
    navigate('/sessions');
  };

  const logout = async () => {
    if (typeof window !== 'undefined' && window.xensembleDesktopAPI) {
      await window.xensembleDesktopAPI.clearTokens();
    } else {
      localStorage.removeItem('token');
    }
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  if (!authReady) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-50">
        <div className="text-sm text-zinc-500">Loading…</div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      <TerminalThemeProvider token={token}>
        <div className="h-full">
          <Routes>
          <Route path="/login" element={!token ? <Login /> : <Navigate to="/sessions" />} />

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
          </Route>

          <Route path="/settings" element={<Navigate to="/sessions" replace />} />

          <Route path="/admin/platform" element={<Navigate to="/sessions" replace />} />

          <Route path="*" element={<Navigate to={token ? '/sessions' : '/login'} />} />
        </Routes>
        </div>
      </TerminalThemeProvider>
    </AuthContext.Provider>
  );
}

export default App;
