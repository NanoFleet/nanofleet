import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function initDb() {
  const DB_PATH = process.env.DB_PATH ?? '/app/apps/api/data/nanofleet.db';
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      totp_secret text,
      role text DEFAULT 'user' NOT NULL,
      created_at integer NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id text PRIMARY KEY,
      name text NOT NULL,
      status text DEFAULT 'starting' NOT NULL,
      pack_path text NOT NULL,
      container_id text,
      token text NOT NULL,
      created_at integer NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id text PRIMARY KEY,
      name text NOT NULL UNIQUE,
      version text NOT NULL,
      image text NOT NULL,
      mcp_port integer NOT NULL,
      ui_port integer,
      container_name text NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      manifest_url text NOT NULL,
      sidebar_slot text,
      created_at integer NOT NULL
    )
  `);

  // Migration: add ui_port column if it doesn't exist yet
  try {
    sqlite.exec('ALTER TABLE plugins ADD COLUMN ui_port integer');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add token column if it doesn't exist yet
  try {
    sqlite.exec(`ALTER TABLE plugins ADD COLUMN token text NOT NULL DEFAULT ''`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add tools_doc column if it doesn't exist yet
  try {
    sqlite.exec('ALTER TABLE plugins ADD COLUMN tools_doc text');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add replaces_native_features column if it doesn't exist yet
  try {
    sqlite.exec('ALTER TABLE plugins ADD COLUMN replaces_native_features text');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add generated_env_vars column if it doesn't exist yet
  try {
    sqlite.exec('ALTER TABLE plugins ADD COLUMN generated_env_vars text');
  } catch {
    // Column already exists — ignore
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_plugins (
      agent_id text NOT NULL,
      plugin_id text NOT NULL,
      PRIMARY KEY (agent_id, plugin_id)
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id text PRIMARY KEY,
      agent_id text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      created_at integer NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      key_name text NOT NULL,
      encrypted_value text NOT NULL,
      created_at integer NOT NULL
    )
  `);

  return sqlite;
}
