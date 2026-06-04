/** 仅 Local：内存中跟踪 preview 子进程（server 重启后清空）。 */
const entries = new Map();

function set(deploymentId, entry) {
    entries.set(deploymentId, entry);
}

function get(deploymentId) {
    return entries.get(deploymentId) || null;
}

function remove(deploymentId) {
    const entry = entries.get(deploymentId);
    entries.delete(deploymentId);
    return entry || null;
}

function listIds() {
    return [...entries.keys()];
}

module.exports = { set, get, remove, listIds };
