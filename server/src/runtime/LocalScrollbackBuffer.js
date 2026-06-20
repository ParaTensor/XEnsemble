const fs = require('fs');
const path = require('path');
const { WORKSPACE_ROOT } = require('../workspace');

function scrollbackPath(streamRef) {
    if (!streamRef) return null;
    const safe = streamRef.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(WORKSPACE_ROOT, '.scrollback', `${safe}.log`);
}

function ensureScrollbackDir() {
    const dir = path.join(WORKSPACE_ROOT, '.scrollback');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function appendScrollback(streamRef, data) {
    const file = scrollbackPath(streamRef);
    if (!file) return;
    ensureScrollbackDir();
    try {
        fs.appendFileSync(file, data);
    } catch (_) { /* ignore */ }
}

function readScrollback(streamRef, maxBytes = 100_000) {
    const file = scrollbackPath(streamRef);
    if (!file || !fs.existsSync(file)) return '';
    try {
        const stats = fs.statSync(file);
        const start = Math.max(0, stats.size - maxBytes);
        const fd = fs.openSync(file, 'r');
        try {
            const buffer = Buffer.alloc(stats.size - start);
            fs.readSync(fd, buffer, 0, buffer.length, start);
            return buffer.toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    } catch (_) {
        return '';
    }
}

function removeScrollback(streamRef) {
    const file = scrollbackPath(streamRef);
    if (file && fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch (_) {}
    }
}

module.exports = { appendScrollback, readScrollback, removeScrollback };
