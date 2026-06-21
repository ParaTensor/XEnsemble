const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fastify = require('fastify');
const { registerLlmProxy } = require('./proxy');
const { issueSessionToken } = require('./sessionToken');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const { resetLlmQuotaForTests } = require('./quota');

const TEST_SESSION_ID = 'sess_proxy_models_test';
const TEST_AGENT_ID = 'proxy-models-test';

process.env.LLM_GATEWAY_UPSTREAM_URL = 'http://127.0.0.1:8741';

describe('LLM proxy /v1/models', () => {
    let app;
    let testUserId;
    let originalConfig;

    before(async () => {
        resetLlmQuotaForTests();

        const users = await db.select().from(schema.users).limit(1);
        assert.ok(users.length > 0, 'need at least one user in database');
        testUserId = users[0].id;

        const cfgRows = await db
            .select()
            .from(schema.platformSettings)
            .where(eq(schema.platformSettings.key, 'agent_gateway_config'));
        originalConfig = cfgRows[0]?.value || '{}';

        const next = { ...JSON.parse(originalConfig), [TEST_AGENT_ID]: { llm_auth_mode: 'gateway', provider: 'deepseek', model: 'deepseek-v4-flash' } };
        if (cfgRows.length > 0) {
            await db.update(schema.platformSettings).set({ value: JSON.stringify(next) }).where(eq(schema.platformSettings.key, 'agent_gateway_config'));
        } else {
            await db.insert(schema.platformSettings).values({ key: 'agent_gateway_config', value: JSON.stringify(next) });
        }

        await db.delete(schema.sessions).where(eq(schema.sessions.id, TEST_SESSION_ID));
        await db.insert(schema.sessions).values({
            id: TEST_SESSION_ID,
            userId: testUserId,
            agentId: TEST_AGENT_ID,
            cwd: '/tmp',
            status: 'running',
            createdAt: Date.now(),
        });

        app = fastify({ logger: false });
        await registerLlmProxy(app);
        await app.ready();
    });

    after(async () => {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, TEST_SESSION_ID));
        const cfgRows = await db
            .select()
            .from(schema.platformSettings)
            .where(eq(schema.platformSettings.key, 'agent_gateway_config'));
        if (cfgRows.length > 0) {
            await db
                .update(schema.platformSettings)
                .set({ value: originalConfig })
                .where(eq(schema.platformSettings.key, 'agent_gateway_config'));
        }
        if (app) await app.close();
    });

    it('returns the configured gateway model from /v1/models', { timeout: 5000 }, async () => {
        const token = issueSessionToken({
            sessionId: TEST_SESSION_ID,
            userId: testUserId,
            projectId: 'proj_test',
            agentId: TEST_AGENT_ID,
            role: 'admin',
        });

        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/llm/v1/models',
            headers: { authorization: `Bearer ${token}` },
        });

        assert.equal(res.statusCode, 200, res.body);
        const body = JSON.parse(res.body);
        assert.equal(body.object, 'list');
        assert.ok(Array.isArray(body.data));
        assert.ok(body.data.some((m) => m.id === 'deepseek/deepseek-v4-flash'));
    });
});
