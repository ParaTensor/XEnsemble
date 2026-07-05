const net = require('net');

function probePort(host, port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port }, () => {
            socket.end();
            resolve(true);
        });
        socket.setTimeout(timeoutMs);
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
    });
}

function parseInternalRef(internalRef) {
    const raw = String(internalRef || '').trim();
    const idx = raw.lastIndexOf(':');
    if (idx <= 0) return null;
    const host = raw.slice(0, idx);
    const port = Number(raw.slice(idx + 1));
    if (!host || !Number.isInteger(port) || port <= 0) return null;
    return { host, port };
}

function isProcessAlive(pid) {
    if (!pid || !Number.isInteger(pid)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    probePort,
    parseInternalRef,
    isProcessAlive,
};
