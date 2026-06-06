const platformSettings = require('./PlatformSettings');

const DEFAULT_BIND_ADDR = process.env.UNIGATEWAY_BIND_ADDR || '127.0.0.1:8741';

const DEFAULTS = {
    bind_addr: DEFAULT_BIND_ADDR,
    auto_start: true,
};

function parseBindAddr(bindAddr) {
    const trimmed = String(bindAddr || '').trim();
    const lastColon = trimmed.lastIndexOf(':');
    if (lastColon <= 0) {
        throw Object.assign(new Error('Invalid bind address (expected host:port)'), { statusCode: 400 });
    }
    const host = trimmed.slice(0, lastColon).trim();
    const port = Number.parseInt(trimmed.slice(lastColon + 1), 10);
    if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
        throw Object.assign(new Error('Invalid bind address (expected host:port)'), { statusCode: 400 });
    }
    return { host, port, bind_addr: `${host}:${port}` };
}

async function getConfig() {
    const bind_addr = (await platformSettings.get('gateway_bind_addr')) || DEFAULTS.bind_addr;
    const auto_start = (await platformSettings.get('gateway_auto_start'));
    return {
        bind_addr: parseBindAddr(bind_addr).bind_addr,
        auto_start: auto_start !== false,
    };
}

async function updateConfig(updates = {}) {
    const current = await getConfig();
    const next = { ...current };

    if (updates.bind_addr !== undefined) {
        next.bind_addr = parseBindAddr(updates.bind_addr).bind_addr;
        await platformSettings.set('gateway_bind_addr', next.bind_addr);
    }
    if (updates.auto_start !== undefined) {
        next.auto_start = Boolean(updates.auto_start);
        await platformSettings.set('gateway_auto_start', next.auto_start);
    }

    return next;
}

module.exports = {
    DEFAULTS,
    parseBindAddr,
    getConfig,
    updateConfig,
};
