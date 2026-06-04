const httpProxy = require('http-proxy');
const auth = require('../auth/index');
const deploymentService = require('../deployments/DeploymentService');
const previewRegistry = require('../runtime/localPreviewRegistry');

const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: true,
    changeOrigin: true,
});

proxy.on('error', (err, req, res) => {
    if (res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Preview proxy error');
    }
    console.error('[preview-gateway]', err.message);
});

function extractToken(request) {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
    try {
        const url = new URL(request.url, 'http://localhost');
        return url.searchParams.get('access_token');
    } catch {
        return null;
    }
}

async function resolveDeployment(request, deploymentId) {
    const token = extractToken(request);
    if (!token) return { error: 'Unauthorized', status: 401 };
    const user = auth.verifyToken(token);
    if (!user) return { error: 'Unauthorized', status: 401 };

    const row = await deploymentService.getForUser(user.id, deploymentId);
    if (!row) return { error: 'Deployment not found', status: 404 };
    if (row.status !== 'running') {
        return { error: 'Preview is not running', status: 503 };
    }

    const entry = previewRegistry.get(deploymentId);
    if (!entry) return { error: 'Preview process not found', status: 503 };

    return { user, deployment: row, entry };
}

function stripPreviewPrefix(url, deploymentId) {
    const prefix = `/preview/${deploymentId}`;
    const [pathname, search = ''] = url.split('?');
    let path = pathname;
    if (path === prefix || path === `${prefix}/`) {
        path = '/';
    } else if (path.startsWith(`${prefix}/`)) {
        path = path.slice(prefix.length) || '/';
    }
    const qs = new URLSearchParams(search);
    qs.delete('access_token');
    const rest = qs.toString();
    return rest ? `${path}?${rest}` : path;
}

/**
 * 注册 Preview Gateway（HTTP + WebSocket），对齐 Architecture.md Gateway 节。
 */
async function proxyPreviewRequest(request, reply) {
    const deploymentId = request.params.deploymentId;
    const resolved = await resolveDeployment(request.raw, deploymentId);
    if (resolved.error) {
        return reply.code(resolved.status).send({ error: resolved.error });
    }

    const target = `http://127.0.0.1:${resolved.entry.port}`;
    const path = stripPreviewPrefix(request.url, deploymentId);

    await new Promise((resolve, reject) => {
        reply.hijack();
        request.raw.url = path;
        proxy.web(
            request.raw,
            reply.raw,
            { target, changeOrigin: true },
            (err) => {
                if (err) reject(err);
                else resolve();
            },
        );
    });
}

async function registerPreviewGateway(fastify) {
    const proxyOpts = {
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        handler: proxyPreviewRequest,
    };
    fastify.route({ url: '/preview/:deploymentId', ...proxyOpts });
    fastify.route({ url: '/preview/:deploymentId/*', ...proxyOpts });

    fastify.server.on('upgrade', async (req, socket, head) => {
        const match = req.url?.match(/^\/preview\/([^/?]+)/);
        if (!match) return;

        const deploymentId = match[1];
        const resolved = await resolveDeployment(req, deploymentId);
        if (resolved.error) {
            socket.write(`HTTP/1.1 ${resolved.status} ${resolved.error}\r\n\r\n`);
            socket.destroy();
            return;
        }

        const target = `http://127.0.0.1:${resolved.entry.port}`;
        req.url = stripPreviewPrefix(req.url, deploymentId);
        proxy.ws(req, socket, head, { target }, (err) => {
            if (err) socket.destroy();
        });
    });
}

module.exports = { registerPreviewGateway };
