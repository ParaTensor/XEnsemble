// 仅 Local 有效：本地文件系统读操作。
const path = require('path');
const fs = require('fs');
const { FsAdapter, RuntimeError } = require('./interfaces');
const { resolveSafePath } = require('../workspace');

class LocalFsAdapter extends FsAdapter {
    /**
     * 递归列出 rootDir 下所有文件与目录。
     * @param {string} rootDir  project workspace 绝对路径
     * @returns {Promise<Array<{ name, path, type }>>}
     */
    async fsList(rootDir) {
        if (!fs.existsSync(rootDir)) return [];
        const root = path.resolve(rootDir);
        const results = [];
        const walk = (dirPath) => {
            let entries;
            try { entries = fs.readdirSync(dirPath); } catch (e) { return; }
            for (const name of entries) {
                const fullPath = path.join(dirPath, name);
                let stat;
                try { stat = fs.statSync(fullPath); } catch (e) { continue; }
                const rel = path.relative(root, fullPath);
                results.push({
                    name,
                    path: rel.startsWith('..') ? name : rel.replace(/\\/g, '/'),
                    type: stat.isDirectory() ? 'directory' : 'file',
                });
                if (stat.isDirectory()) walk(fullPath);
            }
        };
        walk(rootDir);
        return results;
    }

    /**
     * 安全读取 rootDir 内的文件内容。
     * @param {string} rootDir      project workspace 绝对路径
     * @param {string} relativePath 相对路径
     * @returns {Promise<string>}
     */
    async fsRead(rootDir, relativePath) {
        const absolutePath = resolveSafePath(rootDir, relativePath);
        if (!absolutePath) throw new RuntimeError('Access denied', 403);
        if (!fs.existsSync(absolutePath)) throw new RuntimeError('File not found', 404);
        if (fs.statSync(absolutePath).isDirectory()) throw new RuntimeError('Path is a directory', 400);
        return fs.readFileSync(absolutePath, 'utf8');
    }
}

module.exports = LocalFsAdapter;
