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

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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

  const navLinkClass = (path) =>
    cn(
      'rounded-full px-3 py-1.5 text-sm font-medium transition-all',
      location.pathname === path ? consoleNavActiveClass : consoleNavIdleClass,
    );

  /** Admin-only authenticated layout. Normal users should use the Desktop Client. */
  function AuthenticatedLayout() {
    const ADMIN_PATHS = ['/admin/agents', '/admin/users'];
    return (
      <Shell compactMain>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {user?.role === 'admin' && location.pathname === ADMIN_PATHS[0] && (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden">
              <AgentsAdmin />
            </div>
          )}
          {user?.role === 'admin' && location.pathname === ADMIN_PATHS[1] && (
            <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-auto console-scroll-hidden">
              <UsersAdmin />
            </div>
          )}
          {!ADMIN_PATHS.includes(location.pathname) && (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-zinc-500">
              <p className="text-lg font-medium">Please use the XEnsemble Desktop Client.</p>
              <p className="text-sm">Web Console is available to administrators only.</p>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  const Shell = ({ children, compactMain = false }) => (
    <div className="h-full flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-50 flex-none border-b border-zinc-200 bg-white">
        <div className={cn('mx-auto flex h-14 items-center justify-between', APP_SHELL_MAX_CLASS, APP_SHELL_PAD_CLASS)}>
          <Link to="/sessions" className="flex items-center gap-2.5 text-zinc-900">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-bold tracking-tight text-black">XEnsemble</span>
          </Link>
          <nav className="flex items-center gap-6">
            {user?.role !== 'admin' && (
              <Link to="/sessions" className={navLinkClass('/sessions')}>
                Sessions
              </Link>
            )}
            {user?.role === 'admin' && (
              <>
                <Link to="/admin/users" className={navLinkClass('/admin/users')}>
                  Users
                </Link>
                <Link to="/admin/agents" className={navLinkClass('/admin/agents')}>
                  Agents
                </Link>
              </>
            )}
            <div className="h-4 w-px bg-zinc-300" />
            <UserMenu
              username={user?.username}
              onLogout={logout}
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
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
    </div>
  );

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      <div className="h-full">
        <Routes>
          <Route path="/login" element={!token ? <Login /> : <Navigate to="/" />} />
          <Route element={token ? <AuthenticatedLayout /> : <Navigate to="/login" replace />}>
            <Route path="/" element={null} />
            <Route path="/sessions" element={null} />
            <Route path="/console" element={null} />
            <Route
              path="/admin/agents"
              element={user?.role === 'admin' ? null : <Navigate to="/" replace />}
            />
            <Route
              path="/admin/users"
              element={user?.role === 'admin' ? null : <Navigate to="/" replace />}
            />
          </Route>
          <Route path="*" element={<Navigate to={token ? '/' : '/login'} />} />
        </Routes>
      </div>
    </AuthContext.Provider>
  );
}

export default App;
