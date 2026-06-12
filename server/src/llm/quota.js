const policy = require('../auth/PolicyService');

const TIER_QPS = {
    basic: 12,
    standard: 30,
    pro: 60,
    enterprise: 120,
};

const WINDOW_MS = 60_000;
const buckets = new Map();

function bucketKey(userId) {
    const slot = Math.floor(Date.now() / WINDOW_MS);
    return `${userId}:${slot}`;
}

async function checkLlmRequestQuota(userId, role) {
    if (role === 'admin') return { ok: true };

    const quotaRow = await policy.ensureUserQuota(userId);
    const limit = TIER_QPS[quotaRow.resourceTier] ?? TIER_QPS.basic;
    const key = bucketKey(userId);
    const current = buckets.get(key) ?? 0;
    if (current >= limit) {
        return {
            ok: false,
            status: 429,
            error: 'LLM request quota exceeded for your resource tier',
            limit,
            window_seconds: WINDOW_MS / 1000,
        };
    }
    buckets.set(key, current + 1);
    return { ok: true, limit };
}

function resetLlmQuotaForTests() {
    buckets.clear();
}

module.exports = {
    TIER_QPS,
    checkLlmRequestQuota,
    resetLlmQuotaForTests,
};
