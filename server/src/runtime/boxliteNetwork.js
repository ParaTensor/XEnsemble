/**
 * Resolve outbound network for blink / boxlite sessions.
 * Matches blink-server `network` field on POST /api/sessions.
 */

const DEFAULT_MODE = 'enabled';

function parseAllowNet(raw) {
    if (!raw?.trim()) return [];
    return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseMode(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value || value === 'enabled' || value === '1' || value === 'true' || value === 'on') {
        return 'enabled';
    }
    if (value === 'disabled' || value === '0' || value === 'false' || value === 'off') {
        return 'disabled';
    }
    throw new Error(`invalid BLINK_NETWORK value ${raw}; expected enabled or disabled`);
}

function resolveBoxliteSessionNetwork(override) {
    if (override && typeof override === 'object') {
        const mode = override.mode === 'disabled' ? 'disabled' : 'enabled';
        const allowNet = Array.isArray(override.allow_net)
            ? override.allow_net.map(String).filter(Boolean)
            : [];
        if (mode === 'disabled' && allowNet.length > 0) {
            throw new Error('network.mode=disabled is incompatible with allow_net');
        }
        return { mode, allow_net: allowNet };
    }

    const mode = parseMode(process.env.BLINK_NETWORK || DEFAULT_MODE);
    const allowNet = parseAllowNet(process.env.BLINK_ALLOW_NET);
    if (mode === 'disabled' && allowNet.length > 0) {
        throw new Error('BLINK_NETWORK=disabled is incompatible with BLINK_ALLOW_NET');
    }
    return { mode, allow_net: allowNet };
}

module.exports = {
    resolveBoxliteSessionNetwork,
};
