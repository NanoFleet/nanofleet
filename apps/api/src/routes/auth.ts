import { LoginPayloadSchema } from '@nanofleet/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';

import { db } from '../db';
import { users } from '../db/schema';
import {
  checkBootstrapMode,
  createAdminUser,
  generateAccessToken,
  generateQrCode,
  generateRefreshToken,
  generateTempPassword,
  generateTotpSecret,
  verifyRefreshToken,
  verifyTotp,
} from '../lib/auth';
import { requireAuth } from '../middleware/auth';
import type { AuthContext } from '../middleware/auth';

export const auth = new Hono();

// Simple in-memory rate limiter: 10 attempts per 15 minutes per IP
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 15 * 60 * 1000;
  const MAX_ATTEMPTS = 10;
  const record = loginAttempts.get(ip);
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (record.count >= MAX_ATTEMPTS) return false;
  record.count++;
  return true;
}

auth.post('/login', async (c) => {
  const ip = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
  if (!checkRateLimit(ip)) {
    return c.json({ error: 'Too many login attempts. Please try again later.' }, 429);
  }

  const body = await c.req.json();
  const parsed = LoginPayloadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation Error', details: parsed.error.issues }, 400);
  }

  const { username, password, totp } = parsed.data;

  const userList = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const user = userList.at(0);

  if (!user) {
    return c.json({ error: 'Invalid username, password or TOTP' }, 401);
  }

  const passwordValid = await Bun.password.verify(password, user.passwordHash);
  if (!passwordValid) {
    return c.json({ error: 'Invalid username, password or TOTP' }, 401);
  }

  if (!user.totpSecret || !verifyTotp(user.totpSecret, totp)) {
    return c.json({ error: 'Invalid username, password or TOTP' }, 401);
  }

  const accessToken = await generateAccessToken(user.id, user.role);
  const refreshToken = await generateRefreshToken(user.id, user.role);

  c.header(
    'Set-Cookie',
    `refresh_token=${refreshToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`
  );

  return c.json({ accessToken });
});

auth.post('/refresh', async (c) => {
  const refreshToken = getCookie(c, 'refresh_token');

  if (!refreshToken) {
    return c.json({ error: 'No refresh token' }, 401);
  }

  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) {
    return c.json({ error: 'Invalid refresh token' }, 401);
  }

  const userId = payload.userId as string;
  const role = payload.role as string;

  const accessToken = await generateAccessToken(userId, role);
  const newRefreshToken = await generateRefreshToken(userId, role);

  c.header(
    'Set-Cookie',
    `refresh_token=${newRefreshToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`
  );

  return c.json({ accessToken });
});

auth.get('/me', requireAuth, async (c) => {
  const user = c.get('user') as AuthContext | undefined;
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const userList = await db.select().from(users).where(eq(users.id, user.userId)).limit(1);
  const userData = userList.at(0);

  if (!userData) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: userData.id,
    username: userData.username,
    role: userData.role,
    createdAt: userData.createdAt,
  });
});

auth.put('/me', requireAuth, async (c) => {
  const user = c.get('user') as AuthContext | undefined;
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await c.req.json();
  const { username, password, currentPassword } = body;

  const userList = await db.select().from(users).where(eq(users.id, user.userId)).limit(1);
  const userData = userList.at(0);

  if (!userData) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (password) {
    if (!currentPassword) {
      return c.json({ error: 'Current password required' }, 400);
    }
    const passwordValid = await Bun.password.verify(currentPassword, userData.passwordHash);
    if (!passwordValid) {
      return c.json({ error: 'Invalid current password' }, 401);
    }
  }

  const updates: Record<string, unknown> = {};

  if (username && username !== userData.username) {
    const existingUser = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existingUser.length > 0) {
      return c.json({ error: 'Username already taken' }, 400);
    }
    updates.username = username;
  }

  if (password) {
    updates.passwordHash = await Bun.password.hash(password);
  }

  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, user.userId));
  }

  return c.json({ success: true });
});

export async function setupBootstrapMode(): Promise<void> {
  const isBootstrap = await checkBootstrapMode();

  if (isBootstrap) {
    const tempPassword = generateTempPassword();
    const totpSecret = generateTotpSecret();

    console.log('\n========================================');
    console.log('       NANOBOOTSTRAP MODE');
    console.log('========================================');
    console.log('No admin user found. Creating bootstrap credentials.');
    console.log('');
    console.log('Temporary Password:', tempPassword);
    console.log('');
    console.log('Scan this QR Code with your authenticator app:');
    generateQrCode(totpSecret, 'admin@nanofleet');
    console.log('');
    console.log('========================================\n');

    const passwordHash = await Bun.password.hash(tempPassword);
    await createAdminUser('admin', passwordHash, totpSecret);
  }
}
