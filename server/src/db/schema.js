const { sqliteTable, text, integer } = require('drizzle-orm/sqlite-core');

const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').default('user'),
  status: text('status').default('active'),
  email: text('email'),
  displayName: text('display_name'),
  lastLoginAt: integer('last_login_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at'),
});

const userQuotas = sqliteTable('user_quotas', {
  userId: text('user_id').primaryKey().references(() => users.id),
  maxProjects: integer('max_projects').notNull().default(5),
  maxSessions: integer('max_sessions').notNull().default(2),
  maxPreviews: integer('max_previews').notNull().default(1),
  maxRuntimes: integer('max_runtimes').notNull().default(1),
  resourceTier: text('resource_tier').notNull().default('basic'),
  updatedBy: text('updated_by').references(() => users.id),
  updatedAt: integer('updated_at'),
});

const platformSettings = sqliteTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

const secrets = sqliteTable('secrets', {
  userId: text('user_id').primaryKey().references(() => users.id),
  encryptedData: text('encrypted_data').notNull()
});

const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  serverPath: text('server_path').notNull(),
  defaultRuntimeId: text('default_runtime_id'),
  repoProvider: text('repo_provider').default('none'),
  repoUrl: text('repo_url'),
  repoDefaultBranch: text('repo_default_branch').default('main'),
  repoInstallationRef: text('repo_installation_ref'),
  repoTokenSecretRef: text('repo_token_secret_ref'),
  workspaceMode: text('workspace_mode').default('local'),
  lastSyncSha: text('last_sync_sha'),
  lastSnapshotId: text('last_snapshot_id'),
  devProfileId: text('dev_profile_id'),
  createdAt: integer('created_at').notNull()
});

const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  runtimeId: text('runtime_id').references(() => runtimes.id),
  agentId: text('agent_id').notNull(),
  cwd: text('cwd').notNull(),
  streamRef: text('stream_ref'),
  recoverable: integer('recoverable', { mode: 'boolean' }).default(false),
  status: text('status').default('running'),
  createdAt: integer('created_at').notNull()
});

const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cmd: text('cmd').notNull(),
  args: text('args').notNull(),
  envRequired: text('env_required').notNull()
});

const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id').notNull().references(() => users.id),
  key: text('key').notNull(),
  value: text('value').notNull(),
});

const userAgentGrants = sqliteTable('user_agent_grants', {
  userId: text('user_id').notNull().references(() => users.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  grantedBy: text('granted_by').references(() => users.id),
  grantedAt: integer('granted_at').notNull(),
});

// ─── 新增表（对齐 Architecture.md 第 4 节） ───

const runtimes = sqliteTable('runtimes', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  provider: text('provider').notNull().default('local'),
  runtimeRef: text('runtime_ref'),
  role: text('role').notNull().default('default'),
  status: text('status').default('ready'),
  endpoint: text('endpoint'),
  specs: text('specs'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

const deployments = sqliteTable('deployments', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  runtimeId: text('runtime_id').references(() => runtimes.id),
  kind: text('kind').notNull().default('preview'),
  status: text('status').notNull().default('pending'),
  publicUrl: text('public_url'),
  internalRef: text('internal_ref'),
  previewTokenHash: text('preview_token_hash'),
  revision: text('revision'),
  expiresAt: integer('expires_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  createdBy: text('created_by'),
  stoppedBy: text('stopped_by'),
  lastErrorCode: text('last_error_code'),
  lastErrorMessage: text('last_error_message'),
  resourceTier: text('resource_tier'),
  region: text('region'),
  buildLog: text('build_log'),
  runtimeLog: text('runtime_log')
});

const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  type: text('type').notNull(),
  data: text('data'),
  createdAt: integer('created_at').notNull()
});

const devEnvironmentProfiles = sqliteTable('dev_environment_profiles', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  source: text('source').notNull().default('manual'),
  profileJson: text('profile_json').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
});

const repoSnapshots = sqliteTable('repo_snapshots', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  gitSha: text('git_sha'),
  branch: text('branch'),
  status: text('status').notNull().default('pending'),
  storageRef: text('storage_ref'),
  buildLog: text('build_log'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  expiresAt: integer('expires_at')
});

const workspaceCheckpoints = sqliteTable('workspace_checkpoints', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  sessionId: text('session_id').references(() => sessions.id),
  baseSnapshotId: text('base_snapshot_id').references(() => repoSnapshots.id),
  status: text('status').notNull().default('pending'),
  storageRef: text('storage_ref'),
  diffRef: text('diff_ref'),
  gitSha: text('git_sha'),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at')
});

const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  deviceName: text('device_name'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
});

module.exports = {
  users,
  userQuotas,
  userPreferences,
  userAgentGrants,
  platformSettings,
  secrets,
  projects,
  sessions,
  agents,
  runtimes,
  deployments,
  events,
  devEnvironmentProfiles,
  repoSnapshots,
  workspaceCheckpoints,
  refreshTokens,
};
