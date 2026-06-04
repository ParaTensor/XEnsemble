const fs = require('fs');
const path = require('path');
const { RuntimeError } = require('./interfaces');

const SCRIPT_PRIORITY = ['dev', 'start', 'preview'];

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * 解析 preview 启动契约：.agents/preview.json > package.json scripts。
 * @returns {{ shell: string, port: number }}
 */
function resolvePreviewContract(workspacePath) {
    const agentsPath = path.join(workspacePath, '.agents', 'preview.json');
    if (fs.existsSync(agentsPath)) {
        const cfg = readJsonSafe(agentsPath);
        if (cfg?.command) {
            const args = Array.isArray(cfg.args) ? cfg.args : [];
            const port = Number(cfg.port) || 5173;
            const cmd = [cfg.command, ...args].map((s) => String(s)).join(' ');
            return { shell: cmd, port };
        }
    }

    const pkgPath = path.join(workspacePath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        throw new RuntimeError(
            'No preview contract: add package.json with a "dev" script or .agents/preview.json',
            400,
        );
    }

    const pkg = readJsonSafe(pkgPath);
    const scripts = pkg?.scripts || {};
    const scriptName = SCRIPT_PRIORITY.find((name) => scripts[name]);
    if (!scriptName) {
        throw new RuntimeError(
            'package.json has no dev/start/preview script for preview deployment',
            400,
        );
    }

    const port = Number(process.env.PREVIEW_DEFAULT_PORT) || 5173;
    return { shell: `npm run ${scriptName}`, port };
}

module.exports = { resolvePreviewContract };
