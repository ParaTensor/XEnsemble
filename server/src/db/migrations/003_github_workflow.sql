-- GitHub workflow schema extension

-- Extend projects table with GitHub-related columns
ALTER TABLE projects ADD COLUMN current_branch TEXT;
ALTER TABLE projects ADD COLUMN github_repo_id INTEGER;
ALTER TABLE projects ADD COLUMN github_full_name TEXT;
ALTER TABLE projects ADD COLUMN clone_status TEXT DEFAULT 'pending';
ALTER TABLE projects ADD COLUMN clone_error TEXT;

-- GitHub OAuth connections (one per user)
CREATE TABLE IF NOT EXISTS github_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  github_user_id INTEGER NOT NULL,
  github_username TEXT NOT NULL,
  github_avatar TEXT,
  access_token_enc TEXT NOT NULL,
  token_scope TEXT,
  connected_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_connections_user_id ON github_connections(user_id);

-- GitHub OAuth state tokens (temporary, short-lived)
CREATE TABLE IF NOT EXISTS github_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires ON github_oauth_states(expires_at);

-- Project branches (local tracking of repo branches)
CREATE TABLE IF NOT EXISTS project_branches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_branch TEXT,
  is_active INTEGER DEFAULT 0,
  last_commit_sha TEXT,
  ahead_count INTEGER DEFAULT 0,
  behind_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  UNIQUE(project_id, branch_name)
);

-- Pull requests synced from GitHub
CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  github_pr_number INTEGER NOT NULL,
  github_pr_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  github_state TEXT,
  merge_sha TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_synced_at INTEGER,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(created_by) REFERENCES users(id),
  UNIQUE(project_id, github_pr_number)
);
