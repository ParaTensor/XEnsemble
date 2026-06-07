import React, { useState, useContext } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate, Outlet } from 'react-router-dom';
import Login from './pages/Login';
import Console from './pages/Console';
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
    navigate('/console');
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
      'text-sm font-medium transition-colors',
      location.pathname === path ? consoleNavActiveClass : consoleNavIdleClass,
    );

  /** Keeps Console mounted (hidden off-route) so terminal WebSocket sessions stay alive. */
  function AuthenticatedLayout() {
    const { user: authUser } = useContext(AuthContext);
    const isConsole = location.pathname === '/console';
    const isAdminRoute = location.pathname.startsWith('/admin');

    return (
      <Shell compactMain={isConsole} adminPage={isAdminRoute && !isConsole}>
        <div
          className={cn('flex min-h-0 flex-1 flex-col', !isConsole && 'hidden')}
          aria-hidden={!isConsole}
        >
          <Console />
        </div>
        {!isConsole && (
          <div className="flex min-h-0 flex-1 flex-col">
            <Outlet context={{ user: authUser }} />
          </div>
        )}
      </Shell>
    );
  }

  const Shell = ({ children, compactMain = false, adminPage = false }) => (
    <div className="h-full flex flex-col bg-zinc-50">
      <header className="sticky top-0 z-50 flex-none border-b border-zinc-200 bg-white">
        <div className={cn('mx-auto flex h-14 items-center justify-between', APP_SHELL_MAX_CLASS, APP_SHELL_PAD_CLASS)}>
          <Link to="/console" className="flex items-center gap-2.5 text-zinc-900">
            <BrandMark className="h-8 w-8" />
            <span className="text-lg font-bold tracking-tight text-black">XEnsemble</span>
          </Link>
          <nav className="flex items-center gap-6">
            {user?.role === 'admin' && (
              <>
                <Link to="/admin/users" className={navLinkClass('/admin/users')}>
                  Users
                </Link>
                <Link to="/admin/agents" className={navLinkClass('/admin/agents')}>
                  Agents
                </Link>
                <div className="h-4 w-px bg-zinc-300" />
              </>
            )}
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
          adminPage
            ? 'min-h-0 overflow-auto console-scroll-hidden'
            : compactMain
              ? 'min-h-0 overflow-hidden'
              : 'overflow-auto',
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
        <Route path="/login" element={!token ? <Login /> : <Navigate to="/console" />} />

        <Route
          element={token ? <AuthenticatedLayout /> : <Navigate to="/login" replace />}
        >
          <Route path="/console" element={null} />
          <Route
            path="/admin/agents"
            element={user?.role === 'admin' ? <AgentsAdmin /> : <Navigate to="/console" replace />}
          />
          <Route
            path="/admin/users"
            element={user?.role === 'admin' ? <UsersAdmin /> : <Navigate to="/console" replace />}
          />
        </Route>

        <Route path="/settings" element={<Navigate to="/console" replace />} />

        <Route path="/admin/platform" element={<Navigate to="/console" replace />} />

        <Route path="*" element={<Navigate to={token ? '/console' : '/login'} />} />
      </Routes>
      </div>
    </AuthContext.Provider>
  );
}

export default App;
