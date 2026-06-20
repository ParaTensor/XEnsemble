const { test } = require('node:test');
const assert = require('node:assert');
const { appendScrollback, readScrollback, removeScrollback } = require('./LocalScrollbackBuffer');

test('append and read scrollback', () => {
    const ref = 'local:pty:12345';
    removeScrollback(ref);
    appendScrollback(ref, 'hello\n');
    appendScrollback(ref, 'world\n');
    assert.ok(readScrollback(ref).includes('world'));
    removeScrollback(ref);
});
