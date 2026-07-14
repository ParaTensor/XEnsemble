import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Star, Trash2 } from 'lucide-react';

import Button from '../components/Button';
import Input from '../components/Input';
import PageHeader from '../components/PageHeader';
import {
  ConsoleDialogShell,
  ConsoleStructuredDialogBody,
  ConsoleStructuredDialogFooter,
  ConsoleStructuredDialogHeader,
} from '../components/ConsoleDialog';
import { useToast } from '../components/Toast';
import {
  consoleAdminPageClass,
  consoleCardClass,
  consoleDialogAdminFormPanelClass,
  consoleSectionLabelClass,
  consoleStructuredDialogPanelClass,
  consoleAdminTableShellClass,
  consoleTableBodyCellClass,
  consoleTableHeadCellClass,
} from '../lib/consoleTokens';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';

const AGENT_IMAGES_BASES = [
  '/api/v1/admin/agent-images',
  '/api/v1/admin/boxlite/agent-images',
];

async function agentImagesFetch(pathSuffix = '', options) {
  for (let i = 0; i < AGENT_IMAGES_BASES.length; i += 1) {
    const res = await apiFetch(`${AGENT_IMAGES_BASES[i]}${pathSuffix}`, options);
    if (res.status !== 404 || i === AGENT_IMAGES_BASES.length - 1) return res;
  }
  return apiFetch(`${AGENT_IMAGES_BASES[0]}${pathSuffix}`, options);
}

const EMPTY_REGISTER_FORM = {
  tag: '',
  image_ref: '',
  digest: '',
  notes: '',
  set_active: true,
};

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function activeBadge(isActive) {
  return isActive
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-zinc-50 text-zinc-600 border-zinc-200';
}

