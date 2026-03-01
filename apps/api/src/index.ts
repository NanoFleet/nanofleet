import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { eq } from 'drizzle-orm';
import { config } from './config/env';
import { db } from './db';
import { initDb } from './db/init';
import { agents, plugins } from './db/schema';
import { ensureSharedDir, ensureSharedWorkspaceDir } from './lib/agent-config';
import { checkEncryptionKey } from './lib/crypto';
import { initDockerInfrastructure } from './lib/docker';
import { subscribeToAgent, unsubscribeFromAgent } from './lib/ws-manager';
import { requireAuth } from './middleware/auth';
import { wsAuthMiddleware } from './middleware/websocket';
import { agentRoutes } from './routes/agents';
import { auth, setupBootstrapMode } from './routes/auth';
import { channelRoutes } from './routes/channels';
import { mcpRoutes } from './routes/mcp';
import { packsRoutes } from './routes/packs';
import { pluginRoutes, rebuildPluginRegistry } from './routes/plugins';
import { settingsRoutes } from './routes/settings';

initDb();

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '';
      if (config.allowedOrigins.includes(origin)) return origin;
      return null;
    },
    credentials: true,
  })
);

app.get('/', (c) => c.text('NanoFleet API'));

app.route('/api/auth', auth);
app.route('/api/agents', agentRoutes);
app.route('/api/agents', channelRoutes);
app.route('/api/channels', channelRoutes);
app.route('/api/plugins', pluginRoutes);
app.route('/api/mcp', mcpRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/packs', packsRoutes);

app.get('/api/protected', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ message: 'Protected route', user });
});

// Internal routes for plugins/agents — authenticated by internal token
// Token can belong to an agent OR a plugin
async function requireInternalToken(token: string | undefined) {
  if (!token) return null;
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.token, token))
    .limit(1);
  if (agent) return agent;
  const [plugin] = await db
    .select({ id: plugins.id })
    .from(plugins)
    .where(eq(plugins.token, token))
    .limit(1);
  return plugin ?? null;
}

app.get('/internal/agents', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!(await requireInternalToken(token))) return c.json({ error: 'Unauthorized' }, 401);

  const allAgents = await db.select().from(agents);
  return c.json({ agents: allAgents });
});

app.get('/internal/agents/:id', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!(await requireInternalToken(token))) return c.json({ error: 'Unauthorized' }, 401);

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, c.req.param('id')))
    .limit(1);
  if (!agent) return c.json({ error: 'Not found' }, 404);
  return c.json({ agent });
});

app.post('/internal/agents/:id/messages', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!(await requireInternalToken(token))) return c.json({ error: 'Unauthorized' }, 401);

  const agentId = c.req.param('id');
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json();
  const { content } = body;
  if (!content) return c.json({ error: 'content is required' }, 400);

  const res = await fetch(`http://nanofleet-agent-${agentId}:4111/api/agents/main/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) return c.json({ error: 'Failed to deliver message to agent' }, 502);
  return c.json({ ok: true });
});

app.get(
  '/ws',
  async (c, next) => {
    const token = c.req.query('token');
    const wsContext = await wsAuthMiddleware(token);

    if (!wsContext) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    c.set('wsUser', wsContext);
    await next();
  },
  upgradeWebSocket((c) => {
    const wsUser = c.get('wsUser');
    return {
      onOpen(_event, _ws) {},
      onMessage(event, ws) {
        try {
          const message = JSON.parse(event.data as string);

          if (message.type === 'subscribe' && message.agentId) {
            subscribeToAgent(ws as never, message.agentId, wsUser?.userId);
            ws.send(JSON.stringify({ type: 'subscribed', agentId: message.agentId }));
          } else if (message.type === 'unsubscribe' && message.agentId) {
            unsubscribeFromAgent(ws as never);
            ws.send(JSON.stringify({ type: 'unsubscribed', agentId: message.agentId }));
          }
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
        }
      },
      onClose(_event, ws) {
        unsubscribeFromAgent(ws as never);
      },
    };
  })
);

const { port } = config;

async function start() {
  checkEncryptionKey();
  await initDockerInfrastructure();
  await ensureSharedWorkspaceDir();
  await ensureSharedDir();
  await setupBootstrapMode();
  await rebuildPluginRegistry();

  console.log(`Server running on http://localhost:${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
    idleTimeout: 120,
  });
}

start();
