const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { stripLlmPrefix, normalizeUpstreamPath, isQuotaExemptPath } = require('./proxy');

describe('LLM proxy path normalization', () => {
    it('rewrites OpenAI chat path missing /v1 prefix (Kimi Code gateway mode)', () => {
        assert.equal(
            stripLlmPrefix('/api/v1/llm/chat/completions'),
            '/v1/chat/completions',
        );
    });

    it('preserves canonical /v1/chat/completions path', () => {
        assert.equal(
            stripLlmPrefix('/api/v1/llm/v1/chat/completions'),
            '/v1/chat/completions',
        );
    });

    it('preserves /v1/models paths used for model metadata', () => {
        assert.equal(
            stripLlmPrefix('/api/v1/llm/v1/models/deepseek/deepseek-v4-flash'),
            '/v1/models/deepseek/deepseek-v4-flash',
        );
    });

    it('rewrites /embeddings without /v1 prefix', () => {
        assert.equal(normalizeUpstreamPath('/embeddings'), '/v1/embeddings');
    });

    it('marks health and models as quota-exempt', () => {
        assert.equal(isQuotaExemptPath('/health'), true);
        assert.equal(isQuotaExemptPath('/v1/models'), true);
        assert.equal(isQuotaExemptPath('/v1/models/foo'), true);
        assert.equal(isQuotaExemptPath('/v1/chat/completions'), false);
    });
});
