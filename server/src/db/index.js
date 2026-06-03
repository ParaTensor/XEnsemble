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

// 默认植入静态配置的 Agent 数据 (如果表为空)
const agentsCount = sqlite.prepare('SELECT COUNT(*) as count FROM agents').get();
if (agentsCount.count === 0) {
    const insertAgent = sqlite.prepare('INSERT INTO agents (id, name, cmd, args, env_required) VALUES (?, ?, ?, ?, ?)');
    insertAgent.run('claude-code', 'Claude Code', 'claude', JSON.stringify(['--not-interactive']), JSON.stringify(['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL']));
    insertAgent.run('xagent-cli', 'XAgent CLI', 'xagent', JSON.stringify(['run']), JSON.stringify(['OPENAI_API_KEY', 'LLM_ROUTER_URL']));
}

module.exports = { db, sqlite };
