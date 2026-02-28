import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecret: text('totp_secret'),
  role: text('role', { enum: ['admin', 'user'] })
    .notNull()
    .default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status', {
    enum: ['starting', 'running', 'paused', 'stopped'],
  })
    .notNull()
    .default('starting'),
  packPath: text('pack_path').notNull(),
  model: text('model'),
  agentVersion: text('agent_version'),
  containerId: text('container_id'),
  token: text('token').notNull(),
  tags: text('tags'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  version: text('version').notNull(),
  image: text('image').notNull(),
  mcpPort: integer('mcp_port').notNull(),
  uiPort: integer('ui_port'),
  containerName: text('container_name').notNull(),
  token: text('token').notNull().default(''),
  status: text('status', { enum: ['running', 'stopped', 'error'] })
    .notNull()
    .default('running'),
  manifestUrl: text('manifest_url').notNull(),
  sidebarSlot: text('sidebar_slot'),
  toolsDoc: text('tools_doc'),
  replacesNativeFeatures: text('replaces_native_features'),
  generatedEnvVars: text('generated_env_vars'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agentPlugins = sqliteTable('agent_plugins', {
  agentId: text('agent_id').notNull(),
  pluginId: text('plugin_id').notNull(),
});

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  type: text('type').notNull(), // e.g. 'telegram'
  image: text('image').notNull(),
  containerName: text('container_name').notNull(),
  status: text('status', { enum: ['running', 'stopped', 'error'] })
    .notNull()
    .default('running'),
  envVars: text('env_vars'), // JSON: non-sensitive env vars for display
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  keyName: text('key_name').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
