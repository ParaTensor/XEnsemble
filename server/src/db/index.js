const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(path.join(dataDir, 'emdash.db'));
const db = drizzle(sqlite);

// Simple auto-migrate for MVP (in production use drizzle-kit migrate)
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
`);

const sessionCols = sqlite.prepare(`PRAGMA table_info(sessions)`).all();
if (!sessionCols.some((c) => c.name === 'project_id')) {
    sqlite.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id)`);
}

// 默认植入静态配置的 Agent 数据 (使用 INSERT OR IGNORE 防止重复，并能在以后无缝新增)
const insertAgent = sqlite.prepare('INSERT OR IGNORE INTO agents (id, name, cmd, args, env_required) VALUES (?, ?, ?, ?, ?)');
insertAgent.run('claude-code', 'Claude Code', 'claude', JSON.stringify(['--not-interactive']), JSON.stringify(['ANTHROPIC_API_KEY']));
insertAgent.run('xagent', 'XAgent', 'xagent', JSON.stringify(['run']), JSON.stringify(['OPENAI_API_KEY']));
insertAgent.run('kimi-code', 'Kimi Code', 'kimi', JSON.stringify([]), JSON.stringify(['KIMI_API_KEY']));
sqlite.prepare(`UPDATE agents SET args = ? WHERE id = 'kimi-code'`).run(JSON.stringify([]));
insertAgent.run('cursor', 'Cursor Agent', 'cursor', JSON.stringify(['--headless']), JSON.stringify([]));
insertAgent.run('amp', 'AMP', 'amp', JSON.stringify([]), JSON.stringify(['AMP_API_KEY']));
insertAgent.run('droid', 'Droid', 'droid', JSON.stringify(['start']), JSON.stringify([]));
insertAgent.run('commandcode', 'CommandCode', 'commandcode', JSON.stringify([]), JSON.stringify(['COHERE_API_KEY']));
insertAgent.run('hermes', 'Hermes', 'hermes', JSON.stringify(['--run']), JSON.stringify(['HERMES_API_KEY']));
insertAgent.run('openclaw', 'OpenClaw', 'openclaw', JSON.stringify([]), JSON.stringify(['OPENCLAW_KEY']));

module.exports = { db, sqlite };
