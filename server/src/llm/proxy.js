const httpProxy = require('http-proxy');
const unigateway = require('../gateway/unigatewayManager');
const { verifySessionToken } = require('./sessionToken');
const { resolveGatewayUpstreamUrl } = require('./gatewayUpstream');
const { withAgentService } = require('./serviceRouter');
const { checkLlmRequestQuota } = require('./quota');
const { recordEvent } = require('../events/recordEvent');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');

const LLM_PROXY_PREFIX = '/api/v1/llm';

const proxy = httpProxy.createProxyServer({
    xfwd: true,
    changeOrigin: true,
});

proxy.on('error', (err, req, res) => {
    if (res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'LLM proxy error' }));
    }
    console.error('[llm-proxy]', err.message);
});

function extractBearerToken(request) {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
    const apiKey = request.headers['x-api-key'];
    if (apiKey?.trim()) return apiKey.trim();
    return null;
}

function stripLlmPrefix(url) {
    const [pathname, search = ''] = url.split('?');
    let path = pathname;
    if (path === LLM_PROXY_PREFIX || path === `${LLM_PROXY_PREFIX}/`) {
        path = '/';
    } else if (path.startsWith(`${LLM_PROXY_PREFIX}/`)) {
        path = path.slice(LLM_PROXY_PREFIX.length) || '/';
    }
    const qs = search.startsWith('?') ? search.slice(1) : search;
    return qs ? `${path}?${qs}` : path;
}

async function assertSessionAuthorized(claims) {
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, claims.sid));
    if (rows.length === 0) return { ok: false, status: 401, error: 'Session not found' };
    const row = rows[0];
    if (row.userId !== claims.uid) return { ok: false, status: 403, error: 'Forbidden' };
    if (row.status !== 'running') return { ok: false, status: 401, error: 'Session is not active' };
    return { ok: true, session: row };
}

async function resolveGatewayTarget(log) {
    const upstream = await resolveGatewayUpstreamUrl(log);
    if (upstream?.error) return upstream;
    const secrets = unigateway.ensureGatewaySecrets();
    return {
        baseUrl: upstream,
        gatewayKey: secrets.gatewayKey,
    };
}

function forwardToGateway(request, reply, { targetBaseUrl, gatewayKey, path }) {
    return new Promise((resolve, reject) => {
        reply.hijack();
        request.raw.url = path;
        request.raw.headers.authorization = `Bearer ${gatewayKey}`;
        proxy.web(
            request.raw,
            reply.raw,
            { target: targetBaseUrl, changeOrigin: true },
            (err) => {
                if (err) reject(err);
                else resolve();
            },
        );
    });
}

async function proxyLlmRequest(request, reply) {
    const rawToken = extractBearerToken(request.raw);
    if (!rawToken) {
        return reply.code(401).send({ error: 'Missing session token (Authorization: Bearer xel_…)' });
    }

    const claims = verifySessionToken(rawToken);
    if (!claims) {
        return reply.code(401).send({ error: 'Invalid or expired session token' });
    }

    const authz = await assertSessionAuthorized(claims);
    if (!authz.ok) {
        return reply.code(authz.status).send({ error: authz.error });
    }

    const quota = await checkLlmRequestQuota(claims.uid, claims.role);
    if (!quota.ok) {
        return reply.code(quota.status).send({
            error: quota.error,
            limit: quota.limit,
            window_seconds: quota.window_seconds,
        });
    }

    const gateway = await resolveGatewayTarget(request.log);
    if (gateway.error) {
        return reply.code(gateway.status).send({ error: gateway.error });
    }

    const path = stripLlmPrefix(request.url);
    const started = Date.now();
    request.log.info(
        {
            sessionId: claims.sid,
            userId: claims.uid,
            projectId: claims.pid,
            agentId: claims.aid,
            model: claims.model || null,
            path,
            method: request.method,
        },
        '[llm-proxy] forwarding',
    );

    try {
        await withAgentService(claims.aid, request.log, async () => {
            await forwardToGateway(request, reply, {
                targetBaseUrl: gateway.baseUrl,
                gatewayKey: gateway.gatewayKey,
                path,
            });
        });

        recordEvent({
            userId: claims.uid,
            projectId: claims.pid,
            subjectType: 'session',
            subjectId: claims.sid,
            type: 'llm_proxy_forward',
            data: {
                agent_id: claims.aid,
                path,
                method: request.method,
                latency_ms: Date.now() - started,
            },
        }).catch((err) => request.log.warn(err, '[llm-proxy] failed to record event'));
    } catch (err) {
        request.log.error(err, '[llm-proxy] forward failed');
        if (!reply.sent) {
            return reply.code(502).send({ error: 'LLM proxy error' });
        }
    }
}

async function registerLlmProxy(fastify) {
    const proxyOpts = {
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        handler: proxyLlmRequest,
    };
    fastify.route({ url: LLM_PROXY_PREFIX, ...proxyOpts });
    fastify.route({ url: `${LLM_PROXY_PREFIX}/*`, ...proxyOpts });
}

module.exports = { registerLlmProxy, LLM_PROXY_PREFIX };
