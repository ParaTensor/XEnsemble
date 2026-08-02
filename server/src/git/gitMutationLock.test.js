const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withProjectGitLock } = require('./gitMutationLock');

test('withProjectGitLock serializes mutations for the same project', async () => {
    const order = [];
    const first = withProjectGitLock('proj_a', async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 40));
        order.push('a-end');
        return 1;
    });
    const second = withProjectGitLock('proj_a', async () => {
        order.push('b-start');
        order.push('b-end');
        return 2;
    });
    const values = await Promise.all([first, second]);
    assert.deepEqual(values, [1, 2]);
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});

test('withProjectGitLock allows different projects to run concurrently', async () => {
    let releaseA;
    const aStarted = new Promise((resolve) => { releaseA = resolve; });
    const first = withProjectGitLock('proj_1', async () => {
        await aStarted;
        return 'a';
    });
    let bStarted = false;
    const second = withProjectGitLock('proj_2', async () => {
        bStarted = true;
        return 'b';
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(bStarted, true);
    releaseA();
    assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
});

test('withProjectGitLock is re-entrant for nested same-project calls', async () => {
    const value = await withProjectGitLock('proj_nested', async () => (
        withProjectGitLock('proj_nested', async () => 'ok')
    ));
    assert.equal(value, 'ok');
});
