import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
    Check, CheckCircle2, ChevronDown, ChevronRight, Loader2, RefreshCw,
    RotateCcw, Trash2, Upload, XCircle,
} from 'lucide-react';
import { ConsoleDialogShell } from '../components/ConsoleDialog';
import Input from '../components/Input';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import { consoleButtonFocusClass, consoleInputClass } from '@/lib/consoleTheme';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

const API_BASE = '/api/v1/admin/agent-images';

async function api(path, options) {
    const res = await apiFetch(`${API_BASE}${path}`, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = new Error(data.error || `Request failed: ${res.status}`);
        if (data.code) e.code = data.code;
        throw e;
    }
    return data;
}

function formatTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
}

function formatDuration(started, finished) {
    if (!started) return '-';
    const end = finished || Date.now();
    const s = Math.floor((end - started) / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STATUS_DOT = {
    active: 'bg-[#4A7C59]',
    ready: 'bg-[#5B8DB8]',
    deprecated: 'bg-zinc-300',
    building: 'bg-[#5B8DB8] animate-pulse',
    queued: 'bg-[#9AA0A6]',
    failed: 'bg-[#C06C5D]',
    none: 'bg-[#DADCE0]',
};

function WorkflowStrip({ hasVersions, hasActive }) {
    const steps = [
        { num: 1, label: 'Build', desc: 'Click to build', done: hasVersions },
        { num: 2, label: 'Register', desc: 'Automatic', done: hasVersions },
        { num: 3, label: 'Activate', desc: 'Pick a version', done: hasActive },
    ];
    return (
        <div className="flex items-center gap-2 border-b border-[#DADCE0] bg-white px-4 py-2.5 shrink-0">
            {steps.map((s, i) => (
                <div key={s.num} className="flex items-center gap-2 flex-1 last:flex-none">
                    <div className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                        s.done ? 'bg-[#4A7C59] text-white' : 'bg-[#E8EAED] text-[#9AA0A6]',
                    )}>{s.num}</div>
                    <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#202124]">{s.label}</div>
                        <div className="text-[10px] text-[#9AA0A6]">{s.desc}</div>
                    </div>
                    {i < steps.length - 1 && (
                        <div className={cn('flex-1 border-t-2 border-dashed mx-1', s.done ? 'border-[#4A7C59]' : 'border-[#DADCE0]')} />
                    )}
                </div>
            ))}
        </div>
    );
}

function AgentListItem({ agent, selected, onClick }) {
    const activeVersion = agent.active_version;
    const hasDefault = Boolean(agent.default_image_ref);
    const isBuilding = agent.build_state === 'building';
    const isQueued = agent.build_state === 'queued';
    const isFailed = agent.build_state === 'failed';
    const dotClass = isBuilding ? STATUS_DOT.building
        : isQueued ? STATUS_DOT.queued
        : isFailed ? STATUS_DOT.failed
        : (activeVersion || hasDefault) ? STATUS_DOT.active
        : STATUS_DOT.none;
    const statusText = isBuilding ? 'Building'
        : isQueued ? 'Queued'
        : isFailed ? 'Build failed'
        : activeVersion ? activeVersion.tag
        : hasDefault ? 'default:latest'
        : 'No image';

    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'w-full text-left px-3 py-2 rounded-md transition-colors',
                selected ? 'bg-[#F4F5F6] border-l-2 border-[#5B8DB8]' : 'hover:bg-[#F4F5F6]',
                consoleButtonFocusClass,
            )}
        >
            <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
                <span className="text-xs font-medium text-[#202124] truncate">{agent.agent_name}</span>
                {isBuilding && <Loader2 className="h-3 w-3 animate-spin text-[#5B8DB8] shrink-0" />}
            </div>
            <div className={cn('text-[10px] mt-0.5 ml-4 truncate', isFailed ? 'text-[#C06C5D]' : 'text-[#9AA0A6]', !activeVersion && !isBuilding && !isQueued && !isFailed && 'italic')}>
                {statusText}
            </div>
        </button>
    );
}

