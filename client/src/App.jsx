import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { TerminalSquare } from 'lucide-react';
import Login from './pages/Login';
import Console from './pages/Console';
import Settings from './pages/Settings';
import AgentsAdmin from './pages/AgentsAdmin';

export const AuthContext = React.createContext(null);

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
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

  // Layout for authenticated pages
  const Shell = ({ children }) => (
    <div className="h-full flex flex-col font-sans bg-zinc-50">
      <header className="flex-none bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900">
          <TerminalSquare className="w-5 h-5" />
          <span className="font-bold text-lg tracking-tight">Agent Console</span>
        </div>
        <nav className="text-sm font-medium text-zinc-500 flex gap-6 items-center">
          <Link to="/console" className={`hover:text-black ${location.pathname === '/console' ? 'text-zinc-900' : ''}`}>Sessions</Link>
          <Link to="/settings" className={`hover:text-black ${location.pathname === '/settings' ? 'text-zinc-900' : ''}`}>Vault & Settings</Link>
          {user?.role === 'admin' && (
            <Link to="/admin/agents" className={`hover:text-black ${location.pathname === '/admin/agents' ? 'text-zinc-900' : ''}`}>Registry</Link>
          )}
          <div className="w-px h-4 bg-zinc-300"></div>
          <button onClick={logout} className="hover:text-black">Logout ({user?.username})</button>
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-8 flex flex-col max-w-[1600px] w-full mx-auto gap-6">
        {children}
      </main>
    </div>
  );

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      <Routes>
        <Route path="/login" element={!token ? <Login /> : <Navigate to="/console" />} />
        
        <Route path="/console" element={
          token ? <Shell><Console /></Shell> : <Navigate to="/login" />
        } />
        
        <Route path="/settings" element={
          token ? <Shell><Settings /></Shell> : <Navigate to="/login" />
        } />

        <Route path="/admin/agents" element={
          token && user?.role === 'admin' ? <Shell><AgentsAdmin /></Shell> : <Navigate to="/console" />
        } />

        <Route path="*" element={<Navigate to={token ? "/console" : "/login"} />} />
      </Routes>
    </AuthContext.Provider>
  );
}

export default App;