export default function ImagesAdmin() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [registerForm, setRegisterForm] = useState(EMPTY_REGISTER_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState(null);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await agentImagesFetch();
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load images');
      }
      setCatalog(await res.json());
    } catch (err) {
      showToast('error', err.message || 'Failed to load images');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const buildableAgents = useMemo(
    () => (catalog?.agents || []).filter((entry) => entry.buildable),
    [catalog],
  );

  const openRegister = (agent) => {
    setSelectedAgent(agent);
    setRegisterForm({
      ...EMPTY_REGISTER_FORM,
      tag: '',
      image_ref: agent.suggested_image_ref || '',
    });
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    if (!selectedAgent) return;
    setSubmitting(true);
    try {
      const res = await agentImagesFetch(`/${selectedAgent.agent_id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: registerForm.tag.trim(),
          image_ref: registerForm.image_ref.trim() || undefined,
          digest: registerForm.digest.trim() || undefined,
          notes: registerForm.notes.trim() || undefined,
          set_active: registerForm.set_active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to register image version');
      showToast('success', `Registered ${selectedAgent.agent_name} image ${registerForm.tag.trim()}`);
      setSelectedAgent(null);
      await loadCatalog();
    } catch (err) {
      showToast('error', err.message || 'Failed to register image version');
    } finally {
      setSubmitting(false);
    }
  };

  const runVersionAction = async (versionId, action) => {
    setActionId(`${action}:${versionId}`);
    try {
      const res = await agentImagesFetch(`/versions/${versionId}/${action}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to ${action} version`);
      showToast('success', action === 'activate' ? 'Active version updated' : 'Version deprecated');
      await loadCatalog();
    } catch (err) {
      showToast('error', err.message || `Failed to ${action} version`);
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className={consoleAdminPageClass}>
      <PageHeader
        title="Images"
        description="Register and pin OCI rootfs images for sandbox agent runtimes."
        actions={(
          <Button type="button" variant="secondary" onClick={loadCatalog} disabled={loading}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        )}
      />

      <div className={`${consoleCardClass} mb-4 space-y-2 p-4`}>
        <p className={consoleSectionLabelClass}>Runtime defaults</p>
        <p className="text-sm text-zinc-700">
          Base image:
          {' '}
          <span className="font-mono text-zinc-600">{catalog?.base_image || '—'}</span>
        </p>
        <p className="text-sm text-zinc-700">
          Build locally:
          {' '}
          <span className="font-mono text-zinc-600">{catalog?.build_command || 'npm run build:agent-images'}</span>
        </p>
        <p className="text-xs text-zinc-500">
          Push images to your registry, then register the tag here. Active versions override naming defaults; env vars like BLINK_IMAGE_DROID still win at runtime.
        </p>
      </div>

      <div className={cn(consoleAdminTableShellClass, '!overflow-auto')}>
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-200">
              <th className={consoleTableHeadCellClass}>Agent</th>
              <th className={consoleTableHeadCellClass}>Buildable</th>
              <th className={consoleTableHeadCellClass}>Active image</th>
              <th className={consoleTableHeadCellClass}>Versions</th>
              <th className={consoleTableHeadCellClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(catalog?.agents || []).map((agent) => (
              <tr key={agent.agent_id} className="border-b border-zinc-100 align-top">
                <td className={consoleTableBodyCellClass}>
                  <div className="font-medium text-zinc-900">{agent.agent_name}</div>
                  <div className="font-mono text-xs text-zinc-500">{agent.agent_id}</div>
                </td>
                <td className={consoleTableBodyCellClass}>
                  {agent.buildable ? (
                    <span className="text-sm text-emerald-700">Yes</span>
                  ) : (
                    <span className="text-sm text-zinc-500">{agent.build_skip_reason || 'No'}</span>
                  )}
                </td>
                <td className={consoleTableBodyCellClass}>
                  {agent.active_version ? (
                    <div className="space-y-1">
                      <div className="font-mono text-xs text-zinc-700 break-all">{agent.active_version.image_ref}</div>
                      <div className="text-xs text-zinc-500">
                        tag
                        {' '}
                        {agent.active_version.tag}
                        {agent.active_version.digest ? ` · ${agent.active_version.digest}` : ''}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-zinc-500">{agent.default_image_ref || 'Not pinned'}</span>
                  )}
                </td>
                <td className={consoleTableBodyCellClass}>
                  <div className="space-y-2">
                    {(agent.versions || []).length === 0 ? (
                      <span className="text-sm text-zinc-500">None</span>
                    ) : (
                      agent.versions.map((version) => (
                        <div key={version.id} className="rounded border border-zinc-200 px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium ${activeBadge(version.is_active)}`}>
                              {version.is_active ? 'active' : version.status}
                            </span>
                            <span className="font-mono text-xs text-zinc-700">{version.tag}</span>
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-zinc-500 break-all">{version.image_ref}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {!version.is_active && version.status !== 'deprecated' ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="h-7 px-2 text-xs"
                                disabled={actionId === `activate:${version.id}`}
                                onClick={() => runVersionAction(version.id, 'activate')}
                              >
                                <Star className="h-3.5 w-3.5" />
                                Activate
                              </Button>
                            ) : null}
                            {version.status !== 'deprecated' ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="h-7 px-2 text-xs"
                                disabled={actionId === `deprecate:${version.id}`}
                                onClick={() => runVersionAction(version.id, 'deprecate')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Deprecate
                              </Button>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-400">{formatTime(version.built_at || version.created_at)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </td>
                <td className={consoleTableBodyCellClass}>
                  {agent.buildable ? (
                    <Button type="button" variant="secondary" onClick={() => openRegister(agent)}>
                      <Plus className="h-4 w-4" />
                      Register
                    </Button>
                  ) : (
                    <span className="text-sm text-zinc-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && buildableAgents.length === 0 ? (
              <tr>
                <td colSpan={5} className={`${consoleTableBodyCellClass} text-sm text-zinc-500`}>
                  No buildable agents found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedAgent && (
        <ConsoleDialogShell onClose={() => setSelectedAgent(null)} panelClassName={consoleStructuredDialogPanelClass}>
          <ConsoleStructuredDialogHeader>
            <h3 className="text-lg font-bold text-zinc-900">Register image version</h3>
            <p className="mt-1 text-sm text-zinc-500">{selectedAgent.agent_name}</p>
          </ConsoleStructuredDialogHeader>
          <form onSubmit={submitRegister}>
            <ConsoleStructuredDialogBody className={consoleDialogAdminFormPanelClass}>
              <label className="block space-y-1">
                <span className={consoleSectionLabelClass}>Tag</span>
                <Input
                  value={registerForm.tag}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, tag: event.target.value }))}
                  placeholder="2026.07.04"
                  required
                />
              </label>
              <label className="block space-y-1">
                <span className={consoleSectionLabelClass}>Image reference</span>
                <Input
                  value={registerForm.image_ref}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, image_ref: event.target.value }))}
                  placeholder={selectedAgent.suggested_image_ref || 'registry/agent-id:tag'}
                />
              </label>
              <label className="block space-y-1">
                <span className={consoleSectionLabelClass}>Digest (optional)</span>
                <Input
                  value={registerForm.digest}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, digest: event.target.value }))}
                  placeholder="sha256:..."
                />
              </label>
              <label className="block space-y-1">
                <span className={consoleSectionLabelClass}>Notes (optional)</span>
                <Input
                  value={registerForm.notes}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Built by CI job #123"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={registerForm.set_active}
                  onChange={(event) => setRegisterForm((prev) => ({ ...prev, set_active: event.target.checked }))}
                />
                Set as active version
              </label>
            </ConsoleStructuredDialogBody>
            <ConsoleStructuredDialogFooter>
              <Button type="button" variant="secondary" onClick={() => setSelectedAgent(null)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Register version'}
              </Button>
            </ConsoleStructuredDialogFooter>
          </form>
        </ConsoleDialogShell>
      )}
    </div>
  );
}
