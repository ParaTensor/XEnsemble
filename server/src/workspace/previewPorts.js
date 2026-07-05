const fs = require('fs');
const path = require('path');

const PORTS_FILE = '.agents/ports.json';

function portsFilePath(workspacePath) {
    return path.join(workspacePath, PORTS_FILE);
}

function readPortsFile(workspacePath) {
    const filePath = portsFilePath(workspacePath);
    if (!fs.existsSync(filePath)) {
        return { version: 1, previews: {}, primary_deployment_id: null };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            version: 1,
            previews: parsed.previews && typeof parsed.previews === 'object' ? parsed.previews : {},
            primary_deployment_id: parsed.primary_deployment_id || null,
        };
    } catch {
        return { version: 1, previews: {}, primary_deployment_id: null };
    }
}

function writePortsFile(workspacePath, data) {
    const dir = path.dirname(portsFilePath(workspacePath));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(portsFilePath(workspacePath), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function upsertPreviewPort(workspacePath, deploymentId, patch) {
    const doc = readPortsFile(workspacePath);
    doc.previews[deploymentId] = {
        ...(doc.previews[deploymentId] || {}),
        deployment_id: deploymentId,
        ...patch,
        updated_at: Date.now(),
    };
    doc.primary_deployment_id = deploymentId;
    writePortsFile(workspacePath, doc);
    return doc.previews[deploymentId];
}

function removePreviewPort(workspacePath, deploymentId) {
    const doc = readPortsFile(workspacePath);
    delete doc.previews[deploymentId];
    if (doc.primary_deployment_id === deploymentId) {
        const ids = Object.keys(doc.previews);
        doc.primary_deployment_id = ids.length > 0 ? ids[ids.length - 1] : null;
    }
    writePortsFile(workspacePath, doc);
}

function getPreviewPort(workspacePath, deploymentId) {
    const doc = readPortsFile(workspacePath);
    return doc.previews[deploymentId] || null;
}

module.exports = {
    PORTS_FILE,
    readPortsFile,
    writePortsFile,
    upsertPreviewPort,
    removePreviewPort,
    getPreviewPort,
};
