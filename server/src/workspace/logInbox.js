const fs = require('fs');
const path = require('path');

const INBOX_DIR = '.agents/in';
const SERVER_LOG = 'server.log';
const MAX_LOG_BYTES = Number(process.env.WORKSPACE_LOG_MAX_BYTES || 5 * 1024 * 1024);

function inboxDir(workspacePath) {
    return path.join(workspacePath, INBOX_DIR);
}

function serverLogPath(workspacePath) {
    return path.join(inboxDir(workspacePath), SERVER_LOG);
}

function ensureInboxDir(workspacePath) {
    const dir = inboxDir(workspacePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function trimLogFile(filePath) {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size <= MAX_LOG_BYTES) return;
        const fd = fs.openSync(filePath, 'r');
        const start = Math.max(0, stat.size - MAX_LOG_BYTES);
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        fs.writeFileSync(filePath, buf);
    } catch {
        // best effort
    }
}

/**
 * Append a tagged line to `.agents/in/server.log`.
 * @param {string} workspacePath
 * @param {string} tag e.g. preview, browser
 * @param {string} message
 */
function appendInboxLog(workspacePath, tag, message) {
    if (!workspacePath || !message) return;
    ensureInboxDir(workspacePath);
    const filePath = serverLogPath(workspacePath);
    const line = `[${tag}] ${String(message).replace(/\n/g, '\\n')}\n`;
    fs.appendFileSync(filePath, line, 'utf8');
    trimLogFile(filePath);
}

module.exports = {
    INBOX_DIR,
    SERVER_LOG,
    inboxDir,
    serverLogPath,
    ensureInboxDir,
    appendInboxLog,
};
