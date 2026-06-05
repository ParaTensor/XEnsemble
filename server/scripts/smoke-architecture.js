#!/usr/bin/env node
/** 本地架构冒烟：模块加载 + preview 契约解析 */
require('../src/db/index');
const { ensureProjectRuntime, formatRuntime } = require('../src/runtime/RuntimeService');
const { resolvePreviewContract, ensurePreviewContractFile } = require('../src/runtime/previewContract');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xensemble-smoke-'));
    const pkgDir = path.join(tmp, 'proj');
    fs.mkdirSync(pkgDir, { recursive: true });

    ensurePreviewContractFile(pkgDir);
    const agentsSpec = resolvePreviewContract(pkgDir);
    if (!agentsSpec.shell.includes('serve')) throw new Error('preview.json contract failed');

    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ scripts: { dev: 'node -e "require(\'http\').createServer((q,s)=>s.end(\'ok\')).listen(process.env.PORT||5173)"' } }),
    );
    fs.writeFileSync(
        path.join(pkgDir, '.agents', 'preview.json'),
        JSON.stringify({ command: 'npm', args: ['run', 'dev'], port: 5173 }),
    );
    const npmSpec = resolvePreviewContract(pkgDir);
    if (!npmSpec.shell.includes('dev')) throw new Error('preview.json override failed');

    console.log('smoke-architecture: ok', { agentsSpec, npmSpec, formatRuntime: typeof formatRuntime });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
