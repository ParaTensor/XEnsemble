const fs = require('fs');
const path = require('path');

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

function writeAll(state) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function get(agentId) {
    return readAll()[agentId] || null;
}

function record(agentId, entry) {
    const state = readAll();
    state[agentId] = {
        ...entry,
        finished_at: entry.finished_at ?? Date.now(),
    };
    writeAll(state);
    return state[agentId];
}

module.exports = {
    get,
    record,
    readAll,
};
