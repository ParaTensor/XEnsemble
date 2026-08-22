const { FsAdapter, RuntimeError } = require('./interfaces');
const { SandboxInstance } = require('@blaxel/core');
const { isHiddenWorkspacePath } = require('../workspace/hiddenPaths');

function safeRel(p) {
    const s = String(p || '.').replace(/\\/g, '/').replace(/^\//, '');
    if (s.includes('..')) return '.';
    return s || '.';
}

class BlaxelFsAdapter extends FsAdapter {
    constructor() {
        super();
    }

    async _getSandbox(name) {
        return SandboxInstance.get(name);
    }

    async fsList(rootDir, relativePath = '.', opts = {}) {
        const name = opts.runtimeRef;
        if (!name) return [];
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';

        try {
            const sandbox = await this._getSandbox(name);
            const targetPath = rel === '.' ? cwd : `${cwd}/${rel}`.replace(/\/+/g, '/');

            const result = await sandbox.filesystem.listDirectory({
                path: targetPath,
                recursive: opts.depth !== 'single',
            });

            const entries = [];
            const items = result?.entries || result || [];

            for (const item of Array.isArray(items) ? items : []) {
                const itemPath = item.path || item.name || '';
                if (!itemPath || itemPath === '.' || itemPath === '..') continue;

                let relPath = itemPath;
                if (relPath.startsWith(targetPath)) {
                    relPath = relPath.slice(targetPath.length).replace(/^\//, '');
                }
                if (!relPath) continue;
                if (!opts.includeHidden && isHiddenWorkspacePath(relPath)) continue;

                const entry = {
                    name: itemPath.split('/').pop() || relPath,
                    path: relPath,
                    type: item.type === 'directory' ? 'directory' : 'file',
                };
                if (entry.type === 'file' && item.size != null) {
                    entry.size = item.size;
                }
                entries.push(entry);
            }

            return entries;
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
            const sandbox = await this._getSandbox(name);
            const targetPath = rel.startsWith('/') ? rel : `${cwd}/${rel}`.replace(/\/+/g, '/');

            const result = await sandbox.filesystem.getFile({ path: targetPath });
            return result?.content || result || '';
        } catch (e) {
            throw new RuntimeError(e.message || 'fs read error', 500);
        }
    }

    async fsStat(rootDir, relativePath, opts = {}) {
        const name = opts.runtimeRef;
        if (!name) throw new RuntimeError('runtimeRef required', 400);
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';

        try {
            const sandbox = await this._getSandbox(name);
            const targetPath = rel.startsWith('/') ? rel : `${cwd}/${rel}`.replace(/\/+/g, '/');

            const result = await sandbox.filesystem.getFileInfo({ path: targetPath });
            return {
                type: result?.type === 'directory' ? 'directory' : 'file',
                size: result?.size || 0,
                mtime: result?.mtime || null,
            };
        } catch (e) {
            throw new RuntimeError(e.message || 'fs stat error', 500);
        }
    }

    async fsWrite(rootDir, relativePath, content, opts = {}) {
        const name = opts.runtimeRef;
        if (!name) throw new RuntimeError('runtimeRef required', 400);
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';

        try {
            const sandbox = await this._getSandbox(name);
            const targetPath = rel.startsWith('/') ? rel : `${cwd}/${rel}`.replace(/\/+/g, '/');

            await sandbox.filesystem.putFile({
                path: targetPath,
                body: content,
            });
        } catch (e) {
            throw new RuntimeError(e.message || 'fs write error', 500);
        }
    }

    async fsDelete(rootDir, relativePath, opts = {}) {
        const name = opts.runtimeRef;
        if (!name) throw new RuntimeError('runtimeRef required', 400);
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';

        try {
            const sandbox = await this._getSandbox(name);
            const targetPath = rel.startsWith('/') ? rel : `${cwd}/${rel}`.replace(/\/+/g, '/');

            await sandbox.filesystem.deleteFile({ path: targetPath });
        } catch (e) {
            throw new RuntimeError(e.message || 'fs delete error', 500);
        }
    }

    async fsMove(rootDir, fromRel, toRel, opts = {}) {
        const name = opts.runtimeRef;
        if (!name) throw new RuntimeError('runtimeRef required', 400);
        const cwd = rootDir || '/workspace';
        const fromPath = fromRel.startsWith('/') ? fromRel : `${cwd}/${fromRel}`.replace(/\/+/g, '/');
        const toPath = toRel.startsWith('/') ? toRel : `${cwd}/${toRel}`.replace(/\/+/g, '/');

        try {
            const sandbox = await this._getSandbox(name);
            await sandbox.filesystem.renameFile({ from: fromPath, to: toPath });
        } catch (e) {
            throw new RuntimeError(e.message || 'fs move error', 500);
        }
    }

    async fsRmdir(rootDir, relativePath, opts = {}) {
        const name = opts.runtimeRef;
        if (!name) throw new RuntimeError('runtimeRef required', 400);
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';

        try {
            const sandbox = await this._getSandbox(name);
            const targetPath = rel.startsWith('/') ? rel : `${cwd}/${rel}`.replace(/\/+/g, '/');

            await sandbox.filesystem.deleteDirectory({ path: targetPath });
        } catch (e) {
            throw new RuntimeError(e.message || 'fs rmdir error', 500);
        }
    }

    resolveStateDir(workspaceRoot, sessionId) {
        return {
            stateDirRef: `blaxel:${sessionId}`,
            stateDirPath: `${workspaceRoot}/.agents/state/${sessionId}`,
        };
    }

    async exists(rootDir, relativePath, opts = {}) {
        try {
            await this.fsStat(rootDir, relativePath, opts);
            return true;
        } catch {
            return false;
        }
    }

    async mkdirp(rootDir, relativePath, opts = {}) {
        const name = opts.runtimeRef;
        if (!name) throw new RuntimeError('runtimeRef required', 400);
        const rel = safeRel(relativePath);
        const cwd = rootDir || '/workspace';

        try {
            const sandbox = await this._getSandbox(name);
            const targetPath = rel.startsWith('/') ? rel : `${cwd}/${rel}`.replace(/\/+/g, '/');

            await sandbox.filesystem.putDirectory({
                path: targetPath,
                body: '',
                createParents: true,
            });
        } catch (e) {
            throw new RuntimeError(e.message || 'fs mkdirp error', 500);
        }
    }
}

module.exports = BlaxelFsAdapter;
