import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { db } from '../db';
import { apiKeys } from '../db/schema';
import { encrypt } from '../lib/crypto';
import { requireAuth } from '../middleware/auth';
import type { AuthContext } from '../middleware/auth';

export const settingsRoutes = new Hono();

settingsRoutes.get('/keys', requireAuth, async (c) => {
  const user = c.get('user') as AuthContext;

  const keys = await db
    .select({
      id: apiKeys.id,
      keyName: apiKeys.keyName,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.userId));

  return c.json({ keys });
});

settingsRoutes.post('/keys', requireAuth, async (c) => {
  const user = c.get('user') as AuthContext;
  const body = await c.req.json();

  const { keyName, value } = body;

  if (!keyName || !value) {
    return c.json({ error: 'keyName and value are required' }, 400);
  }

  const keyNameLower = keyName.toLowerCase();

  const existing = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.userId), eq(apiKeys.keyName, keyNameLower)))
    .limit(1);

  const encryptedValue = await encrypt(value);

  if (existing.length > 0) {
    const existingKey = existing[0];
    if (existingKey) {
      await db.update(apiKeys).set({ encryptedValue }).where(eq(apiKeys.id, existingKey.id));
    }

    return c.json({ success: true, message: 'Key updated' });
  }

  const id = crypto.randomUUID();
  await db.insert(apiKeys).values({
    id,
    userId: user.userId,
    keyName: keyNameLower,
    encryptedValue,
  });

  return c.json({ success: true, message: 'Key created' }, 201);
});

settingsRoutes.delete('/keys/:keyName', requireAuth, async (c) => {
  const user = c.get('user') as AuthContext;
  const keyName = c.req.param('keyName').toLowerCase();

  await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.userId, user.userId), eq(apiKeys.keyName, keyName)));

  return c.json({ success: true });
});
