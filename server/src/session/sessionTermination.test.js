const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const { terminateDetachedSessionProcess } = require('./sessionTermination');

test('terminateDetachedSessionProcess signals local pty pid from streamRef', async () => {
    const child = spawn('sleep', ['30'], { stdio: 'ignore', detached: true });
    child.unref();
    const pid = child.pid;
    assert.ok(pid > 0);

    const result = await terminateDetachedSessionProcess({
        session: {
            streamRef: `local:pty:${Date.now()}_abcd_${pid}`,
            agentId: 'claude-code',
        },
    });

    assert.equal(result.killed, true);
    assert.equal(result.reason, 'local_pid');

    await new Promise((r) => setTimeout(r, 200));
    let alive = true;
    try {
        process.kill(pid, 0);
    } catch {
        alive = false;
    }
    assert.equal(alive, false);
});

test('terminateDetachedSessionProcess returns no_process_ref without refs', async () => {
    const result = await terminateDetachedSessionProcess({
        session: { id: 'sess_x', agentId: 'claude-code' },
    });
    assert.equal(result.killed, false);
    assert.equal(result.reason, 'no_process_ref');
});
