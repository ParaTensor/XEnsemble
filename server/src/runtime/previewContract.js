const fs = require('fs');
const path = require('path');
const { RuntimeError } = require('./interfaces');

const SCRIPT_PRIORITY = ['dev', 'start', 'preview'];

const DEFAULT_PREVIEW_JSON = {
    command: 'npx',
    args: ['--yes', 'serve', '.', '--listen', '$PORT', '--no-clipboard'],
    port: 5173,
};

const DEFAULT_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Preview</title>
</head>
<body>
  <h1>Workspace ready</h1>
  <p>Edit files here, or update <code>.agents/preview.json</code> to change how preview starts.</p>
</body>
</html>
`;

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Idempotent: ensure `.agents/preview.json` (and starter index.html) exist for new workspaces.
 */
function ensurePreviewContractFile(workspacePath) {
    const agentsDir = path.join(workspacePath, '.agents');
    const agentsPath = path.join(agentsDir, 'preview.json');
    if (!fs.existsSync(agentsPath)) {
        fs.mkdirSync(agentsDir, { recursive: true });
        fs.writeFileSync(agentsPath, `${JSON.stringify(DEFAULT_PREVIEW_JSON, null, 2)}\n`, 'utf8');
    }
    const indexPath = path.join(workspacePath, 'index.html');
    if (!fs.existsSync(indexPath)) {
        fs.writeFileSync(indexPath, DEFAULT_INDEX_HTML, 'utf8');
    }
}

/**
 * Parse preview contract: `.agents/preview.json` > package.json scripts.
 * @returns {{ shell: string, port: number }}
 */
function resolvePreviewContract(workspacePath) {
    ensurePreviewContractFile(workspacePath);

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
            'Invalid .agents/preview.json: "command" is required (or add package.json with a dev script)',
            400,
        );
    }

    const pkg = readJsonSafe(pkgPath);
    const scripts = pkg?.scripts || {};
    const scriptName = SCRIPT_PRIORITY.find((name) => scripts[name]);
    if (!scriptName) {
        throw new RuntimeError(
            'package.json has no dev/start/preview script; fix .agents/preview.json instead',
            400,
        );
    }

    const port = Number(process.env.PREVIEW_DEFAULT_PORT) || 5173;
    return { shell: `npm run ${scriptName}`, port };
}

module.exports = {
    DEFAULT_PREVIEW_JSON,
    ensurePreviewContractFile,
    resolvePreviewContract,
};
