import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';

import { db } from '../db';
import { agents } from '../db/schema';

export interface AgentContext {
  agentId: string;
}

export async function requireAgentAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return c.json({ error: 'Unauthorized', message: 'Missing agent token' }, 401);
  }

  const [agent] = await db.select().from(agents).where(eq(agents.token, token)).limit(1);

  if (!agent) {
    return c.json({ error: 'Unauthorized', message: 'Invalid agent token' }, 401);
  }

  c.set('agent', {
    agentId: agent.id,
  });

  await next();
}
