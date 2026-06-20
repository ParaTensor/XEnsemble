/**
 * Local Process Runtime resource limits.
 *
 * Phase 1 uses OS-level limits. The preferred path is systemd-run --scope,
 * which applies cgroups-v2 limits (CPUQuota, MemoryMax, TasksMax). When
 * systemd is not enabled/available we fall back to prlimit/nice, which only
 * sets per-process RLIMIT values and scheduling priority.
 */

function parsePositiveInt(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
}

function parseNice(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < -20 || n > 19) return null;
    return n;
}

function loadRuntimeLimits() {
    const useSystemd = ['1', 'true', 'yes'].includes(
        (process.env.RUNTIME_USE_SYSTEMD || '').toLowerCase(),
    );
    return {
        useSystemd,
        cpuPercent: parsePositiveInt(process.env.RUNTIME_CPU_PERCENT),
        memoryMaxMb: parsePositiveInt(process.env.RUNTIME_MEMORY_MAX_MB),
        maxProcesses: parsePositiveInt(process.env.RUNTIME_MAX_PROCESSES),
        nice: parseNice(process.env.RUNTIME_NICE),
    };
}

function hasActiveLimits(limits) {
    if (!limits) return false;
    return (
        limits.cpuPercent != null ||
        limits.memoryMaxMb != null ||
        limits.maxProcesses != null ||
        limits.nice != null
    );
}

function buildSystemdRunArgs(command, args, options, limits) {
    // Do not prepend the 'run' subcommand: it only exists in systemd >= 256.
    // Older distributions (e.g. Debian 12 / systemd 252) treat the first
    // positional argument as the executable and fail with "Failed to find
    // executable run". Omitting it uses the default run operation on both.
    const out = ['--scope', '--collect'];
    if (options.uid != null) out.push(`--uid=${options.uid}`);
    if (options.gid != null) out.push(`--gid=${options.gid}`);
    if (limits.cpuPercent != null) {
        out.push(`--property=CPUQuota=${limits.cpuPercent}%`);
    }
    if (limits.memoryMaxMb != null) {
        out.push(`--property=MemoryMax=${limits.memoryMaxMb}M`);
    }
    if (limits.maxProcesses != null) {
        out.push(`--property=TasksMax=${limits.maxProcesses}`);
    }
    out.push('--', command);
    out.push(...args);
    return out;
}

function buildPrlimitArgs(command, args, limits) {
    const out = [];
    if (limits.memoryMaxMb != null) {
        const bytes = limits.memoryMaxMb * 1024 * 1024;
        out.push(`--as=${bytes}:${bytes}`);
    }
    if (limits.maxProcesses != null) {
        out.push(`--nproc=${limits.maxProcesses}:${limits.maxProcesses}`);
    }
    out.push('--', command);
    out.push(...args);
    return out;
}

function buildNiceArgs(command, args, limits) {
    return ['-n', String(limits.nice), command, ...args];
}

function wrapForLimits(command, args, options, limits) {
    // prlimit --as (RLIMIT_AS) limits total virtual address space, not physical
    // memory. Node-based agents (kimi, claude-code, etc.) reserve large virtual
    // address ranges for V8 and WebAssembly memory, so --as causes them to exit
    // with "Out of memory: Cannot allocate Wasm memory". RLIMIT_NPROC counts
    // processes per real UID, so --nproc also affects the backend user and is
    // unsafe in fallback mode. CPU, memory and task limits require cgroups,
    // i.e. RUNTIME_USE_SYSTEMD=1.
    const effectiveLimits = limits.useSystemd
        ? limits
        : { ...limits, memoryMaxMb: null, maxProcesses: null, cpuPercent: null };

    if (!hasActiveLimits(effectiveLimits)) {
        return { command, args, options };
    }

    if (limits.useSystemd) {
        return {
            command: 'systemd-run',
            args: buildSystemdRunArgs(command, args, options, effectiveLimits),
            options: { ...options, uid: undefined, gid: undefined },
        };
    }

    // Fallback: nice (CPU scheduling priority) only.
    if (effectiveLimits.nice != null) {
        return {
            command: 'nice',
            args: buildNiceArgs(command, args, effectiveLimits),
            options,
        };
    }

    return { command, args, options };
}

module.exports = {
    loadRuntimeLimits,
    hasActiveLimits,
    buildSystemdRunArgs,
    buildPrlimitArgs,
    buildNiceArgs,
    wrapForLimits,
};