function VersionRow({ version, actionId, onActivate, onDeactivate, onDelete }) {
    const isBusy = actionId === `activate:${version.id}` || actionId === `deprecate:${version.id}` || actionId === `delete:${version.id}`;
    return (
        <div className="flex items-center gap-2 px-3 py-2 hover:bg-[#F4F5F6] transition-colors border-b border-[#E8EAED] last:border-b-0">
            <span className="font-mono text-xs text-[#202124] truncate flex-1">{version.tag}</span>
            {version.is_active ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">Active</span>
            ) : version.status === 'deprecated' ? (
                <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-400">Inactive</span>
            ) : (
                <span className="inline-flex items-center rounded-full bg-[#F4F5F6] px-2 py-0.5 text-[10px] font-medium text-[#5F6368]">Ready</span>
            )}
            <span className="text-[10px] text-[#9AA0A6] shrink-0">{formatTime(version.built_at || version.created_at)}</span>
            <div className="flex items-center gap-1 shrink-0">
                {isBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin text-[#9AA0A6]" />
                ) : (
                    <>
                        {!version.is_active && (
                            <button type="button" onClick={() => onActivate(version.id)} title="Activate" className={cn('p-0.5 rounded text-[#4A7C59] hover:bg-[#E8F5E9]', consoleButtonFocusClass)}>
                                <Check className="h-3.5 w-3.5" />
                            </button>
                        )}
                        {version.is_active && (
                            <button type="button" onClick={() => onDeactivate(version.id)} title="Deactivate" className={cn('p-0.5 rounded text-[#9AA0A6] hover:bg-[#E8EAED]', consoleButtonFocusClass)}>
                                <XCircle className="h-3.5 w-3.5" />
                            </button>
                        )}
                        {!version.is_active && (
                            <button type="button" onClick={() => onDelete(version)} title="Delete" className={cn('p-0.5 rounded text-[#C06C5D] hover:bg-[#FDECEA]', consoleButtonFocusClass)}>
                                <Trash2 className="h-3 w-3" />
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export function ImagesAdminContent() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [catalog, setCatalog] = useState(null);
    const [selectedAgentId, setSelectedAgentId] = useState(null);
    const [builds, setBuilds] = useState([]);
    const [actionId, setActionId] = useState(null);
    const [buildDialogOpen, setBuildDialogOpen] = useState(false);
    const [buildTag, setBuildTag] = useState('');
    const [buildNotes, setBuildNotes] = useState('');
    const [building, setBuilding] = useState(false);
    const [deleteVersionTarget, setDeleteVersionTarget] = useState(null);
    const [logsBuildId, setLogsBuildId] = useState(null);
    const [logsContent, setLogsContent] = useState('');
    const [logsLoading, setLogsLoading] = useState(false);
    const tagInputRef = useRef(null);

    const [refreshing, setRefreshing] = useState(false);

    const loadCatalog = useCallback(async (opts = {}) => {
        if (!opts.silent) setRefreshing(true);
        try {
            const data = await api('');
            setCatalog(data);
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [showToast]);

    const loadBuilds = useCallback(async (agentId) => {
        if (!agentId) return;
        try {
            const data = await api(`/${agentId}/builds`);
            setBuilds(data.builds || []);
        } catch { setBuilds([]); }
    }, []);

    useEffect(() => { loadCatalog(); }, [loadCatalog]);

    const pollIds = useMemo(() => {
        if (!catalog) return new Set();
        const ids = new Set();
        for (const agent of catalog.agents || []) {
            if (agent.build_state === 'building' || agent.build_state === 'queued') ids.add(agent.agent_id);
        }
        return ids;
    }, [catalog]);

    useEffect(() => {
        if (pollIds.size === 0) return;
        const timer = setInterval(() => { loadCatalog(); }, 5000);
        return () => clearInterval(timer);
    }, [pollIds.size, loadCatalog]);

    useEffect(() => {
        if (selectedAgentId) loadBuilds(selectedAgentId);
        else setBuilds([]);
    }, [selectedAgentId, loadBuilds]);

    useEffect(() => {
        if (pollIds.has(selectedAgentId)) loadBuilds(selectedAgentId);
    }, [pollIds, selectedAgentId, loadBuilds]);

    useEffect(() => {
        if (buildDialogOpen) {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            setBuildTag(`${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`);
            setBuildNotes('');
            setTimeout(() => tagInputRef.current?.focus(), 50);
        }
    }, [buildDialogOpen]);

    const selectedAgent = useMemo(
        () => (catalog?.agents || []).find((a) => a.agent_id === selectedAgentId),
        [catalog, selectedAgentId],
    );

    const latestBuild = builds[0] || null;
    const isBuilding = latestBuild?.state === 'building';
    const isQueued = latestBuild?.state === 'queued';
    const isFailed = latestBuild?.state === 'failed';

    const handleBuild = async () => {
        if (!selectedAgentId || !buildTag.trim()) return;
        setBuilding(true);
        try {
            await api(`/${selectedAgentId}/build`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag: buildTag.trim(), notes: buildNotes.trim() || undefined }),
            });
            showToast('success', 'Build started.');
            setBuildDialogOpen(false);
            await loadCatalog();
            await loadBuilds(selectedAgentId);
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setBuilding(false);
        }
    };

    const handleActivate = async (versionId) => {
        setActionId(`activate:${versionId}`);
        try {
            await api(`/versions/${versionId}/activate`, { method: 'POST' });
            showToast('success', 'Version activated.');
            await loadCatalog();
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setActionId(null);
        }
    };

    const handleDeactivate = async (versionId) => {
        if (!window.confirm('Deactivate this version? The agent will fall back to the default image. You can re-activate it anytime.')) return;
        setActionId(`deprecate:${versionId}`);
        try {
            await api(`/versions/${versionId}/deprecate`, { method: 'POST' });
            showToast('success', 'Version deactivated.');
            await loadCatalog();
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setActionId(null);
        }
    };

    const handleDeleteVersion = async () => {
        if (!deleteVersionTarget) return;
        const vid = deleteVersionTarget.id;
        setActionId(`delete:${vid}`);
        setDeleteVersionTarget(null);
        try {
            await api(`/versions/${vid}`, { method: 'DELETE' });
            showToast('success', 'Version deleted.');
            await loadCatalog();
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setActionId(null);
        }
    };

    const handleRetry = async (buildId) => {
        if (!window.confirm('Retry this build?')) return;
        try {
            await api(`/builds/${buildId}/retry`, { method: 'POST' });
            showToast('success', 'Build retried.');
            await loadCatalog();
            if (selectedAgentId) await loadBuilds(selectedAgentId);
        } catch (err) {
            showToast('error', err.message);
        }
    };

    const handleDiscardBuild = async (buildId) => {
        if (!window.confirm('Discard this build record? Logs will be permanently deleted.')) return;
        try {
            await api(`/builds/${buildId}`, { method: 'DELETE' });
            showToast('success', 'Build discarded.');
            if (selectedAgentId) await loadBuilds(selectedAgentId);
        } catch (err) {
            showToast('error', err.message);
        }
    };

    const handleViewLogs = async (buildId) => {
        if (logsBuildId === buildId) { setLogsBuildId(null); return; }
        setLogsBuildId(buildId);
        setLogsLoading(true);
        try {
            const data = await api(`/builds/${buildId}/logs`);
            setLogsContent(data.content || '(no logs)');
        } catch (err) {
            setLogsContent(`Error: ${err.message}`);
        } finally {
            setLogsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between border-b border-[#DADCE0] bg-white px-4 py-2.5 shrink-0 shadow-sm">
                <h2 className="text-sm font-bold text-[#202124]">Agent Images</h2>
                <button type="button" onClick={() => loadCatalog()} disabled={refreshing} className={cn('p-1.5 rounded text-[#5F6368] hover:bg-[#E8EAED]', consoleButtonFocusClass)}>
                    {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />}
                </button>
            </div>

            <WorkflowStrip hasVersions={Boolean(selectedAgent?.versions?.length || selectedAgent?.default_image_ref)} hasActive={Boolean(selectedAgent?.active_version)} />

            <div className="flex flex-1 min-h-0">
                <div className="w-56 shrink-0 border-r border-[#E8EAED] bg-white overflow-y-auto p-1">
                    {(catalog?.agents || []).filter((a) => a.buildable).map((agent) => (
                        <AgentListItem
                            key={agent.agent_id}
                            agent={agent}
                            selected={selectedAgentId === agent.agent_id}
                            onClick={() => setSelectedAgentId(agent.agent_id)}
                        />
                    ))}
                    {loading && (
                        <div className="flex items-center justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-[#9AA0A6]" /></div>
                    )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto bg-[#F0F1F3] p-4 space-y-3">
                    {!selectedAgent ? (
                        <div className="flex flex-col items-center justify-center h-full text-[#9AA0A6]">
                            <p className="text-sm">Select an agent from the left to manage its images.</p>
                        </div>
                    ) : (
                        <>
                            <div className="rounded-xl bg-white shadow-sm border border-[#E8EAED] px-4 py-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-sm font-bold text-[#202124]">{selectedAgent.agent_name}</h3>
                                </div>
                                {selectedAgent.active_version ? (
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">Active</span>
                                                <span className="text-xs font-mono text-[#202124] truncate">{selectedAgent.active_version.image_ref}</span>
                                            </div>
                                            <div className="text-[10px] text-[#9AA0A6] mt-0.5">
                                                Tag {selectedAgent.active_version.tag} · Built {formatTime(selectedAgent.active_version.built_at)}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDeactivate(selectedAgent.active_version.id)}
                                            disabled={actionId === `deprecate:${selectedAgent.active_version.id}`}
                                            className={cn('text-xs text-[#9AA0A6] hover:text-[#5F6368] shrink-0', consoleButtonFocusClass)}
                                        >
                                            {actionId === `deprecate:${selectedAgent.active_version.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Deactivate'}
                                        </button>
                                    </div>
                                ) : selectedAgent.default_image_ref ? (
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center rounded-full bg-[#F4F5F6] px-2 py-0.5 text-[10px] font-medium text-[#5F6368]">Default</span>
                                        <span className="text-xs font-mono text-[#5F6368] truncate">{selectedAgent.default_image_ref}</span>
                                    </div>
                                ) : (
                                    <p className="text-xs text-[#9AA0A6]">No image. Build a new image to get started.</p>
                                )}

                                <div className="border-t border-[#E8EAED] mt-3 pt-3">
                                    {isBuilding || isQueued ? (
                                        <div className="flex items-center gap-2 text-sm text-[#5B8DB8]">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span>{isBuilding ? 'Building...' : 'Queued...'}</span>
                                            {latestBuild && <span className="text-[10px] text-[#9AA0A6]">Started {formatTime(latestBuild.started_at)} · {formatDuration(latestBuild.started_at, latestBuild.finished_at)}</span>}
                                        </div>
                                    ) : isFailed ? (
                                        <div>
                                            <div className="flex items-center gap-2 text-sm text-[#C06C5D]">
                                                <CheckCircle2 className="h-4 w-4 rotate-180" />
                                                <span>Build failed</span>
                                            </div>
                                            {latestBuild?.failure_reason && (
                                                <pre className="mt-1.5 rounded-lg bg-[#FDECEA] p-2 text-[10px] font-mono text-[#C06C5D] max-h-20 overflow-auto whitespace-pre-wrap">{latestBuild.failure_reason}</pre>
                                            )}
                                            <div className="flex items-center gap-2 mt-2">
                                                {latestBuild && (
                                                    <button type="button" onClick={() => handleViewLogs(latestBuild.id)} className={cn('text-xs text-[#5B8DB8] hover:underline', consoleButtonFocusClass)}>
                                                        {logsBuildId === latestBuild.id ? 'Hide Logs' : 'View Logs'}
                                                    </button>
                                                )}
                                                {latestBuild && (
                                                    <button type="button" onClick={() => handleRetry(latestBuild.id)} className={cn('text-xs text-[#4A7C59] hover:underline', consoleButtonFocusClass)}>Retry</button>
                                                )}
                                                {latestBuild && (
                                                    <button type="button" onClick={() => handleDiscardBuild(latestBuild.id)} className={cn('text-xs text-[#C06C5D] hover:underline', consoleButtonFocusClass)}>Discard</button>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setBuildDialogOpen(true)}
                                            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-white bg-[#4A7C59] hover:bg-[#3d684a] transition-colors', consoleButtonFocusClass)}
                                        >
                                            <Upload className="h-3.5 w-3.5" />
                                            Build New Image
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="rounded-xl bg-white shadow-sm border border-[#E8EAED] overflow-hidden">
                                <div className="px-4 py-2.5 border-b border-[#E8EAED]">
                                    <span className="text-xs font-semibold text-[#5F6368]">Versions ({selectedAgent.versions?.length || 0})</span>
                                </div>
                                {selectedAgent.versions?.length === 0 ? (
                                    <div className="px-4 py-6 text-center text-xs text-[#9AA0A6]">No versions yet.</div>
                                ) : (
                                    <>
                                        {!selectedAgent.active_version && selectedAgent.default_image_ref && (
                                            <div className="px-4 py-2 bg-[#FAFBFC] border-b border-[#E8EAED] text-[10px] text-[#5F6368]">
                                                Using default image. Activate a version to override.
                                            </div>
                                        )}
                                        {selectedAgent.versions.map((v) => (
                                            <VersionRow
                                                key={v.id}
                                                version={v}
                                                actionId={actionId}
                                                onActivate={handleActivate}
                                                onDeactivate={handleDeactivate}
                                                onDelete={(version) => setDeleteVersionTarget(version)}
                                            />
                                        ))}
                                    </>
                                )}
                            </div>

                            {logsBuildId && (
                                <div className="rounded-xl bg-[#0D1117] border border-[#0D1117] overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262d]">
                                        <span className="text-[10px] font-medium text-[#C9D1D9]">Build Logs ({logsBuildId})</span>
                                        <button type="button" onClick={() => setLogsBuildId(null)} className={cn('text-[10px] text-[#8B949E] hover:text-[#C9D1D9]', consoleButtonFocusClass)}>Close</button>
                                    </div>
                                    <pre className="p-3 text-[10px] font-mono text-[#C9D1D9] max-h-64 overflow-auto whitespace-pre-wrap">
                                        {logsLoading ? 'Loading...' : logsContent}
                                    </pre>
                                </div>
                            )}

                            {builds.filter((b) => b.state === 'ready' || b.state === 'failed').length > 1 && (
                                <div className="rounded-xl bg-white shadow-sm border border-[#E8EAED] overflow-hidden">
                                    <div className="px-4 py-2.5 border-b border-[#E8EAED]">
                                        <span className="text-xs font-semibold text-[#5F6368]">Build History ({builds.length})</span>
                                    </div>
                                    {builds.map((b) => (
                                        <div key={b.id} className="flex items-center gap-2 px-4 py-2 hover:bg-[#F4F5F6] transition-colors border-b border-[#E8EAED] last:border-b-0">
                                            <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', b.state === 'ready' ? 'bg-[#4A7C59]' : 'bg-[#C06C5D]')} />
                                            <span className="font-mono text-[10px] text-[#5F6368] truncate flex-1">{b.id}</span>
                                            <span className={cn('text-[10px]', b.state === 'ready' ? 'text-[#4A7C59]' : 'text-[#C06C5D]')}>{b.state}</span>
                                            <span className="text-[10px] text-[#9AA0A6]">{formatDuration(b.started_at, b.finished_at)}</span>
                                            <span className="text-[10px] text-[#9AA0A6]">{formatTime(b.started_at)}</span>
                                            <button type="button" onClick={() => handleViewLogs(b.id)} className={cn('text-[10px] text-[#5B8DB8] hover:underline', consoleButtonFocusClass)}>
                                                {logsBuildId === b.id ? 'Hide' : 'Logs'}
                                            </button>
                                            {b.state === 'failed' && (
                                                <button type="button" onClick={() => handleDiscardBuild(b.id)} className={cn('text-[10px] text-[#C06C5D] hover:underline', consoleButtonFocusClass)}>Discard</button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {buildDialogOpen && (
                <ConsoleDialogShell onClose={() => setBuildDialogOpen(false)} panelClassName="w-96">
                    <div className="px-5 pt-5 pb-2">
                        <h3 className="text-sm font-semibold text-[#202124]">Build new image</h3>
                        <p className="text-xs text-[#9AA0A6] mt-1">Build {selectedAgent?.agent_name} from the latest definition.</p>
                    </div>
                    <div className="px-5 pb-5 space-y-3">
                        <label className="block">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9AA0A6]">Version tag</span>
                            <input ref={tagInputRef} type="text" value={buildTag} onChange={(e) => setBuildTag(e.target.value)} className={cn('mt-1 w-full', consoleInputClass, 'text-xs')} />
                        </label>
                        <label className="block">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9AA0A6]">Notes (optional)</span>
                            <input type="text" value={buildNotes} onChange={(e) => setBuildNotes(e.target.value)} className={cn('mt-1 w-full', consoleInputClass, 'text-xs')} />
                        </label>
                    </div>
                    <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#E8EAED]">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setBuildDialogOpen(false)} disabled={building}>Cancel</Button>
                        <Button type="button" size="sm" onClick={handleBuild} disabled={!buildTag.trim() || building}>
                            {building ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Building...</> : 'Build'}
                        </Button>
                    </div>
                </ConsoleDialogShell>
            )}

            {deleteVersionTarget && (
                <ConsoleDialogShell onClose={() => setDeleteVersionTarget(null)} panelClassName="w-96">
                    <div className="px-5 pt-5 pb-2">
                        <h3 className="text-sm font-semibold text-[#202124]">Delete version</h3>
                    </div>
                    <div className="px-5 pb-4">
                        <p className="text-xs text-[#5F6368]">
                            Delete <span className="font-mono font-medium text-[#202124]">{deleteVersionTarget.tag}</span>?
                        </p>
                        <p className="text-xs text-[#9AA0A6] mt-1">This removes the version and its image from the registry. This cannot be undone.</p>
                    </div>
                    <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#E8EAED]">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setDeleteVersionTarget(null)}>Cancel</Button>
                        <Button type="button" size="sm" onClick={handleDeleteVersion} className="bg-[#C06C5D] hover:bg-[#a55a4d] text-white">Delete</Button>
                    </div>
                </ConsoleDialogShell>
            )}
        </div>
    );
}

export default function ImagesAdmin() {
    return <ImagesAdminContent />;
}
