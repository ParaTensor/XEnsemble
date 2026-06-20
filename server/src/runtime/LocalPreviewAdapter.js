// 仅 Local 有效：在 workspace 内启动 preview 进程，经 control plane Gateway 暴露 URL。
const net = require('net');
const { spawn } = require('child_process');
const { PreviewAdapter, RuntimeError } = require('./interfaces');
const { resolvePreviewContract } = require('./previewContract');
const { resolvePlatformSecrets, applyGatewaySynthesis } = require('../agents/agentEnv');
const previewRegistry = require('./localPreviewRegistry');

const CONTROL_HOST = process.env.PREVIEW_PUBLIC_HOST || 'localhost';
const { resolvePort } = require('../config/defaultPort');
const CONTROL_PORT = resolvePort();
const PORT_READY_TIMEOUT_MS = 120_000;
const PORT_POLL_MS = 400;

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close((err) => (err ? reject(err) : resolve(port)));
        });
    });
}

function waitForPort(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tryOnce = () => {
            const socket = net.connect({ host: '127.0.0.1', port }, () => {
                socket.end();
                resolve();
            });
            socket.setTimeout(2000);
            socket.on('error', () => {
                socket.destroy();
                if (Date.now() >= deadline) {
                    reject(new RuntimeError(`Preview did not listen on port ${port} in time`, 504));
                    return;
                }
                setTimeout(tryOnce, PORT_POLL_MS);
            });
            socket.on('timeout', () => {
                socket.destroy();
                if (Date.now() >= deadline) {
                    reject(new RuntimeError(`Preview did not listen on port ${port} in time`, 504));
                    return;
                }
                setTimeout(tryOnce, PORT_POLL_MS);
            });
        };
        tryOnce();
    });
}

function killPreviewProcess(entry) {
    if (!entry?.child || entry.child.killed) return;
    const { child } = entry;
    try {
        if (process.platform !== 'win32' && child.pid) {
            try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { /* ignore */ }
        }
        child.kill('SIGTERM');
    } catch (_) { /* ignore */ }
    setTimeout(() => {
        try { if (!child.killed) child.kill('SIGKILL'); } catch (_) { /* ignore */ }
    }, 2000);
}

class LocalPreviewAdapter extends PreviewAdapter {
    async startPreview(project, contract) {
        const deploymentId = contract.deploymentId;
        if (!deploymentId) {
            throw new RuntimeError('deploymentId is required', 400);
        }

        const workspacePath = project.workspacePath;
        if (!workspacePath) {
            throw new RuntimeError('Project workspace is not ready', 503);
        }

        const existing = previewRegistry.get(deploymentId);
        if (existing) {
            killPreviewProcess(existing);
            previewRegistry.remove(deploymentId);
        }

        const spec = resolvePreviewContract(workspacePath);
        const port = await getFreePort();
        const shell = process.env.SHELL || '/bin/bash';
        const previewSecrets = applyGatewaySynthesis(await resolvePlatformSecrets({ forPreview: true }));
        const child = spawn(shell, ['-lc', spec.shell], {
            cwd: workspacePath,
            env: {
                ...process.env,
                ...previewSecrets,
                PORT: String(port),
                HOST: '127.0.0.1',
                BROWSER: 'none',
            },
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let logTail = '';
        const appendLog = (chunk) => {
            logTail = (logTail + chunk.toString()).slice(-8000);
        };
        child.stdout?.on('data', appendLog);
        child.stderr?.on('data', appendLog);

        child.on('exit', (code) => {
            const cur = previewRegistry.get(deploymentId);
            if (cur?.child === child) {
                previewRegistry.remove(deploymentId);
            }
            if (code != null && code !== 0) {
                console.error(`[preview ${deploymentId}] exited ${code}`);
            }
        });

        try {
            await waitForPort(port, PORT_READY_TIMEOUT_MS);
        } catch (err) {
            killPreviewProcess({ child });
            previewRegistry.remove(deploymentId);
            const hint = logTail.trim()
                ? ` Last output: ${logTail.trim().slice(-500)}`
                : '';
            throw new RuntimeError(
                `${err.message}.${hint}`,
                err.statusCode || 504,
            );
        }

        previewRegistry.set(deploymentId, { port, child, workspacePath, startedAt: Date.now() });

        const publicUrl = `http://${CONTROL_HOST}:${CONTROL_PORT}/preview/${deploymentId}/`;
        return {
            publicUrl,
            internalRef: `127.0.0.1:${port}`,
            port,
        };
    }

    async stopPreview(deployment) {
        const id = deployment.id || deployment;
        const entry = previewRegistry.remove(id);
        if (entry) killPreviewProcess(entry);
    }
}

module.exports = LocalPreviewAdapter;
