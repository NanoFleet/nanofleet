import type { Context, Next } from 'hono';
import { verifyAccessToken } from '../lib/auth';

export interface AuthContext {
  userId: string;
  role: string;
}

export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return c.json({ error: 'Unauthorized', message: 'Missing access token' }, 401);
  }

  const payload = await verifyAccessToken(token);
  if (!payload) {
    return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401);
  }

  c.set('user', {
    userId: payload.userId as string,
    role: payload.role as string,
  });

  await next();
}
