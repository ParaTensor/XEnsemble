const path = require('path');
const fs = require('fs');

const KNOWN_CLI_LOCATIONS = {
    kimi: ['.kimi-code/bin/kimi'],
    agent: ['.local/bin/agent', '.local/bin/cursor-agent'],
    cursor: ['.local/bin/agent', '.local/bin/cursor-agent', '.local/bin/cursor'],
    claude: ['.local/bin/claude'],
    droid: ['.local/bin/droid', '.local/bin/factoryd'],
    hermes: ['.local/bin/hermes'],
    openclaw: ['.openclaw/bin/openclaw', '.local/bin/openclaw'],
    amp: ['.local/bin/amp', '.amp/bin/amp'],
    commandcode: ['.local/bin/commandcode', '.local/bin/cmd'],
    opencode: ['.opencode/bin/opencode', '.local/bin/opencode'],
    cline: ['.local/bin/cline'],
    codebuddy: ['.local/bin/codebuddy'],
    zai: ['.local/bin/zai'],
    qodercli: ['.local/bin/qodercli'],
    qwen: ['.local/bin/qwen'],
    mmx: ['.local/bin/mmx'],
    pi: ['.local/bin/pi', '.pi/bin/pi'],
    copilot: ['.local/bin/copilot'],
};

const HOME_PATH_PREFIXES = [
    '.kimi-code/bin',
    '.local/bin',
    '.opencode/bin',
    '.amp/bin',
    '.openclaw/bin',
    '.hermes/bin',
    '.pi/bin',
];

function isExecutable(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return fs.existsSync(filePath);
    }
}

function enrichPath(env = process.env) {
    const home = env.HOME || process.env.HOME;
    const nodeBinDir = path.dirname(process.execPath);
    const extra = [];
    if (nodeBinDir && fs.existsSync(nodeBinDir)) extra.push(nodeBinDir);
    if (home) {
        for (const rel of HOME_PATH_PREFIXES) {
            const dir = path.join(home, rel);
            if (fs.existsSync(dir)) extra.push(dir);
        }
    }
    const parts = [...extra, ...(env.PATH || process.env.PATH || '').split(path.delimiter)].filter(Boolean);
    const seen = new Set();
    const merged = parts.filter((p) => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
    });
    return merged.join(path.delimiter);
}

function resolveExecutable(cmd, env = process.env) {
    if (path.isAbsolute(cmd) || cmd.includes(path.sep)) {
        return isExecutable(cmd) ? cmd : null;
    }
    const spawnEnv = { ...env, PATH: enrichPath(env) };
    const pathDirs = (spawnEnv.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
        const candidate = path.join(dir, cmd);
        if (isExecutable(candidate)) return candidate;
    }
    return null;
}

function findOffPathInstall(cmd) {
    const nodeBinCandidate = path.join(path.dirname(process.execPath), cmd);
    if (isExecutable(nodeBinCandidate)) return nodeBinCandidate;

    const home = process.env.HOME;
    if (!home) return null;
    const relPaths = KNOWN_CLI_LOCATIONS[cmd] || [];
    for (const rel of relPaths) {
        const full = path.join(home, rel);
        if (isExecutable(full)) return full;
    }
    return null;
}

function formatHomePath(filePath) {
    if (!filePath || typeof filePath !== 'string') return filePath;
    const home = process.env.HOME;
    if (!home) return filePath;
    const normalizedHome = home.endsWith(path.sep) ? home.slice(0, -1) : home;
    if (filePath === normalizedHome) return '~';
    const prefix = normalizedHome + path.sep;
    if (filePath.startsWith(prefix)) {
        return '~' + filePath.slice(normalizedHome.length);
    }
    return filePath;
}

function probeAgent(cmd) {
    const resolved = resolveExecutable(cmd) || findOffPathInstall(cmd);
    return {
        installed: Boolean(resolved),
        path: resolved,
    };
}

module.exports = {
    probeAgent,
    resolveExecutable,
    enrichPath,
    formatHomePath,
    KNOWN_CLI_LOCATIONS,
};
