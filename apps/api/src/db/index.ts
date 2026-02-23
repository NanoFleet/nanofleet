import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

const DB_PATH = process.env.DB_PATH ?? '/app/apps/api/data/nanofleet.db';
const sqlite = new Database(DB_PATH);

export const db = drizzle(sqlite, { schema });
