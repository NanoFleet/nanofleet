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
      model text,
      nanobot_version text,
      container_id text,
      token text NOT NULL,
      tags text,
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
      token text NOT NULL DEFAULT '',
      status text DEFAULT 'running' NOT NULL,
      manifest_url text NOT NULL,
      sidebar_slot text,
      tools_doc text,
      replaces_native_features text,
      generated_env_vars text,
      created_at integer NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_plugins (
      agent_id text NOT NULL,
      plugin_id text NOT NULL,
      PRIMARY KEY (agent_id, plugin_id)
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
