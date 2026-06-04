const { sqliteTable, text, integer } = require('drizzle-orm/sqlite-core');

const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').default('user'),
  createdAt: integer('created_at').notNull()
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

module.exports = {
  users,
  secrets,
  projects,
  sessions,
  agents,
  runtimes,
  deployments,
  events,
};
