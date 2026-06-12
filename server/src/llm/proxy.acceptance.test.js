const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fastify = require('fastify');
const { registerLlmProxy } = require('./proxy');
const { issueSessionToken } = require('./sessionToken');
const unigateway = require('../gateway/unigatewayManager');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const { resetLlmQuotaForTests } = require('./quota');

const RUN = process.env.RUN_LLM_ACCEPTANCE === '1';
const TEST_SESSION_ID = 'sess_llm_acceptance_test';

describe('LLM proxy acceptance', { skip: !RUN }, () => {
    let app;
    let testUserId;
    let testProjectId;

    before(async () => {
        resetLlmQuotaForTests();
        const status = await unigateway.start(console, { force: false });
        assert.ok(status.running, `UniGateway must be running: ${status.lastError || 'unknown'}`);

        const users = await db.select().from(schema.users).limit(1);
        assert.ok(users.length > 0, 'need at least one user in database');
        testUserId = users[0].id;

        const projects = await db.select().from(schema.projects)
            .where(eq(schema.projects.userId, testUserId))
            .limit(1);
        if (projects.length > 0) {
            testProjectId = projects[0].id;
        } else {
            const anyProject = await db.select().from(schema.projects).limit(1);
            assert.ok(anyProject.length > 0, 'need at least one project in database');
            testProjectId = anyProject[0].id;
            testUserId = anyProject[0].userId;
        }

        await db.delete(schema.sessions).where(eq(schema.sessions.id, TEST_SESSION_ID));
        await db.insert(schema.sessions).values({
            id: TEST_SESSION_ID,
            userId: testUserId,
            projectId: testProjectId,
            agentId: 'claude-code',
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
        if (app) await app.close();
    });

    it('rejects unauthenticated LLM proxy requests', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/llm/health',
        });
        assert.equal(res.statusCode, 401);
    });

    it('forwards health through session token to UniGateway', async () => {
        const token = issueSessionToken({
            sessionId: TEST_SESSION_ID,
            userId: testUserId,
            projectId: testProjectId,
            agentId: 'claude-code',
            model: 'test-model',
            role: 'admin',
        });

        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/llm/health',
            headers: {
                authorization: `Bearer ${token}`,
            },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.body);
        assert.equal(body.status, 'ok');
        assert.match(body.service, /unigateway/i);
    });

    it('rejects token when session is not running', async () => {
        await db.update(schema.sessions)
            .set({ status: 'exited' })
            .where(eq(schema.sessions.id, TEST_SESSION_ID));

        const token = issueSessionToken({
            sessionId: TEST_SESSION_ID,
            userId: testUserId,
            projectId: testProjectId,
            agentId: 'claude-code',
            role: 'admin',
        });

        const res = await app.inject({
            method: 'GET',
            url: '/api/v1/llm/health',
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(res.statusCode, 401);

        await db.update(schema.sessions)
            .set({ status: 'running' })
            .where(eq(schema.sessions.id, TEST_SESSION_ID));
    });
});
