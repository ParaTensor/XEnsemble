const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(path.join(dataDir, 'emdash.db'));
const db = drizzle(sqlite);

// ─── Auto-migrate（MVP；生产使用 drizzle-kit migrate） ───

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS secrets (
    user_id TEXT PRIMARY KEY,
    encrypted_data TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    server_path TEXT NOT NULL,
    default_runtime_id TEXT,
    repo_provider TEXT DEFAULT 'none',
    repo_url TEXT,
    repo_default_branch TEXT DEFAULT 'main',
    repo_installation_ref TEXT,
    repo_token_secret_ref TEXT,
    workspace_mode TEXT DEFAULT 'local',
    last_sync_sha TEXT,
    last_snapshot_id TEXT,
    dev_profile_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cmd TEXT NOT NULL,
    args TEXT NOT NULL,
    env_required TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runtimes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'local',
    runtime_ref TEXT,
    role TEXT NOT NULL DEFAULT 'default',
    status TEXT DEFAULT 'ready',
    endpoint TEXT,
    specs TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    runtime_id TEXT,
    kind TEXT NOT NULL DEFAULT 'preview',
    status TEXT NOT NULL DEFAULT 'pending',
    public_url TEXT,
    internal_ref TEXT,
    revision TEXT,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT,
    stopped_by TEXT,
    last_error_code TEXT,
    last_error_message TEXT,
    resource_tier TEXT,
    region TEXT,
    build_log TEXT,
    runtime_log TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(runtime_id) REFERENCES runtimes(id)
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    project_id TEXT,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS dev_environment_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    profile_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS repo_snapshots (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    git_sha TEXT,
    branch TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    storage_ref TEXT,
    build_log TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS workspace_checkpoints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    session_id TEXT,
    base_snapshot_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    storage_ref TEXT,
    diff_ref TEXT,
    git_sha TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(session_id) REFERENCES sessions(id),
    FOREIGN KEY(base_snapshot_id) REFERENCES repo_snapshots(id)
  );
`);

// ─── 增量 ALTER 迁移（向后兼容已有 DB） ───

const sessionCols = sqlite.prepare(`PRAGMA table_info(sessions)`).all();
if (!sessionCols.some((c) => c.name === 'project_id')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`);
}

const projectCols = sqlite.prepare(`PRAGMA table_info(projects)`).all();
if (!projectCols.some((c) => c.name === 'default_runtime_id')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN default_runtime_id TEXT`);
}
if (!projectCols.some((c) => c.name === 'repo_provider')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN repo_provider TEXT DEFAULT 'none'`);
}
if (!projectCols.some((c) => c.name === 'repo_url')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN repo_url TEXT`);
}
if (!projectCols.some((c) => c.name === 'repo_default_branch')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN repo_default_branch TEXT DEFAULT 'main'`);
}
if (!projectCols.some((c) => c.name === 'repo_installation_ref')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN repo_installation_ref TEXT`);
}
if (!projectCols.some((c) => c.name === 'repo_token_secret_ref')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN repo_token_secret_ref TEXT`);
}
if (!projectCols.some((c) => c.name === 'workspace_mode')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN workspace_mode TEXT DEFAULT 'local'`);
}
if (!projectCols.some((c) => c.name === 'last_sync_sha')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN last_sync_sha TEXT`);
}
if (!projectCols.some((c) => c.name === 'last_snapshot_id')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN last_snapshot_id TEXT`);
}
if (!projectCols.some((c) => c.name === 'dev_profile_id')) {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN dev_profile_id TEXT`);
}

const sessionColsAfter = sqlite.prepare(`PRAGMA table_info(sessions)`).all();
if (!sessionColsAfter.some((c) => c.name === 'runtime_id')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN runtime_id TEXT REFERENCES runtimes(id)`);
}
if (!sessionColsAfter.some((c) => c.name === 'stream_ref')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN stream_ref TEXT`);
}
if (!sessionColsAfter.some((c) => c.name === 'recoverable')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN recoverable INTEGER DEFAULT 0`);
}

const { backfillDefaultRuntimes } = require('./backfillRuntimes');
backfillDefaultRuntimes(sqlite);

// ─── 默认 Agent 数据 ───

const insertAgent = sqlite.prepare('INSERT OR IGNORE INTO agents (id, name, cmd, args, env_required) VALUES (?, ?, ?, ?, ?)');
insertAgent.run('kimi-code', 'Kimi Code', 'kimi', JSON.stringify([]), JSON.stringify(['KIMI_API_KEY']));
insertAgent.run('claude-code', 'Claude Code', 'claude', JSON.stringify(['--not-interactive']), JSON.stringify(['ANTHROPIC_API_KEY']));
insertAgent.run('xagent', 'XAgent', 'xagent', JSON.stringify(['run']), JSON.stringify(['OPENAI_API_KEY']));
sqlite.prepare(`UPDATE agents SET args = ? WHERE id = 'kimi-code'`).run(JSON.stringify([]));
insertAgent.run('cursor', 'Cursor Agent', 'cursor', JSON.stringify(['--headless']), JSON.stringify([]));
insertAgent.run('amp', 'AMP', 'amp', JSON.stringify([]), JSON.stringify(['AMP_API_KEY']));
insertAgent.run('droid', 'Droid', 'droid', JSON.stringify(['start']), JSON.stringify([]));
insertAgent.run('commandcode', 'CommandCode', 'commandcode', JSON.stringify([]), JSON.stringify(['COHERE_API_KEY']));
insertAgent.run('hermes', 'Hermes', 'hermes', JSON.stringify(['--run']), JSON.stringify(['HERMES_API_KEY']));
insertAgent.run('openclaw', 'OpenClaw', 'openclaw', JSON.stringify([]), JSON.stringify(['OPENCLAW_KEY']));

module.exports = { db, sqlite };
