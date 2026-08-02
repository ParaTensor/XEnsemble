const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_PATH = path.join(__dirname, '../../data/agent-lifecycle-state.json');

function readAll() {
    try {
        if (!fs.existsSync(STATE_PATH)) return {};
        const raw = fs.readFileSync(STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Atomic write: write to a temp file in the same directory then rename.
 * rename(2) is atomic on the same filesystem, so concurrent readers always
 * see either the old or the new state — never a half-written file.
 */
function writeAll(state) {
    const dir = path.dirname(STATE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, `.agent-lifecycle-state.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    try {
        fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        fs.renameSync(tmpPath, STATE_PATH);
    } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
        throw err;
    }
}

/**
 * Serialize concurrent read-modify-write cycles so that two parallel
 * record() calls do not both read the same initial state and then
 * overwrite each other.
 */
let writeTail = Promise.resolve();

function get(agentId) {
    return readAll()[agentId] || null;
}

function record(agentId, entry) {
    const pending = writeTail.then(() => {
        try {
            const state = readAll();
            state[agentId] = {
                ...entry,
                finished_at: entry.finished_at ?? Date.now(),
            };
            writeAll(state);
            return state[agentId];
        } catch (err) {
            // Log but do not propagate to callers using fire-and-forget
            console.error('[agentLifecycleState] write failed:', err.message);
            return null;
        }
    });
    // Ensure the chain tail never rejects, so the next queued writer
    // proceeds even if the current one encountered an error.
    writeTail = pending.catch(() => {});
    return pending;
}

module.exports = {
    get,
    record,
    readAll,
};
