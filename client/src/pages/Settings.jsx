import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../App';
import { Key } from 'lucide-react';

export default function Settings() {
  const { token } = useContext(AuthContext);
  const [secrets, setSecrets] = useState({
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    LLM_ROUTER_URL: ''
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/v1/secrets', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      setSecrets(prev => ({ ...prev, ...data }));
    });
  }, [token]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('http://localhost:3000/api/v1/secrets', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(secrets)
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Vault updated successfully.' });
      } else {
        setMessage({ type: 'error', text: 'Failed to update vault.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Vault & Settings</h1>
        <p className="text-sm text-zinc-500">Manage your encrypted environment variables and platform settings.</p>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="border-b border-zinc-200 px-6 py-4 flex items-center gap-2 bg-zinc-50">
          <Key className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900">API Keys Vault</h2>
        </div>
        <div className="p-6">
          <p className="text-sm text-zinc-600 mb-6">
            These keys are encrypted in the database using AES-256-GCM. They will be automatically injected into the agent's restricted workspace when launched.
          </p>

          {message && (
            <div className={`mb-4 p-3 rounded-md text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {message.text}
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            {Object.keys(secrets).map(key => (
              <div key={key}>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1">{key}</label>
                <input 
                  type={key.includes('KEY') ? 'password' : 'text'}
                  className="w-full h-9 px-3 border border-zinc-200 rounded-md focus:border-black focus:ring-1 focus:ring-black text-sm font-mono"
                  value={secrets[key] || ''}
                  onChange={e => setSecrets({...secrets, [key]: e.target.value})}
                  placeholder={`Enter ${key}`}
                />
              </div>
            ))}
            
            <div className="pt-4 flex justify-end">
              <button 
                type="submit"
                disabled={saving}
                className="h-9 px-4 bg-black text-white rounded-md text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Secrets'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
