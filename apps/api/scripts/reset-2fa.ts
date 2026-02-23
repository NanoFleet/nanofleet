/**
 * Emergency 2FA reset script.
 *
 * Use this if you've lost access to your TOTP device and are locked out of the dashboard.
 * Requires direct access to the host machine (physical or SSH).
 *
 * Usage:
 *   bun apps/api/scripts/reset-2fa.ts [path/to/nanofleet.db]
 *
 * The DB path defaults to apps/api/nanofleet.db if not provided.
 * After running, restart the server — it will enter Bootstrap Mode and print a new QR code.
 */
import { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { users } from '../src/db/schema';

const dbPath = process.argv[2] || 'apps/api/nanofleet.db';

console.log('NanoFleet Emergency Recovery - Reset 2FA');
console.log('=========================================\n');

const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema: { users } });

async function reset2FA() {
  const adminUsers = await db.select().from(users).where(eq(users.role, 'admin'));

  if (adminUsers.length === 0) {
    console.log('No admin user found. Nothing to reset.');
    process.exit(0);
  }

  const admin = adminUsers.at(0);
  if (!admin) {
    console.log('Failed to get admin user.');
    process.exit(1);
  }

  console.log(`Found admin user: ${admin.username} (${admin.id})`);
  console.log(`Current TOTP secret: ${admin.totpSecret || 'none'}\n`);

  await db.update(users).set({ totpSecret: null }).where(eq(users.id, admin.id));

  console.log('TOTP secret has been wiped.');
  console.log('\nRestart the server to enter Bootstrap Mode.');
}

reset2FA().catch(console.error);
