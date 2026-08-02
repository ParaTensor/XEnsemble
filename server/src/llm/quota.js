const policy = require('../auth/PolicyService');
const PlatformSettings = require('../admin/PlatformSettings');

const TIER_QPS = {
    basic: 12,
    standard: 30,
    pro: 60,
    enterprise: 120,
};

const WINDOW_MS = 60_000;
const buckets = new Map();
let _lastCleanup = 0;

function bucketKey(userId) {
    const slot = Math.floor(Date.now() / WINDOW_MS);
    return `${userId}:${slot}`;
}

function settingsKey(bucket) {
    return `llm_quota_bucket:${bucket}`;
}

function cleanupExpiredBuckets() {
    const now = Date.now();
    if (now - _lastCleanup < WINDOW_MS) return;
    _lastCleanup = now;
    const currentSlot = Math.floor(now / WINDOW_MS);
    for (const key of buckets.keys()) {
        const parts = key.split(':');
        const slot = Number(parts[parts.length - 1]);
        if (Number.isFinite(slot) && slot < currentSlot) {
            buckets.delete(key);
        }
    }
}

async function loadBucketCount(key) {
    if (buckets.has(key)) return buckets.get(key);
    try {
        const stored = await PlatformSettings.get(settingsKey(key));
        const count = Number(stored);
        const value = Number.isFinite(count) && count > 0 ? count : 0;
        buckets.set(key, value);
        return value;
    } catch {
        buckets.set(key, 0);
        return 0;
    }
}

function persistBucketCount(key, count) {
    PlatformSettings.set(settingsKey(key), count).catch(() => { /* best-effort */ });
}

async function checkLlmRequestQuota(userId, role) {
    if (role === 'admin') return { ok: true };

    const quotaRow = await policy.ensureUserQuota(userId);
    const limit = TIER_QPS[quotaRow.resourceTier] ?? TIER_QPS.basic;
    const key = bucketKey(userId);
    const current = await loadBucketCount(key);
    if (current >= limit) {
        return {
            ok: false,
            status: 429,
            error: 'LLM request quota exceeded for your resource tier',
            limit,
            window_seconds: WINDOW_MS / 1000,
        };
    }
    const next = current + 1;
    buckets.set(key, next);
    persistBucketCount(key, next);
    cleanupExpiredBuckets();
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
