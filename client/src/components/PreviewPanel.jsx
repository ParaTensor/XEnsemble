import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  Rocket,
  Square,
  PanelTop,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';

const STATUS_STYLES = {
  pending: 'bg-zinc-700 text-zinc-300',
  building: 'bg-amber-900/60 text-amber-400',
  running: 'bg-green-900/60 text-green-400',
  failed: 'bg-red-900/60 text-red-400',
  stopped: 'bg-zinc-800 text-zinc-400',
  expired: 'bg-zinc-800 text-zinc-500',
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

export function usePreview(projectId, token) {
  const { showToast } = useToast();
  const lastFailedToastRef = useRef(null);
  const [deployment, setDeployment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showIframe, setShowIframe] = useState(false);

  useEffect(() => {
    lastFailedToastRef.current = null;
  }, [projectId]);

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
    } catch (e) {
      // Polling errors stay silent; action failures toast in their handlers.
    }
  }, [projectId, token]);

  useEffect(() => {
    if (!projectId || !token) return undefined;
    loadDeployments();
    const id = setInterval(loadDeployments, 4000);
    return () => clearInterval(id);
  }, [loadDeployments, projectId, token]);

  const deployPreview = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${encodeURIComponent(projectId)}/preview`, token, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview deploy failed');
      setDeployment(data);
      if (data.status === 'running') setShowIframe(true);
    } catch (e) {
      showToast('error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const stopPreview = async () => {
    if (!deployment?.id) return;
    setLoading(true);
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
      showToast('error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const restartPreview = async () => {
    if (!deployment?.id) return;
    setLoading(true);
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
      showToast('error', e.message);
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

  useEffect(() => {
    if (status !== 'failed' || !deployment?.last_error_message) return;
    const key = `${deployment.id ?? 'none'}:${deployment.last_error_message}`;
    if (lastFailedToastRef.current === key) return;
    lastFailedToastRef.current = key;
    showToast('error', deployment.last_error_message);
  }, [deployment?.id, deployment?.last_error_message, showToast, status]);

  return {
    deployment,
    status,
    loading,
    showIframe,
    setShowIframe,
    previewUrl,
    isBusy,
    loadDeployments,
    deployPreview,
    stopPreview,
    restartPreview,
  };
}

const ICON_BTN =
  'rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50';

export function PreviewStatus({ deployment, status }) {
  if (!deployment) return null;
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span
        className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${STATUS_STYLES[status] || STATUS_STYLES.stopped}`}
      >
        {status}
      </span>
      {deployment.expires_at && status === 'running' && (
        <span className="text-[10px] text-zinc-500 font-mono hidden xl:inline">
          TTL {formatTtl(deployment.expires_at)}
        </span>
      )}
    </div>
  );
}

export function PreviewControlGroup(props) {
  const { deployment } = props;
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <PreviewStatus {...props} />
      {deployment && <div className="h-3.5 w-px bg-zinc-600 mx-0.5 shrink-0" aria-hidden />}
      <PreviewActions {...props} />
    </div>
  );
}

export function PreviewActions({
  status,
  isBusy,
  previewUrl,
  showIframe,
  setShowIframe,
  deployPreview,
  stopPreview,
  restartPreview,
}) {
  if (status === 'running') {
    return (
      <>
        <button
          type="button"
          title={showIframe ? 'Hide embed' : 'Embed preview'}
          onClick={() => setShowIframe((v) => !v)}
          className={ICON_BTN}
        >
          <PanelTop className="w-3.5 h-3.5" />
        </button>
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open preview"
            className={ICON_BTN}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        <button
          type="button"
          title="Restart preview"
          disabled={isBusy}
          onClick={restartPreview}
          className={ICON_BTN}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          title="Stop preview"
          disabled={isBusy}
          onClick={stopPreview}
          className={ICON_BTN}
        >
          <Square className="w-3.5 h-3.5" />
        </button>
      </>
    );
  }

  return (
    <button
      type="button"
      disabled={isBusy}
      onClick={deployPreview}
      title="Deploy preview"
      className={ICON_BTN}
    >
      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
    </button>
  );
}

export function PreviewExtras({ status, showIframe, previewUrl }) {
  const showEmbed = showIframe && previewUrl && status === 'running';
  if (!showEmbed) return null;

  return (
    <div className="shrink-0 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5">
      <iframe
        title="Preview"
        src={previewUrl}
        className="w-full h-48 rounded border border-zinc-700 bg-zinc-950"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
