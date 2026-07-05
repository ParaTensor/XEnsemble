const previewRegistry = require('../runtime/localPreviewRegistry');
const { probePort, isProcessAlive } = require('../runtime/previewHealth');
const { getPreviewPort } = require('./previewPorts');

async function checkPreviewEntryHealth(entry) {
    if (!entry?.port) return false;
    const portOk = await probePort('127.0.0.1', entry.port);
    if (!portOk) return false;
    if (entry.recovered || !entry.child) return true;
    return isProcessAlive(entry.child?.pid);
}

async function tryRecoverPreview(deployment, workspacePath) {
    const persisted = getPreviewPort(workspacePath, deployment.id);
    if (!persisted?.port) return null;
    if (!await probePort('127.0.0.1', persisted.port)) return null;

    const entry = {
        port: persisted.port,
        child: null,
        workspacePath,
        startedAt: persisted.started_at || Date.now(),
        recovered: true,
    };
    previewRegistry.set(deployment.id, entry, { publicUrl: deployment.publicUrl || persisted.public_url });
    return entry;
}

module.exports = {
    checkPreviewEntryHealth,
    tryRecoverPreview,
};
