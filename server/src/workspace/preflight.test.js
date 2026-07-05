const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { collectHints } = require('./preflight');

describe('preflight helpers', () => {
    it('collects actionable hints from failed checks', () => {
        const hints = collectHints({
            secrets: { ok: false, missing: ['ANTHROPIC_API_KEY'] },
            workspace_setup: { ok: false, message: 'Workspace setup has not run yet' },
            gateway: { ok: true },
        });
        assert.ok(hints.some((h) => h.includes('ANTHROPIC_API_KEY')));
        assert.ok(hints.some((h) => h.includes('setup')));
    });
});
