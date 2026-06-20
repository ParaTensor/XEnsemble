import React, { useState, useContext } from 'react';
import { AuthContext } from '../App';
import BrandMark from '../components/BrandMark';
import Button from '../components/Button';
import Input from '../components/Input';
import { useToast } from '../components/Toast';
import { consoleSectionLabelClass } from '../lib/consoleTheme';
import { getApiBase } from '../lib/api.ts';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useContext(AuthContext);
  const { showToast } = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    try {
      const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const res = await fetch(`${getApiBase()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const contentType = res.headers.get('content-type') || '';
      let data;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server returned ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
      }

      if (!res.ok) {
        if (data.code === 'account_pending') {
          showToast('error', 'Your account is pending administrator approval.');
          return;
        }
        if (data.code === 'account_suspended') {
          showToast('error', 'Your account has been suspended.');
          return;
        }
        const msg = data.error || '';
        if (msg.toLowerCase().includes('invalid credentials')) {
          showToast('error', 'Incorrect username or password. Switching to sign up.');
          setIsRegister(true);
          return;
        }
        throw new Error(msg || `Server error ${res.status}`);
      }

      if (isRegister && !data.access_token) {
        showToast('success', data.message || 'Registration submitted. Await administrator approval.');
        setIsRegister(false);
        return;
      }
      if (!data.access_token || !data.refresh_token) {
        throw new Error('Server returned incomplete credentials');
      }
      login(data.access_token, data.refresh_token, data.user);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-[#F4F5F6] p-4">
      <div className="w-full max-w-sm rounded-lg border border-[#E8EAED] bg-white p-8 shadow-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2">
          <BrandMark className="mb-2 h-10 w-10" iconClassName="h-5 w-5" />
          <h1 className="text-xl font-bold tracking-tight text-[#202124]">
            {isRegister ? 'Create an Account' : 'Welcome back'}
          </h1>
          <p className="text-center text-sm text-[#5F6368]">
            Sign in to manage your enterprise agents
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1">
            <label className={consoleSectionLabelClass}>Username</label>
            <Input
              required
              type="text"
              className="h-9 py-1.5"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={consoleSectionLabelClass}>Password</label>
            <Input
              required
              type="password"
              className="h-9 py-1.5"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={isLoading} className="mt-2 w-full">
            {isLoading
              ? (isRegister ? 'Creating account…' : 'Signing in…')
              : (isRegister ? 'Sign Up' : 'Sign In')}
          </Button>
        </form>

        <div className="text-center text-sm text-[#5F6368]">
          {isRegister ? 'Already have an account?' : 'New here?'}
          <button
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            className="ml-1 font-medium text-[#202124] hover:underline"
          >
            {isRegister ? 'Sign In' : 'Create an account'}
          </button>
        </div>
      </div>
    </div>
  );
}
