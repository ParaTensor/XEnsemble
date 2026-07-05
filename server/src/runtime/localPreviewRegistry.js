/** Local preview 进程注册表：内存为主，`.agents/ports.json` 持久化以便重启 reconcile。 */
const { upsertPreviewPort, removePreviewPort } = require('../workspace/previewPorts');
const { resolveControlPlanePublicUrlSync } = require('../llm/publicUrl');

const entries = new Map();

function persistEntry(deploymentId, entry, extra = {}) {
    if (!entry?.workspacePath) return;
    upsertPreviewPort(entry.workspacePath, deploymentId, {
        port: entry.port,
        public_url: extra.publicUrl || `${resolveControlPlanePublicUrlSync()}/preview/${deploymentId}/`,
        internal_ref: `127.0.0.1:${entry.port}`,
        pid: entry.child?.pid || entry.pid || null,
        started_at: entry.startedAt || Date.now(),
        healthy: true,
        recovered: Boolean(entry.recovered),
    });
}

function set(deploymentId, entry, options = {}) {
    entries.set(deploymentId, entry);
    if (options.persist !== false) {
        persistEntry(deploymentId, entry, options);
    }
}

function get(deploymentId) {
    return entries.get(deploymentId) || null;
}

function remove(deploymentId) {
    const entry = entries.get(deploymentId);
    entries.delete(deploymentId);
    if (entry?.workspacePath) {
        removePreviewPort(entry.workspacePath, deploymentId);
    }
    return entry || null;
}

function listIds() {
    return [...entries.keys()];
}

module.exports = { set, get, remove, listIds, persistEntry };
