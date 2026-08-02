const { test } = require('node:test');
const assert = require('node:assert/strict');
const { looksBinary, limitDiffText, limitFileSide } = require('./diffUtils');

test('looksBinary detects null bytes', () => {
    assert.equal(looksBinary('hello\u0000world'), true);
    assert.equal(looksBinary('plain text\n'), false);
});

test('limitDiffText truncates oversized diffs', () => {
    const big = `${'a'.repeat(2000)}\n`;
    const result = limitDiffText(big, { maxBytes: 500 });
    assert.equal(result.truncated, true);
    assert.ok(result.diff.includes('[diff truncated'));
    assert.ok(result.omittedBytes > 0);
});

test('limitFileSide blanks binary content', () => {
    const result = limitFileSide('abc\u0000def', { maxBytes: 1000 });
    assert.equal(result.binary, true);
    assert.equal(result.content, '');
    assert.equal(result.truncated, true);
});
