const { FsAdapter, RuntimeError } = require('./interfaces');
const { SandboxInstance } = require('@blaxel/core');
const { isHiddenWorkspacePath } = require('../workspace/hiddenPaths');

function safeRel(p) {
    const s = String(p || '.').replace(/\\/g, '/').replace(/^\//, '');
    if (s.includes('..')) return '.';
    return s || '.';
}

// @blaxel/core exposes the filesystem as sandbox.fs:
//   ls(path) -> Directory { name, path, files: File[], subdirectories: Subdirectory[] }
//   find(path, { patterns, excludeHidden, ... }) -> { matches: [{ path, type }], total }
//   read(path) / write(path, content) / mkdir(path) / rm(path, recursive)
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
            // Normalize trailing slash so path prefix slicing below works.
            const base = targetPath.replace(/\/+$/, '') || '/';

            let entries = [];
            if (opts.depth !== 'single') {
                // Recursive listing via find (server-side walk).
                const result = await sandbox.fs.find(base, {
                    patterns: ['*'],
                    excludeHidden: false,
                });
                const matches = result?.matches || [];
                entries = matches
                    .map((m) => {
                        const itemPath = m.path || '';
                        let relPath = itemPath.startsWith(`${base}/`)
                            ? itemPath.slice(base.length + 1)
                            : itemPath;
                        return {
                            relPath,
                            type: m.type === 'directory' ? 'directory' : 'file',
                            size: null,
                        };
                    })
                    .filter((e) => e.relPath);
            } else {
                // Single-level listing via ls.
                const dir = await sandbox.fs.ls(base);
                const files = dir?.files || [];
                const subdirs = dir?.subdirectories || [];
                entries = [
                    ...files.map((f) => ({
                        relPath: f.path && f.path.startsWith(`${base}/`)
                            ? f.path.slice(base.length + 1)
                            : (f.name || ''),
                        type: 'file',
                        size: f.size != null ? f.size : null,
                    })),
                    ...subdirs.map((d) => ({
                        relPath: d.path && d.path.startsWith(`${base}/`)
                            ? d.path.slice(base.length + 1)
                            : (d.name || ''),
                        type: 'directory',
                        size: null,
                    })),
                ].filter((e) => e.relPath);
            }

            const out = [];
            for (const entry of entries) {
                if (!opts.includeHidden && isHiddenWorkspacePath(entry.relPath)) continue;
                out.push({
                    name: entry.relPath.split('/').pop() || entry.relPath,
                    path: entry.relPath,
                    type: entry.type,
                    ...(entry.type === 'file' && entry.size != null ? { size: entry.size } : {}),
                });
            }
            return out;
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
            if (opts.encoding === 'buffer') {
                const blob = await sandbox.fs.readBinary(targetPath);
                return Buffer.from(await blob.arrayBuffer());
            }
            return await sandbox.fs.read(targetPath);
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

            // No direct stat in the SDK: a successful ls means directory; otherwise
            // look the file up in its parent's listing for size/mtime.
            try {
                await sandbox.fs.ls(targetPath);
                return { type: 'directory', size: 0, mtime: null };
            } catch (_) { /* not a directory */ }

            const parent = targetPath.replace(/\/[^/]+$/, '') || '/';
            const baseName = targetPath.split('/').pop();
            const dir = await sandbox.fs.ls(parent);
            const file = (dir?.files || []).find((f) => f.name === baseName || f.path === targetPath);
            if (!file) throw new Error('not found');
            return {
                type: 'file',
                size: file.size != null ? file.size : 0,
                mtime: file.lastModified ? Date.parse(file.lastModified) || null : null,
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
            await sandbox.fs.write(targetPath, content);
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
            await sandbox.fs.rm(targetPath, false);
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
            // The SDK has no rename API; shell out to mv inside the sandbox.
            // ProcessRequest only accepts a single command string, so quote paths.
            const q = (p) => `'${String(p).replace(/'/g, `'\''`)}'`;
            const result = await sandbox.process.exec({
                command: `mv -f -- ${q(fromPath)} ${q(toPath)}`,
                waitForCompletion: true,
            });
            if (result && typeof result.exitCode === 'number' && result.exitCode !== 0) {
                throw new Error(`mv exited with ${result.exitCode}: ${result.stderr || ''}`);
            }
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
            await sandbox.fs.rm(targetPath, true);
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
            await sandbox.fs.mkdir(targetPath);
        } catch (e) {
            throw new RuntimeError(e.message || 'fs mkdirp error', 500);
        }
    }
}

module.exports = BlaxelFsAdapter;
