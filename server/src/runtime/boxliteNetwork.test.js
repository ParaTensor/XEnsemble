const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveBoxliteSessionNetwork } = require('./boxliteNetwork');

test('defaults to enabled full egress', () => {
    const prevMode = process.env.BLINK_NETWORK;
    const prevAllow = process.env.BLINK_ALLOW_NET;
    delete process.env.BLINK_NETWORK;
    delete process.env.BLINK_ALLOW_NET;
    try {
        assert.deepEqual(resolveBoxliteSessionNetwork(), { mode: 'enabled', allow_net: [] });
    } finally {
        if (prevMode == null) delete process.env.BLINK_NETWORK;
        else process.env.BLINK_NETWORK = prevMode;
        if (prevAllow == null) delete process.env.BLINK_ALLOW_NET;
        else process.env.BLINK_ALLOW_NET = prevAllow;
    }
});

test('honors BLINK_ALLOW_NET allowlist', () => {
    const prevAllow = process.env.BLINK_ALLOW_NET;
    process.env.BLINK_ALLOW_NET = 'auth.kimi.com, npmjs.org';
    try {
        assert.deepEqual(resolveBoxliteSessionNetwork(), {
            mode: 'enabled',
            allow_net: ['auth.kimi.com', 'npmjs.org'],
        });
    } finally {
        if (prevAllow == null) delete process.env.BLINK_ALLOW_NET;
        else process.env.BLINK_ALLOW_NET = prevAllow;
    }
});

test('request override wins', () => {
    assert.deepEqual(
        resolveBoxliteSessionNetwork({ mode: 'disabled', allow_net: [] }),
        { mode: 'disabled', allow_net: [] },
    );
});
