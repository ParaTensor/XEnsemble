import React, { useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Console from './pages/Console';
import AgentsAdmin from './pages/AgentsAdmin';
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

  const Shell = ({ children, compactMain = false }) => (
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
                <Link to="/admin/agents" className={navLinkClass('/admin/agents')}>
                  Registry
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
          'mx-auto flex w-full flex-1 flex-col overflow-auto',
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
      <Routes>
        <Route path="/login" element={!token ? <Login /> : <Navigate to="/console" />} />

        <Route
          path="/console"
          element={token ? <Shell compactMain><Console /></Shell> : <Navigate to="/login" />}
        />

        <Route path="/settings" element={<Navigate to="/console" replace />} />

        <Route
          path="/admin/agents"
          element={
            token && user?.role === 'admin' ? (
              <Shell><AgentsAdmin /></Shell>
            ) : (
              <Navigate to="/console" />
            )
          }
        />

        <Route path="*" element={<Navigate to={token ? '/console' : '/login'} />} />
      </Routes>
    </AuthContext.Provider>
  );
}

export default App;
