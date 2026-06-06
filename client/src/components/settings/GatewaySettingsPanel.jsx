import React, { useState, useEffect, useContext, useCallback } from 'react';
import { Plus, Settings2, Play, Square, RefreshCw, Loader2, Pencil, Trash2, Activity, List } from 'lucide-react';
import { AuthContext } from '../../App';
import Button from '../Button';
import Input from '../Input';
import MaskedApiKeyInput from '../MaskedApiKeyInput';
import { ConsoleDialogShell } from '../ConsoleDialog';
import { useToast } from '../Toast';
import { consoleDialogMdClass, consoleIconButtonClass, consoleIconButtonDangerClass } from '../../lib/consoleTokens';

const API = 'http://localhost:3000';

const NESTED_DIALOG_BACKDROP = 'z-[110]';
const NESTED_DIALOG_SHELL =
  'fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none';

const EMPTY_PROVIDER = {
  name: '',
  base_url: '',
  api_key: '',
  default_model: '',
  models: '',
};

function modelsToText(models) {
  return Array.isArray(models) ? models.join('\n') : '';
}

function textToModels(text) {
  return text
    .split(/[\n,]+/)
    .map((m) => m.trim())
    .filter(Boolean);
}

function splitBindAddr(bindAddr) {
  const trimmed = String(bindAddr || '').trim();
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0) return { host: '127.0.0.1', port: '8741' };
  return {
    host: trimmed.slice(0, lastColon),
    port: trimmed.slice(lastColon + 1),
  };
}

function connectionIconColor(health, testing) {
  if (testing || health?.status === 'testing') return 'text-zinc-500';
  if (health?.status === 'ok') return 'text-green-600';
  if (health?.status === 'error') return 'text-red-600';
  return 'text-zinc-500';
}

function TestConnectionButton({
  health,
  testing,
  disabled,
  onClick,
  iconClassName = 'w-3.5 h-3.5',
  title = 'Verify provider',
}) {
  const busy = testing || health?.status === 'testing';
  const label = busy ? 'Verifying provider' : title;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className={`${consoleIconButtonClass} ${connectionIconColor(health, testing)}`}
      title={label}
      aria-label={label}
    >
      {busy ? (
        <Loader2 className={`${iconClassName} animate-spin`} />
      ) : (
        <Activity className={iconClassName} />
      )}
    </button>
  );
}

function FetchModelsButton({ fetching, disabled, onClick, iconClassName = 'w-3.5 h-3.5' }) {
  const label = fetching ? 'Fetching models' : 'Fetch models';
  return (
    <button
      type="button"
      disabled={disabled || fetching}
      onClick={onClick}
      className={`${consoleIconButtonClass} text-zinc-600`}
      title={label}
      aria-label={label}
    >
      {fetching ? (
        <Loader2 className={`${iconClassName} animate-spin`} />
      ) : (
        <List className={iconClassName} />
      )}
    </button>
  );
}

function formatTestTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function ProviderStatusBadge({ health }) {
  if (!health || health.status === 'unknown') {
    return <span className="text-xs text-zinc-400">Not verified</span>;
  }
  if (health.status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        Verifying…
      </span>
    );
  }
  if (health.status === 'ok') {
    const testedAt = formatTestTime(health.tested_at);
    return (
      <span
        className="text-xs text-green-700 font-medium"
        title={[health.message, testedAt && `Verified at ${testedAt}`].filter(Boolean).join('\n')}
      >
        Available
        {health.latency_ms != null ? ` · ${health.latency_ms}ms` : ''}
        {testedAt ? ` · ${testedAt}` : ''}
      </span>
    );
  }
  const testedAt = formatTestTime(health.tested_at);
  return (
    <span
      className="text-xs text-red-600 font-medium truncate"
      title={[health.message, testedAt && `Last verified at ${testedAt}`].filter(Boolean).join('\n')}
    >
      Unavailable
      {testedAt ? ` · ${testedAt}` : ''}
    </span>
  );
}

