import React, { useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Sessions from './pages/Sessions';
import AgentsAdmin from './pages/AgentsAdmin';
import UsersAdmin from './pages/UsersAdmin';
import GatewayAdmin from './pages/GatewayAdmin';
import UserMenu from './components/UserMenu';
import BrandMark from './components/BrandMark';
import SettingsModal from './components/SettingsModal';
import {
  APP_SHELL_MAX_CLASS,
  APP_SHELL_PAD_CLASS,
  APP_SHELL_MAIN_PY_CLASS,
  APP_SHELL_CONSOLE_PY_CLASS,
} from './lib/appShellLayout';
import { cn } from './lib/utils';
import { consoleNavActiveClass, consoleNavIdleClass } from './lib/consoleTokens';
import { getAccessToken, setTokens, clearTokens } from './lib/api';

export const AuthContext = React.createContext(null);

const ADMIN_PATHS = ['/admin/agents', '/admin/users', '/admin/gateway'];

function AdminRoute({ user, children }) {
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

function Shell({ children, isAdmin, user, onLogout, setShowSettingsModal, compactMain = false }) {
  const location = useLocation();

  const isSessionsActive = location.pathname === '/sessions';
  const navLinkClass = (path) =>
    cn(
      'rounded-full px-3 py-1.5 text-sm font-medium transition-all',
      (path === '/sessions' ? isSessionsActive : location.pathname === path)
        ? consoleNavActiveClass
        : consoleNavIdleClass,
    );

  return (
    <div className="h-full flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-50 flex-none border-b border-zinc-200 bg-white">
        <div className={cn('mx-auto flex h-14 items-center justify-between', APP_SHELL_MAX_CLASS, APP_SHELL_PAD_CLASS)}>
          <Link to="/sessions" className="flex items-center gap-2.5 text-zinc-900">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-bold tracking-tight text-black">XEnsemble</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link to="/sessions" className={navLinkClass('/sessions')}>
              Sessions
            </Link>
            {isAdmin &&
              ADMIN_PATHS.map((path) => {
                const label =
                  path === '/admin/agents'
                    ? 'Agents'
                    : path === '/admin/users'
                      ? 'Users'
                      : 'Gateway';
                return (
                  <Link key={path} to={path} className={navLinkClass(path)}>
                    {label}
                  </Link>
                );
              })}
            <div className="h-4 w-px bg-zinc-300" />
            <UserMenu
              username={user?.username}
              onLogout={onLogout}
              onOpenSettings={() => setShowSettingsModal(true)}
            />
          </nav>
        </div>
      </header>
      <main
        className={cn(
          'mx-auto flex w-full flex-1 flex-col',
          compactMain ? 'min-h-0 overflow-hidden' : 'overflow-auto',
          APP_SHELL_MAX_CLASS,
          APP_SHELL_PAD_CLASS,
          compactMain ? APP_SHELL_CONSOLE_PY_CLASS : APP_SHELL_MAIN_PY_CLASS,
        )}
      >
        {children}
      </main>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(getAccessToken());
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user'));
    } catch {
      return null;
    }
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const login = (accessToken, refreshToken, userData) => {
    setTokens(accessToken, refreshToken);
    localStorage.setItem('user', JSON.stringify(userData));
    setToken(accessToken);
    setUser(userData);
    navigate(userData?.role === 'admin' ? '/admin/agents' : '/sessions');
  };

  const logout = () => {
    clearTokens();
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    navigate('/login');
  };

  const adminShell = (page) => (
    <Shell
      isAdmin={isAdmin}
      user={user}
      onLogout={logout}
      setShowSettingsModal={setShowSettingsModal}
      compactMain
    >
      {page}
    </Shell>
  );

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      <div className="h-full">
        <Routes>
          <Route
            path="/login"
            element={!token ? <Login /> : <Navigate to={isAdmin ? '/admin/agents' : '/sessions'} replace />}
          />
          <Route
            path="/"
            element={<Navigate to={token ? '/sessions' : '/login'} replace />}
          />
          <Route
            path="/console"
            element={<Navigate to={token ? '/sessions' : '/login'} replace />}
          />
          <Route
            path="/sessions"
            element={
              token ? (
                <Shell
                  isAdmin={isAdmin}
                  user={user}
                  onLogout={logout}
                  setShowSettingsModal={setShowSettingsModal}
                  compactMain
                >
                  <Sessions />
                </Shell>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/admin/agents"
            element={
              token ? (
                <AdminRoute user={user}>
                  {adminShell(<AgentsAdmin />)}
                </AdminRoute>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/admin/users"
            element={
              token ? (
                <AdminRoute user={user}>
                  {adminShell(<UsersAdmin />)}
                </AdminRoute>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/admin/gateway"
            element={
              token ? (
                <AdminRoute user={user}>
                  {adminShell(<GatewayAdmin />)}
                </AdminRoute>
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to={token ? '/sessions' : '/login'} replace />} />
        </Routes>
      </div>
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
    </AuthContext.Provider>
  );
}

export default App;
