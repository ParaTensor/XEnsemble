import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../App';
import Button from '../Button';
import Input, { FormLabel } from '../Input';
import { useToast } from '../Toast';
import { consoleSectionLabelClass } from '../../lib/consoleTheme';
import { apiFetch } from '../../lib/api.ts';

export default function GitHubSettingsPanel() {
  const { user } = useContext(AuthContext);
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const isAdmin = user?.role === 'admin';

  const loadSettings = () => {
    setError(null);
    setSettings(null);
    apiFetch('/api/v1/admin/platform-settings')
      .then(async (res) => {
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        setSettings(data);
      })
      .catch((err) => {
        setSettings(null);
        setError(err.message || 'Failed to load settings');
      });
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadSettings();
  }, [isAdmin]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/v1/admin/platform-settings', {
        method: 'PUT',
        body: JSON.stringify({
          GITHUB_CLIENT_ID: settings.GITHUB_CLIENT_ID || '',
          GITHUB_CLIENT_SECRET: settings.GITHUB_CLIENT_SECRET || '',
          GITHUB_CALLBACK_URL: settings.GITHUB_CALLBACK_URL || '',
          GITHUB_API_BASE: settings.GITHUB_API_BASE || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettings(data);
      showToast('success', 'GitHub settings saved.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const isConfigured = Boolean(
    settings?.GITHUB_CLIENT_ID
      && settings?.GITHUB_CLIENT_SECRET
      && settings?.GITHUB_CALLBACK_URL,
  );

  if (isAdmin) {
    if (error) {
      return (
        <div className="space-y-4">
          <h3 className={consoleSectionLabelClass}>GitHub OAuth App</h3>
          <p className="text-sm text-red-600">{error}</p>
          <Button type="button" size="md" onClick={loadSettings}>Retry</Button>
        </div>
      );
    }

    if (!settings) {
      return <p className="text-sm text-[#5F6368]">Loading…</p>;
    }

    return (
      <form onSubmit={handleSave} className="h-full flex flex-col">
        <div className="flex-1 min-h-0 space-y-4">
          <div>
            <h3 className={consoleSectionLabelClass}>GitHub OAuth App</h3>
            <p className="text-xs text-[#5F6368] mt-1">
              Configure the GitHub OAuth App used for repository import and pull requests.
            </p>
          </div>

          <div className="space-y-2">
            <FormLabel htmlFor="github-client-id">Client ID</FormLabel>
            <Input
              id="github-client-id"
              value={settings.GITHUB_CLIENT_ID || ''}
              onChange={(e) => setSettings({ ...settings, GITHUB_CLIENT_ID: e.target.value })}
              placeholder="Ov23li…"
              className="h-8 py-1"
            />
          </div>

          <div className="space-y-2">
            <FormLabel htmlFor="github-client-secret">Client Secret</FormLabel>
            <Input
              id="github-client-secret"
              type="password"
              value={settings.GITHUB_CLIENT_SECRET || ''}
              onChange={(e) => setSettings({ ...settings, GITHUB_CLIENT_SECRET: e.target.value })}
              placeholder="••••••••"
              className="h-8 py-1"
            />
          </div>

          <div className="space-y-2">
            <FormLabel htmlFor="github-callback-url">Callback URL</FormLabel>
            <Input
              id="github-callback-url"
              value={settings.GITHUB_CALLBACK_URL || ''}
              onChange={(e) => setSettings({ ...settings, GITHUB_CALLBACK_URL: e.target.value })}
              placeholder="https://app.example.com/api/v1/github/callback"
              className="h-8 py-1 font-mono"
            />
          </div>

          <div className="space-y-2">
            <FormLabel htmlFor="github-api-base">API Base</FormLabel>
            <Input
              id="github-api-base"
              value={settings.GITHUB_API_BASE || ''}
              onChange={(e) => setSettings({ ...settings, GITHUB_API_BASE: e.target.value })}
              placeholder="https://api.github.com"
              className="h-8 py-1 font-mono"
            />
          </div>
        </div>

        <div className="pt-4 flex justify-end shrink-0">
          <Button type="submit" size="md" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className={consoleSectionLabelClass}>GitHub</h3>
      <p className="text-sm text-[#5F6368]">
        GitHub integration is
        {' '}
        <span className={isConfigured ? 'text-green-700 font-medium' : 'text-[#5F6368]'}>
          {isConfigured ? 'configured' : 'not configured'}
        </span>
        .
      </p>
      <p className="text-xs text-[#5F6368]">
        Ask an administrator to set up the GitHub OAuth App in platform settings.
      </p>
    </div>
  );
}