function resolveFormTestModel(form) {
  const fromDefault = String(form.default_model || '').trim();
  if (fromDefault) return fromDefault;
  return textToModels(form.models)[0] || '';
}

function usesSavedApiKey(dialog) {
  return Boolean(dialog?.mode === 'edit' && dialog.apiKeySaved && !dialog.apiKeyDirty);
}

function getEffectiveApiKey(dialog) {
  if (!dialog) return '';
  if (dialog.apiKeyRevealed && dialog.apiKeyFull) return String(dialog.apiKeyFull).trim();
  return String(dialog.form?.api_key || '').trim();
}

function hasApiKeyForActions(dialog) {
  if (!dialog) return false;
  if (usesSavedApiKey(dialog)) return true;
  return Boolean(getEffectiveApiKey(dialog));
}

function ProviderFormFields({
  form,
  onChange,
  isEdit,
  apiKeyMasked,
  apiKeyRevealed,
  apiKeyCanToggle,
  onApiKeyChange,
  onToggleApiKeyReveal,
  hasApiKey,
  onFetchModels,
  fetchingModels,
  onTestConnection,
  testingConnection,
  connectionHealth,
}) {
  return (
    <div className="space-y-3">
      {!isEdit && (
        <Input
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name"
          aria-label="Name"
        />
      )}
      <Input
        value={form.base_url}
        onChange={(e) => onChange({ base_url: e.target.value })}
        placeholder="Base URL"
        aria-label="Base URL"
      />
      <MaskedApiKeyInput
        value={form.api_key}
        maskedPreview={apiKeyMasked}
        revealed={apiKeyRevealed}
        canToggle={apiKeyCanToggle}
        onToggleReveal={onToggleApiKeyReveal}
        onChange={onApiKeyChange}
        placeholder="API Key"
      />
      <Input
        value={form.default_model}
        onChange={(e) => onChange({ default_model: e.target.value })}
        placeholder="Default model"
        aria-label="Default model"
      />
      <div className="flex justify-end gap-0.5">
        <TestConnectionButton
          health={connectionHealth}
          testing={testingConnection}
          disabled={
            !form.base_url.trim()
            || !hasApiKey
            || (!resolveFormTestModel(form) && !isEdit)
          }
          onClick={onTestConnection}
        />
        <FetchModelsButton
          fetching={fetchingModels}
          disabled={!form.base_url.trim() || !hasApiKey}
          onClick={onFetchModels}
        />
      </div>
      <textarea
        value={form.models}
        onChange={(e) => onChange({ models: e.target.value })}
        rows={3}
        placeholder={'Models (one per line)\ndeepseek-chat\ndeepseek-reasoner'}
        aria-label="Models"
        className="w-full rounded-md border border-zinc-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black"
      />
    </div>
  );
}

