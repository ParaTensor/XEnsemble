import React, { useState, useContext } from 'react';
import { AuthContext } from '../App';
import { TerminalSquare } from 'lucide-react';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const { login } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const res = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      login(data.token, data.user);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="h-full bg-zinc-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-zinc-200 shadow-sm p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 bg-black text-white rounded-lg flex items-center justify-center mb-2">
            <TerminalSquare className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900">{isRegister ? 'Create an Account' : 'Welcome back'}</h1>
          <p className="text-sm text-zinc-500">Sign in to manage your enterprise agents</p>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-2 rounded-md">{error}</div>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 uppercase">Username</label>
            <input 
              required
              type="text" 
              className="w-full h-9 px-3 border border-zinc-200 rounded-md focus:border-black focus:ring-1 focus:ring-black text-sm"
              value={username} onChange={e => setUsername(e.target.value)} 
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-700 uppercase">Password</label>
            <input 
              required
              type="password" 
              className="w-full h-9 px-3 border border-zinc-200 rounded-md focus:border-black focus:ring-1 focus:ring-black text-sm"
              value={password} onChange={e => setPassword(e.target.value)} 
            />
          </div>
          <button type="submit" className="w-full h-9 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800 mt-2">
            {isRegister ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <div className="text-center text-sm text-zinc-500">
          {isRegister ? 'Already have an account?' : 'New here?'}
          <button onClick={() => setIsRegister(!isRegister)} className="ml-1 text-black font-medium hover:underline">
            {isRegister ? 'Sign In' : 'Create an account'}
          </button>
        </div>
      </div>
    </div>
  );
}
