const fs = require('fs');
const path = require('path');
const { FsAdapter, RuntimeError } = require('./interfaces');
const { resolveSafePath } = require('../workspace');
const { buildSessionStateDirRef } = require('../session/stateDirRef');

class LocalFsAdapter extends FsAdapter {
    /**
     * 递归列出 rootDir 下所有文件与目录。
     * @param {string} rootDir  project workspace 绝对路径
     * @param {string} relativePath 相对路径（可选）
     * @returns {Promise<Array<{ name, path, type }>>}
     */
    async fsList(rootDir, relativePath = '.', opts = {}) {
        const target = resolveSafePath(rootDir, relativePath);
        if (!target) throw new RuntimeError('Access denied', 403);
        if (!fs.existsSync(target)) return [];
        const root = path.resolve(rootDir);
        const results = [];
        const walk = (dirPath) => {
            let entries;
            try { entries = fs.readdirSync(dirPath); } catch (e) { return; }
            for (const name of entries) {
                if (name === '.scrollback') continue; // hide internal scrollback dir
                const fullPath = path.join(dirPath, name);
                let stat;
                try { stat = fs.lstatSync(fullPath); } catch (e) { continue; }
                if (stat.isSymbolicLink()) continue; // do not follow symlinks in listing
                const rel = path.relative(root, fullPath);
                results.push({
                    name,
                    path: rel.startsWith('..') ? name : rel.replace(/\\/g, '/'),
                    type: stat.isDirectory() ? 'directory' : 'file',
                });
                if (stat.isDirectory()) walk(fullPath);
            }
        };
        walk(target);
        return results;
    }

    /**
     * 安全读取 rootDir 内的文件内容。
     * @param {string} rootDir      project workspace 绝对路径
     * @param {string} relativePath 相对路径
     * @returns {Promise<string>}
     */
    async fsRead(rootDir, relativePath, opts = {}) {
        const absolutePath = resolveSafePath(rootDir, relativePath);
        if (!absolutePath) throw new RuntimeError('Access denied', 403);
        if (!fs.existsSync(absolutePath)) throw new RuntimeError('File not found', 404);
        if (fs.statSync(absolutePath).isDirectory()) throw new RuntimeError('Path is a directory', 400);
        return fs.readFileSync(absolutePath, 'utf8');
    }

    resolveStateDir(workspaceRoot, sessionId) {
        const stateDirRef = buildSessionStateDirRef(sessionId);
        const stateDirPath = resolveSafePath(workspaceRoot, stateDirRef);
        if (!stateDirPath) {
            return null;
        }
        return { stateDirRef, stateDirPath };
    }

    async exists(rootDir, relativePath, opts = {}) {
        const target = resolveSafePath(rootDir, relativePath);
        if (!target) {
            return false;
        }
        return fs.existsSync(target);
    }

    async mkdirp(rootDir, relativePath, opts = {}) {
        const target = resolveSafePath(rootDir, relativePath);
        if (!target) {
            throw new RuntimeError('Access denied', 403);
        }
        fs.mkdirSync(target, { recursive: true });
    }
}

module.exports = LocalFsAdapter;
