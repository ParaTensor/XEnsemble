import React, { useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AgentsAdmin from './pages/AgentsAdmin';
import UsersAdmin from './pages/UsersAdmin';
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

export const AuthContext = React.createContext(null);

const ADMIN_PATHS = ['/admin/agents', '/admin/users'];

function DesktopClientMessage() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center text-center text-zinc-500"
      role="status"
    >
      <p className="text-lg font-medium">Please use the XEnsemble Desktop Client.</p>
      <p className="text-sm">Web Console is available to administrators only.</p>
    </div>
  );
}

function AdminRoute({ user, children }) {
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

function Shell({ children, isAdmin, user, onLogout, setShowSettingsModal, compactMain = false }) {
  const location = useLocation();

  const navLinkClass = (path) =>
    cn(
      'rounded-full px-3 py-1.5 text-sm font-medium transition-all',
      location.pathname === path ? consoleNavActiveClass : consoleNavIdleClass,
    );

  return (
    <div className="h-full flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-50 flex-none border-b border-zinc-200 bg-white">
        <div className={cn('mx-auto flex h-14 items-center justify-between', APP_SHELL_MAX_CLASS, APP_SHELL_PAD_CLASS)}>
          <Link to={isAdmin ? '/admin/agents' : '/'} className="flex items-center gap-2.5 text-zinc-900">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-bold tracking-tight text-black">XEnsemble</span>
          </Link>
          <nav className="flex items-center gap-6">
            {isAdmin &&
              ADMIN_PATHS.map((path) => (
                <Link key={path} to={path} className={navLinkClass(path)}>
                  {path === '/admin/agents' ? 'Agents' : 'Users'}
                </Link>
              ))}
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
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const login = (token, user) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(token);
    setUser(user);
    navigate(user?.role === 'admin' ? '/admin/agents' : '/');
  };

  const logout = () => {
    localStorage.removeItem('token');
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
          <Route path="/login" element={!token ? <Login /> : <Navigate to="/" replace />} />
          <Route
            path="/"
            element={
              token ? (
                isAdmin ? (
                  <Navigate to="/admin/agents" replace />
                ) : (
                  <DesktopClientMessage />
                )
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
            path="/sessions"
            element={<Navigate to={token && isAdmin ? '/admin/agents' : '/'} replace />}
          />
          <Route
            path="/console"
            element={<Navigate to={token && isAdmin ? '/admin/agents' : '/'} replace />}
          />
          <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
        </Routes>
      </div>
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
    </AuthContext.Provider>
  );
}

export default App;
