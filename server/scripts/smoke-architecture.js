#!/usr/bin/env node
/** 本地架构冒烟：模块加载 + preview 契约解析 */
require('../src/db/index');
const { ensureProjectRuntime, formatRuntime } = require('../src/runtime/RuntimeService');
const { resolvePreviewContract } = require('../src/runtime/previewContract');
const path = require('path');
const fs = require('fs');
const os = require('os');

async function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xensemble-smoke-'));
    const pkgDir = path.join(tmp, 'proj');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ scripts: { dev: 'node -e "require(\'http\').createServer((q,s)=>s.end(\'ok\')).listen(process.env.PORT||5173)"' } }),
    );

    const spec = resolvePreviewContract(pkgDir);
    if (!spec.shell.includes('dev')) throw new Error('preview contract failed');

    console.log('smoke-architecture: ok', { spec, formatRuntime: typeof formatRuntime });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
