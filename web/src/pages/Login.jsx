import { useState, useContext } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthContext } from '../App';
import BrandMark from '../components/BrandMark';
import { publicFetch } from '../lib/api';
import Button from '../components/Button';
import Input from '../components/Input';
import { cn } from '../lib/utils';
import { consoleCardClass, consoleSectionLabelClass } from '../lib/consoleTokens';

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setError(null);
    setIsLoading(true);
    try {
      const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const res = await publicFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'account_pending') throw new Error('Your account is pending administrator approval.');
        if (data.code === 'account_suspended') throw new Error('Your account has been suspended.');
        throw new Error(data.error || 'Authentication failed. Please try again.');
      }
      if (isRegister && !data.access_token) {
        setError(data.message || 'Registration submitted. Await administrator approval.');
        setIsRegister(false);
        return;
      }
      if (!data.access_token || !data.refresh_token) {
        setError('Server returned incomplete credentials');
        return;
      }
      login(data.access_token, data.refresh_token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-zinc-50 p-4">
      <div className={cn(consoleCardClass, 'w-full max-w-sm p-8 flex flex-col gap-6')}>
        <div className="flex flex-col items-center gap-2">
          <BrandMark className="mb-2 h-10 w-10" iconClassName="h-5 w-5" />
          <h1 className="text-xl font-bold tracking-tight text-zinc-900">
            {isRegister ? 'Create an Account' : 'Welcome back'}
          </h1>
          <p className="text-center text-sm text-zinc-500">
            Sign in to manage your enterprise agents
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

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
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isLoading
              ? (isRegister ? 'Creating account…' : 'Signing in…')
              : (isRegister ? 'Sign Up' : 'Sign In')}
          </Button>
        </form>

        <div className="text-center text-sm text-zinc-500">
          {isRegister ? 'Already have an account?' : 'New here?'}
          <button
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            className="ml-1 font-medium text-zinc-900 hover:underline"
          >
            {isRegister ? 'Sign In' : 'Create an account'}
          </button>
        </div>
      </div>
    </div>
  );
}
