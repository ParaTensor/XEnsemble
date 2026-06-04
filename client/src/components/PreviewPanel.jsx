import React, { useState, useEffect, useCallback } from 'react';
import {
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Globe,
  PanelTop,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

const STATUS_STYLES = {
  pending: 'bg-zinc-200 text-zinc-700',
  building: 'bg-amber-100 text-amber-800',
  running: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  stopped: 'bg-zinc-100 text-zinc-600',
  expired: 'bg-zinc-100 text-zinc-500',
};

function pickActiveDeployment(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const running = list.find((d) => d.status === 'running');
  if (running) return running;
  const building = list.find((d) => d.status === 'building' || d.status === 'pending');
  if (building) return building;
  return list[0];
}

function formatTtl(expiresAt) {
  if (!expiresAt) return '';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function PreviewPanel({ projectId, token }) {
  const [deployment, setDeployment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showIframe, setShowIframe] = useState(false);

  const loadDeployments = useCallback(async () => {
    if (!projectId || !token) return;
    try {
      const res = await apiFetch(
        `/api/v1/deployments?project_id=${encodeURIComponent(projectId)}`,
        token,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load preview');
      setDeployment(pickActiveDeployment(data));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [projectId, token]);

  useEffect(() => {
    loadDeployments();
    const id = setInterval(loadDeployments, 4000);
    return () => clearInterval(id);
  }, [loadDeployments]);

  const deployPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/preview`, token, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview deploy failed');
      setDeployment(data);
      if (data.status === 'running') setShowIframe(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const stopPreview = async () => {
    if (!deployment?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/v1/deployments/${encodeURIComponent(deployment.id)}/stop`,
        token,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stop failed');
      setDeployment(data);
      setShowIframe(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const restartPreview = async () => {
    if (!deployment?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/v1/deployments/${encodeURIComponent(deployment.id)}/start`,
        token,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.deployment?.last_error_message || 'Restart failed');
      const next = data.deployment || data;
      setDeployment(next);
      if (next.status === 'running') setShowIframe(true);
    } catch (e) {
      setError(e.message);
      await loadDeployments();
    } finally {
      setLoading(false);
    }
  };

  const previewUrl =
    deployment?.public_url && token
      ? `${deployment.public_url}${deployment.public_url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
      : null;

  const status = deployment?.status || 'none';
  const isBusy = loading || status === 'building' || status === 'pending';

  return (
    <div className="shrink-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="w-4 h-4 text-zinc-500 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Preview</span>
        {deployment && (
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md ${STATUS_STYLES[status] || STATUS_STYLES.stopped}`}>
            {status}
          </span>
        )}
        {deployment?.expires_at && status === 'running' && (
          <span className="text-[10px] text-zinc-500 font-mono">TTL {formatTtl(deployment.expires_at)}</span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          title="Refresh status"
          onClick={loadDeployments}
          disabled={isBusy}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
        </button>
        {status === 'running' ? (
          <>
            <button
              type="button"
              onClick={() => setShowIframe((v) => !v)}
              className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
            >
              <PanelTop className="w-3.5 h-3.5" />
              {showIframe ? 'Hide' : 'Embed'}
            </button>
            {previewUrl && (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open
              </a>
            )}
            <button
              type="button"
              disabled={isBusy}
              onClick={restartPreview}
              className="h-7 px-2.5 text-xs font-medium rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
            >
              Restart
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={stopPreview}
              className="h-7 px-2.5 flex items-center gap-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              <Square className="w-3 h-3" /> Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isBusy}
            onClick={deployPreview}
            className="h-7 px-3 flex items-center gap-1.5 text-xs font-medium rounded-md bg-black text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Deploy preview
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">{error}</p>
      )}
      {deployment?.last_error_message && status === 'failed' && (
        <p className="text-xs text-red-600 truncate" title={deployment.last_error_message}>
          {deployment.last_error_message}
        </p>
      )}
      {showIframe && previewUrl && status === 'running' && (
        <iframe
          title="Preview"
          src={previewUrl}
          className="w-full h-48 rounded-md border border-zinc-200 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
    </div>
  );
}
