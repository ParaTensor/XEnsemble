const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
    loadRuntimeLimits,
    hasActiveLimits,
    buildSystemdRunArgs,
    buildPrlimitArgs,
    buildNiceArgs,
    wrapForLimits,
} = require('./LocalRuntimeLimits');

describe('LocalRuntimeLimits', () => {
    const originalEnv = { ...process.env };

    function resetEnv() {
        delete process.env.RUNTIME_USE_SYSTEMD;
        delete process.env.RUNTIME_CPU_PERCENT;
        delete process.env.RUNTIME_MEMORY_MAX_MB;
        delete process.env.RUNTIME_MAX_PROCESSES;
        delete process.env.RUNTIME_NICE;
    }

    test.afterEach(() => {
        resetEnv();
    });

    test('loadRuntimeLimits returns defaults when no env is set', () => {
        resetEnv();
        const limits = loadRuntimeLimits();
        assert.equal(limits.useSystemd, false);
        assert.equal(limits.cpuPercent, null);
        assert.equal(limits.memoryMaxMb, null);
        assert.equal(limits.maxProcesses, null);
        assert.equal(limits.nice, null);
    });

    test('loadRuntimeLimits parses env values', () => {
        process.env.RUNTIME_USE_SYSTEMD = '1';
        process.env.RUNTIME_CPU_PERCENT = '50';
        process.env.RUNTIME_MEMORY_MAX_MB = '1024';
        process.env.RUNTIME_MAX_PROCESSES = '32';
        process.env.RUNTIME_NICE = '5';

        const limits = loadRuntimeLimits();
        assert.equal(limits.useSystemd, true);
        assert.equal(limits.cpuPercent, 50);
        assert.equal(limits.memoryMaxMb, 1024);
        assert.equal(limits.maxProcesses, 32);
        assert.equal(limits.nice, 5);
    });

    test('loadRuntimeLimits ignores invalid values', () => {
        process.env.RUNTIME_CPU_PERCENT = 'abc';
        process.env.RUNTIME_MEMORY_MAX_MB = '-1';
        process.env.RUNTIME_MAX_PROCESSES = '0';
        process.env.RUNTIME_NICE = '100';

        const limits = loadRuntimeLimits();
        assert.equal(limits.cpuPercent, null);
        assert.equal(limits.memoryMaxMb, null);
        assert.equal(limits.maxProcesses, null);
        assert.equal(limits.nice, null);
    });

    test('hasActiveLimits is false when all limits are empty', () => {
        assert.equal(hasActiveLimits(loadRuntimeLimits()), false);
    });

    test('hasActiveLimits is true when any limit is set', () => {
        assert.equal(hasActiveLimits({ nice: 5 }), true);
        assert.equal(hasActiveLimits({ cpuPercent: 50 }), true);
        assert.equal(hasActiveLimits({ memoryMaxMb: 512 }), true);
        assert.equal(hasActiveLimits({ maxProcesses: 8 }), true);
    });

    test('buildSystemdRunArgs includes all limits and uid/gid', () => {
        const limits = {
            useSystemd: true,
            cpuPercent: 60,
            memoryMaxMb: 512,
            maxProcesses: 16,
        };
        const args = buildSystemdRunArgs('node', ['server.js'], { uid: 1000, gid: 1000 }, limits);
        assert.deepEqual(args, [
            'run', '--scope', '--collect',
            '--uid=1000', '--gid=1000',
            '--property=CPUQuota=60%',
            '--property=MemoryMax=512M',
            '--property=TasksMax=16',
            '--', 'node', 'server.js',
        ]);
    });

    test('buildPrlimitArgs sets memory and process limits', () => {
        const limits = { memoryMaxMb: 256, maxProcesses: 8 };
        const args = buildPrlimitArgs('node', ['server.js'], limits);
        assert.deepEqual(args, [
            '--as=268435456:268435456',
            '--nproc=8:8',
            '--', 'node', 'server.js',
        ]);
    });

    test('buildNiceArgs prepends nice options', () => {
        const args = buildNiceArgs('node', ['server.js'], { nice: 10 });
        assert.deepEqual(args, ['-n', '10', 'node', 'server.js']);
    });

    test('wrapForLimits returns unchanged when no limits active', () => {
        const result = wrapForLimits('node', ['server.js'], { cwd: '/' }, loadRuntimeLimits());
        assert.equal(result.command, 'node');
        assert.deepEqual(result.args, ['server.js']);
        assert.equal(result.options.cwd, '/');
    });

    test('wrapForLimits uses systemd-run in systemd mode', () => {
        const limits = {
            useSystemd: true,
            cpuPercent: 50,
            memoryMaxMb: 1024,
            maxProcesses: 32,
            nice: null,
        };
        const result = wrapForLimits('node', ['server.js'], { cwd: '/', uid: 1000, gid: 1000 }, limits);
        assert.equal(result.command, 'systemd-run');
        assert.ok(result.args.includes('--property=CPUQuota=50%'));
        assert.ok(result.args.includes('--property=MemoryMax=1024M'));
        assert.ok(result.args.includes('--property=TasksMax=32'));
        assert.equal(result.options.uid, undefined);
        assert.equal(result.options.gid, undefined);
    });

    test('wrapForLimits fallback applies nice only', () => {
        const limits = {
            useSystemd: false,
            cpuPercent: 50,
            memoryMaxMb: 512,
            maxProcesses: 16,
            nice: 10,
        };
        const result = wrapForLimits('node', ['server.js'], { cwd: '/' }, limits);
        assert.equal(result.command, 'nice');
        assert.deepEqual(result.args, ['-n', '10', 'node', 'server.js']);
    });
});
