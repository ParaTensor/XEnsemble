const { FsAdapter, RuntimeError } = require('./interfaces');
const BoxLiteClient = require('./BoxLiteClient');

function safeRel(p) {
    const s = String(p || '.').replace(/\\/g, '/').replace(/^\//, '');
    if (s.includes('..')) return '.';
    return s || '.';
}

class BoxLiteFsAdapter extends FsAdapter {
    constructor() {
        super();
        this.client = new BoxLiteClient();
    }

    async fsList(rootDir, relativePath = '.', opts = {}) {
        const name = opts.runtimeRef;
        if (!name) return [];
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';
        try {
            const cmd = `cd ${JSON.stringify(cwd)} && find ${JSON.stringify(rel)} -maxdepth 2 \\( -type f -o -type d \\) -printf '%y %p\\n' 2>/dev/null | head -200`;
            const r = await this.client.execForResult(name, 'sh', ['-c', cmd], {}, cwd);
            const out = (r.stdout || '').trim();
            if (!out) return [];
            const root = rootDir || '/workspace';
            const res = [];
            for (const line of out.split('\n')) {
                if (!line.trim()) continue;
                const t = line[0];
                let p = line.slice(2).trim();
                if (!p || p === '.' || p === '..') continue;
                if (p.startsWith('./')) p = p.slice(2);
                const nameOnly = p.split('/').pop() || p;
                res.push({
                    name: nameOnly,
                    path: p,
                    type: t === 'd' ? 'directory' : 'file',
                });
            }
            return res;
        } catch (_) {
            return [];
        }
    }

    async fsRead(rootDir, relativePath, opts = {}) {
        const name = opts.runtimeRef;
        if (!name) throw new RuntimeError('runtimeRef required', 400);
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';
        try {
            const target = rel.startsWith('/') ? rel : (cwd.replace(/\/$/, '') + '/' + rel);
            const r = await this.client.execForResult(name, 'cat', [target], {}, cwd);
            if (r.exitCode !== 0) throw new RuntimeError('read failed', 404);
            return r.stdout || '';
        } catch (e) {
            throw new RuntimeError(e.message || 'fs read error', 500);
        }
    }
}

module.exports = BoxLiteFsAdapter;
