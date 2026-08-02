/**
 * Serialize non-idempotent git mutations per project.
 * Distinct from singleflight: concurrent callers queue rather than sharing one result.
 * Re-entrant for the same project within the same async chain.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const tails = new Map();
const heldKeys = new AsyncLocalStorage();

function withProjectGitLock(projectId, fn) {
    const key = String(projectId || '');
    const held = heldKeys.getStore();
    if (held && held.has(key)) {
        return Promise.resolve().then(fn);
    }

    const previous = tails.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => {
        const nextHeld = new Set(heldKeys.getStore() || []);
        nextHeld.add(key);
        return heldKeys.run(nextHeld, fn);
    });
    const tail = run.catch(() => {});
    tails.set(key, tail);
    return run.finally(() => {
        if (tails.get(key) === tail) tails.delete(key);
    });
}

module.exports = { withProjectGitLock };
