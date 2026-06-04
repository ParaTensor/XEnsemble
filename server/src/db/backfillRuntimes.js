const workspace = require('../workspace');

const PROVIDER = process.env.RUNTIME_PROVIDER || 'local';

/** 为无 default_runtime_id 的历史 project 插入 default runtime（幂等）。 */
function backfillDefaultRuntimes(sqlite) {
    const projects = sqlite.prepare(`
        SELECT id, user_id, server_path, default_runtime_id FROM projects
        WHERE default_runtime_id IS NULL
    `).all();

    const insert = sqlite.prepare(`
        INSERT OR IGNORE INTO runtimes (
            id, project_id, provider, runtime_ref, role, status, endpoint, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'default', 'ready', ?, ?, ?)
    `);
    const updateProject = sqlite.prepare(`
        UPDATE projects SET default_runtime_id = ? WHERE id = ?
    `);

    const now = Date.now();
    for (const p of projects) {
        const runtimeId = `rt_def_${p.id}`;
        let endpoint = p.server_path;
        if (!endpoint) {
            endpoint = workspace.createProjectDirectory(p.user_id, p.id);
            sqlite.prepare('UPDATE projects SET server_path = ? WHERE id = ?').run(endpoint, p.id);
        }
        insert.run(runtimeId, p.id, PROVIDER, 'local', endpoint, now, now);
        updateProject.run(runtimeId, p.id);
    }
}

module.exports = { backfillDefaultRuntimes };
