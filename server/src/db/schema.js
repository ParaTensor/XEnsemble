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
  encryptedData: text('encrypted_data').notNull() // JSON string of encrypted keys
});

const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  serverPath: text('server_path').notNull(),
  createdAt: integer('created_at').notNull()
});

const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  projectId: text('project_id').references(() => projects.id),
  agentId: text('agent_id').notNull(),
  cwd: text('cwd').notNull(),
  status: text('status').default('running'),
  createdAt: integer('created_at').notNull()
});

const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cmd: text('cmd').notNull(),
  args: text('args').notNull(), // JSON string array
  envRequired: text('env_required').notNull() // JSON string array
});

module.exports = {
  users,
  secrets,
  projects,
  sessions,
  agents
};