export default function GatewaySettingsPanel() {
  const { token } = useContext(AuthContext);
  const { showToast } = useToast();

  const [status, setStatus] = useState(null);
  const [processConfig, setProcessConfig] = useState({ host: '127.0.0.1', port: '8741', auto_start: true });
  const [envBindLocked, setEnvBindLocked] = useState(false);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processSaving, setProcessSaving] = useState(false);
  const [processAction, setProcessAction] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [processDialogOpen, setProcessDialogOpen] = useState(false);
  const [processDraft, setProcessDraft] = useState(null);
  const [providerDialog, setProviderDialog] = useState(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [providerHealth, setProviderHealth] = useState({});
  const [testingProvider, setTestingProvider] = useState(null);
  const [formConnectionHealth, setFormConnectionHealth] = useState({ status: 'unknown' });

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const nestedDialogOpen = processDialogOpen || Boolean(providerDialog);

  useEffect(() => {
    if (!nestedDialogOpen) return;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setProcessDialogOpen(false);
      setProviderDialog(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [nestedDialogOpen]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statusRes, configRes, providersRes] = await Promise.all([
        fetch(`${API}/api/v1/admin/gateway/status`, { headers: authHeaders }),
        fetch(`${API}/api/v1/admin/gateway/config`, { headers: authHeaders }),
        fetch(`${API}/api/v1/admin/gateway/providers`, { headers: authHeaders }),
      ]);
      const statusData = await statusRes.json();
      const configData = configRes.ok ? await configRes.json() : null;
      const providersData = providersRes.ok ? await providersRes.json() : null;
      setStatus(statusData);
      if (configData) {
        const { host, port } = splitBindAddr(configData.bind_addr || statusData.bindAddr);
        setProcessConfig({
          host,
          port,
          auto_start: configData.auto_start !== false,
        });
        setEnvBindLocked(Boolean(configData.env_bind_locked));
      } else if (statusData.bindAddr) {
        const { host, port } = splitBindAddr(statusData.bindAddr);
        setProcessConfig((prev) => ({ ...prev, host, port }));
      }
      setProviders(providersData?.data || []);
    } catch {
      showToast('error', 'Failed to load gateway settings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const runProviderTest = useCallback(async (name, { silent = false } = {}) => {
    if (!token || !name) return null;
    setProviderHealth((prev) => ({
      ...prev,
      [name]: { status: 'testing' },
    }));
    setTestingProvider(name);
    try {
      const res = await fetch(`${API}/api/v1/admin/gateway/providers/${encodeURIComponent(name)}/test`, {
        method: 'POST',
        headers: authHeaders,
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || data.error || 'Provider verification failed.');
      }
      const result = data.data || {};
      const next = {
        status: result.ok ? 'ok' : 'error',
        message: result.message,
        latency_ms: result.latency_ms,
        tested_at: Date.now(),
      };
      setProviderHealth((prev) => ({ ...prev, [name]: next }));
      if (!silent) {
        showToast(result.ok ? 'success' : 'error', result.message || (result.ok ? 'Provider available.' : 'Provider unavailable.'));
      }
      return next;
    } catch (err) {
      const next = { status: 'error', message: err.message, tested_at: Date.now() };
      setProviderHealth((prev) => ({ ...prev, [name]: next }));
      if (!silent) showToast('error', err.message);
      return next;
    } finally {
      setTestingProvider((current) => (current === name ? null : current));
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openProcessDialog = () => {
    setProcessDraft({ ...processConfig });
    setProcessDialogOpen(true);
  };

  const openAddProviderDialog = async () => {
    try {
      const statusRes = await fetch(`${API}/api/v1/admin/gateway/status`, { headers: authHeaders });
      const statusData = await statusRes.json();
      setStatus(statusData);
    } catch {
      /* keep current status */
    }
    setProviderDialog({
      mode: 'add',
      apiKeySaved: false,
      apiKeyMasked: '',
      apiKeyRevealed: false,
      apiKeyDirty: false,
      apiKeyFull: null,
      form: { ...EMPTY_PROVIDER },
    });
    setFormConnectionHealth({ status: 'unknown' });
  };

  const openEditProviderDialog = (provider) => {
    setFormConnectionHealth(providerHealth[provider.name] || { status: 'unknown' });
    setProviderDialog({
      mode: 'edit',
      apiKeySaved: Boolean(provider.has_api_key),
      apiKeyMasked: provider.api_key_masked || '',
      apiKeyRevealed: false,
      apiKeyDirty: false,
      apiKeyFull: null,
      form: {
        name: provider.name,
        base_url: provider.base_url || '',
        api_key: '',
        default_model: provider.default_model || '',
        models: modelsToText(provider.models),
      },
    });
  };

  const updateProviderForm = (patch) => {
    setProviderDialog((prev) => (prev ? { ...prev, form: { ...prev.form, ...patch } } : prev));
  };

  const handleApiKeyChange = (nextValue) => {
    setProviderDialog((prev) => {
      if (!prev) return prev;
      const replacingSaved = usesSavedApiKey(prev);
      return {
        ...prev,
        apiKeyDirty: true,
        apiKeyRevealed: replacingSaved ? true : prev.apiKeyRevealed,
        apiKeyFull: nextValue,
        form: { ...prev.form, api_key: nextValue },
      };
    });
  };

  const handleToggleApiKeyReveal = async () => {
    if (!providerDialog) return;
    if (providerDialog.apiKeyRevealed) {
      setProviderDialog((prev) => (prev ? { ...prev, apiKeyRevealed: false } : prev));
      return;
    }
    if (usesSavedApiKey(providerDialog) && !providerDialog.apiKeyFull) {
      try {
        const name = providerDialog.form.name.trim();
        const res = await fetch(`${API}/api/v1/admin/gateway/providers/${encodeURIComponent(name)}/api-key`, {
          headers: authHeaders,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load API Key.');
        }
        const apiKey = data.data?.api_key || '';
        setProviderDialog((prev) => (prev ? {
          ...prev,
          apiKeyRevealed: true,
          apiKeyFull: apiKey,
          form: { ...prev.form, api_key: apiKey },
        } : prev));
      } catch (err) {
        showToast('error', err.message);
      }
      return;
    }
    setProviderDialog((prev) => (prev ? { ...prev, apiKeyRevealed: true } : prev));
  };

  const handleTestConnection = async () => {
    if (!providerDialog) return;
    const { form } = providerDialog;
    if (!form.base_url.trim()) {
      showToast('error', 'Base URL is required.');
      return;
    }
    const testModel = resolveFormTestModel(form);
    if (!testModel && !usesSavedApiKey(providerDialog)) {
      showToast('error', 'Default model is required to verify provider.');
      return;
    }
    setTestingConnection(true);
    setFormConnectionHealth({ status: 'testing' });
    try {
      if (usesSavedApiKey(providerDialog)) {
        const result = await runProviderTest(form.name.trim(), { silent: true });
        if (result) setFormConnectionHealth(result);
        showToast(
          result?.status === 'ok' ? 'success' : 'error',
          result?.message || (result?.status === 'ok' ? 'Provider available.' : 'Provider unavailable.'),
        );
        return;
      }
      const apiKey = getEffectiveApiKey(providerDialog);
      if (!apiKey) {
        setFormConnectionHealth({ status: 'unknown' });
        showToast('error', 'API Key is required to verify provider.');
        return;
      }
      const res = await fetch(`${API}/api/v1/admin/gateway/providers/test`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          base_url: form.base_url.trim(),
          api_key: apiKey,
          default_model: form.default_model.trim(),
          models: textToModels(form.models),
          model: testModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Provider verification failed.');
      }
      const result = data.data || {};
      const testedAt = Date.now();
      const next = {
        status: result.ok ? 'ok' : 'error',
        message: result.message,
        latency_ms: result.latency_ms,
        tested_at: testedAt,
      };
      setFormConnectionHealth(next);
      showToast(
        result.ok ? 'success' : 'error',
        result.message || (result.ok ? 'Provider available.' : 'Provider unavailable.'),
      );
    } catch (err) {
      setFormConnectionHealth({ status: 'error', message: err.message, tested_at: Date.now() });
      showToast('error', err.message);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleFetchModels = async () => {
    if (!providerDialog) return;
    const { form } = providerDialog;
    if (!form.base_url.trim()) {
      showToast('error', 'Base URL is required.');
      return;
    }
    if (!hasApiKeyForActions(providerDialog)) {
      showToast('error', 'API Key is required to fetch models. Enter it above or fill the list manually.');
      return;
    }
    setFetchingModels(true);
    try {
      let res;
      if (usesSavedApiKey(providerDialog)) {
        res = await fetch(`${API}/api/v1/admin/gateway/providers/${encodeURIComponent(form.name.trim())}/fetch-models`, {
          method: 'POST',
          headers: authHeaders,
          body: '{}',
        });
      } else {
        res = await fetch(`${API}/api/v1/admin/gateway/providers/fetch-models`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            base_url: form.base_url.trim(),
            api_key: getEffectiveApiKey(providerDialog),
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch models.');
      }
      const models = data.data?.models || [];
      const patch = { models: models.join('\n') };
      if (!form.default_model.trim() && models.length > 0) {
        patch.default_model = models[0];
      }
      updateProviderForm(patch);
      showToast('success', `Fetched ${models.length} model${models.length === 1 ? '' : 's'}.`);
    } catch (err) {
      showToast('error', `${err.message} You can enter models manually.`);
    } finally {
      setFetchingModels(false);
    }
  };

  const upsertProvider = async (body, { isEdit, name, apiKeyDirty }) => {
    const models = textToModels(body.models);
    const payload = {
      name: body.name.trim(),
      base_url: body.base_url.trim(),
      default_model: body.default_model.trim() || models[0] || undefined,
      models: models.length > 0 ? models : undefined,
      service_id: 'default',
    };
    if (apiKeyDirty && body.api_key.trim()) payload.api_key = body.api_key.trim();

    if (isEdit) {
      if (!payload.api_key) delete payload.api_key;
      delete payload.name;
      delete payload.service_id;
      const res = await fetch(`${API}/api/v1/admin/gateway/providers/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        const msg = data.error?.message || data.error || 'Failed to update provider';
        throw new Error(typeof msg === 'string' ? msg : 'Failed to update provider');
      }
      return;
    }

    if (!payload.api_key) {
      throw new Error('API Key is required for new providers.');
    }
    payload.api_key = body.api_key.trim();
    const res = await fetch(`${API}/api/v1/admin/gateway/providers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      const msg = data.error?.message || data.error || 'Failed to save provider';
      throw new Error(typeof msg === 'string' ? msg : 'Failed to save provider');
    }
  };

  const handleSaveProvider = async (e) => {
    e.preventDefault();
    if (!providerDialog) return;
    const { form, mode } = providerDialog;
    const name = form.name.trim();
    if (!name || !form.base_url.trim()) {
      showToast('error', 'Name and Base URL are required.');
      return;
    }
    setSaving(true);
    try {
      await upsertProvider(form, {
        isEdit: mode === 'edit',
        name,
        apiKeyDirty: Boolean(providerDialog.apiKeyDirty),
      });
      setProviderDialog(null);
      await loadData();
      showToast('success', mode === 'edit' ? 'Provider updated.' : 'Provider saved.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProcess = async (e) => {
    e.preventDefault();
    if (!processDraft) return;
    const host = processDraft.host.trim();
    const port = Number.parseInt(processDraft.port, 10);
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
      showToast('error', 'Enter a valid host and port.');
      return;
    }
    setProcessSaving(true);
    try {
      const payload = { auto_start: processDraft.auto_start };
      if (!envBindLocked) {
        payload.bind_addr = `${host}:${port}`;
        payload.restart = Boolean(status?.running);
      }
      const res = await fetch(`${API}/api/v1/admin/gateway/config`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save gateway process settings.');
      }
      setStatus(data);
      if (data.bind_addr) {
        const { host: savedHost, port: savedPort } = splitBindAddr(data.bind_addr);
        setProcessConfig({
          host: savedHost,
          port: savedPort,
          auto_start: data.auto_start !== false,
        });
      } else {
        setProcessConfig((prev) => ({
          ...prev,
          auto_start: data.auto_start !== false,
        }));
      }
      setProcessDialogOpen(false);
      setProcessDraft(null);
      showToast('success', status?.running ? 'Process settings saved and gateway restarted.' : 'Process settings saved.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setProcessSaving(false);
    }
  };

  const runProcessAction = async (action) => {
    setProcessAction(action);
    try {
      const res = await fetch(`${API}/api/v1/admin/gateway/${action}`, {
        method: 'POST',
        headers: authHeaders,
        body: action === 'start' ? JSON.stringify({ force: false }) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.lastError || `Failed to ${action} gateway.`);
      }
      setStatus(data);
      showToast('success', action === 'start' ? 'Gateway started.' : action === 'stop' ? 'Gateway stopped.' : 'Gateway restarted.');
    } catch (err) {
      showToast('error', err.message);
      await loadData();
    } finally {
      setProcessAction(null);
    }
  };

  const handleDelete = async (name) => {
    setDeleting(name);
    try {
      const res = await fetch(`${API}/api/v1/admin/gateway/providers/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        const msg = data.error?.message || data.error || 'Failed to delete provider';
        throw new Error(typeof msg === 'string' ? msg : 'Failed to delete provider');
      }
      if (providerDialog?.form?.name === name) setProviderDialog(null);
      await loadData();
      showToast('success', 'Provider removed.');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  const agentBaseUrl = status?.baseUrl || `http://${processConfig.host === '0.0.0.0' ? '127.0.0.1' : processConfig.host}:${processConfig.port}`;

  return (
    <>
      <div className="space-y-5">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-600">
                <span className={status?.running ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                  {status?.running ? 'Running' : 'Stopped'}
                </span>
                {' · '}
                <span className="font-mono text-zinc-500">
                  {processConfig.host}:{processConfig.port}
                </span>
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Agents connect at{' '}
                <span className="font-mono">{agentBaseUrl}</span>
              </p>
              {status?.lastError && !status?.running && (
                <p className="text-xs text-red-600 mt-1">{status.lastError}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={openProcessDialog}
                className={consoleIconButtonClass}
                title="Configure gateway"
                aria-label="Configure gateway"
              >
                <Settings2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={status?.running || processAction === 'start'}
                onClick={() => runProcessAction('start')}
                className={consoleIconButtonClass}
                title={processAction === 'start' ? 'Starting…' : 'Start gateway'}
                aria-label={processAction === 'start' ? 'Starting gateway' : 'Start gateway'}
              >
                {processAction === 'start' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                disabled={!status?.running || processAction === 'stop'}
                onClick={() => runProcessAction('stop')}
                className={consoleIconButtonClass}
                title={processAction === 'stop' ? 'Stopping…' : 'Stop gateway'}
                aria-label={processAction === 'stop' ? 'Stopping gateway' : 'Stop gateway'}
              >
                {processAction === 'stop' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                disabled={!status?.running || processAction === 'restart'}
                onClick={() => runProcessAction('restart')}
                className={consoleIconButtonClass}
                title={processAction === 'restart' ? 'Restarting…' : 'Restart gateway'}
                aria-label={processAction === 'restart' ? 'Restarting gateway' : 'Restart gateway'}
              >
                {processAction === 'restart' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="flex justify-end mb-2">
            <Button type="button" size="md" onClick={openAddProviderDialog}>
              <Plus className="w-4 h-4" />
              Add provider
            </Button>
          </div>
          {providers.length === 0 ? (
            <p className="text-sm text-zinc-500">No providers yet.</p>
          ) : (
            <ul className="space-y-2">
              {providers.map((p) => (
                <li
                  key={p.name}
                  className="flex items-start justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-zinc-900">{p.name}</p>
                      <ProviderStatusBadge health={providerHealth[p.name]} />
                    </div>
                    {p.base_url && (
                      <p className="font-mono text-xs text-zinc-500 truncate">{p.base_url}</p>
                    )}
                    {p.models?.length > 0 && (
                      <p className="text-xs text-zinc-500 mt-0.5 truncate">{p.models.join(', ')}</p>
                    )}
                    {providerHealth[p.name]?.status === 'error' && providerHealth[p.name]?.message && (
                      <p className="text-xs text-red-600 mt-0.5 truncate" title={providerHealth[p.name].message}>
                        {providerHealth[p.name].message}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <TestConnectionButton
                      health={providerHealth[p.name]}
                      testing={testingProvider === p.name}
                      onClick={() => runProviderTest(p.name)}
                      title={`Verify ${p.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => openEditProviderDialog(p)}
                      className={consoleIconButtonClass}
                      title={`Edit ${p.name}`}
                      aria-label={`Edit ${p.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={deleting === p.name}
                      onClick={() => handleDelete(p.name)}
                      className={consoleIconButtonDangerClass}
                      title={deleting === p.name ? 'Removing…' : `Remove ${p.name}`}
                      aria-label={deleting === p.name ? `Removing ${p.name}` : `Remove ${p.name}`}
                    >
                      {deleting === p.name ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {processDialogOpen && processDraft && (
        <ConsoleDialogShell
          fitContent
          onClose={() => {
            setProcessDialogOpen(false);
            setProcessDraft(null);
          }}
          backdropClassName={NESTED_DIALOG_BACKDROP}
          shellClassName={NESTED_DIALOG_SHELL}
          panelClassName={`${consoleDialogMdClass} p-6`}
        >
          <h3 className="font-bold text-lg text-zinc-900 mb-4">Gateway</h3>
          <form onSubmit={handleSaveProcess} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={processDraft.host}
                onChange={(e) => setProcessDraft((prev) => ({ ...prev, host: e.target.value }))}
                placeholder="Listen host"
                aria-label="Listen host"
                disabled={envBindLocked}
              />
              <Input
                type="number"
                min={1}
                max={65535}
                value={processDraft.port}
                onChange={(e) => setProcessDraft((prev) => ({ ...prev, port: e.target.value }))}
                placeholder="Port"
                aria-label="Port"
                disabled={envBindLocked}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={processDraft.auto_start}
                onChange={(e) => setProcessDraft((prev) => ({ ...prev, auto_start: e.target.checked }))}
                className="rounded border-zinc-300"
              />
              Start automatically when the server boots
            </label>
            {envBindLocked && (
              <p className="text-xs text-amber-700">
                Bind address is locked by UNIGATEWAY_BIND_ADDR in the server environment.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => {
                  setProcessDialogOpen(false);
                  setProcessDraft(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={processSaving} size="md">
                {processSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </ConsoleDialogShell>
      )}

      {providerDialog && (
        <ConsoleDialogShell
          fitContent
          onClose={() => setProviderDialog(null)}
          backdropClassName={NESTED_DIALOG_BACKDROP}
          shellClassName={NESTED_DIALOG_SHELL}
          panelClassName={`${consoleDialogMdClass} p-6`}
        >
          <h3 className="font-bold text-lg text-zinc-900 mb-4">
            {providerDialog.mode === 'edit' ? providerDialog.form.name : 'Add provider'}
          </h3>
          <form onSubmit={handleSaveProvider} className="space-y-4">
            <ProviderFormFields
              form={providerDialog.form}
              onChange={updateProviderForm}
              isEdit={providerDialog.mode === 'edit'}
              apiKeyMasked={providerDialog.apiKeyMasked}
              apiKeyRevealed={providerDialog.apiKeyRevealed}
              apiKeyCanToggle={hasApiKeyForActions(providerDialog)}
              onApiKeyChange={handleApiKeyChange}
              onToggleApiKeyReveal={handleToggleApiKeyReveal}
              hasApiKey={hasApiKeyForActions(providerDialog)}
              onFetchModels={handleFetchModels}
              fetchingModels={fetchingModels}
              onTestConnection={handleTestConnection}
              testingConnection={testingConnection}
              connectionHealth={
                providerDialog.mode === 'edit' && usesSavedApiKey(providerDialog)
                  ? providerHealth[providerDialog.form.name.trim()] || formConnectionHealth
                  : formConnectionHealth
              }
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" size="md" onClick={() => setProviderDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} size="md">
                {saving ? 'Saving…' : providerDialog.mode === 'edit' ? 'Update' : 'Add'}
              </Button>
            </div>
          </form>
        </ConsoleDialogShell>
      )}
    </>
  );
}
