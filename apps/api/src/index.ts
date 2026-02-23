import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { asc, eq } from 'drizzle-orm';
import { config } from './config/env';
import { db } from './db';
import { initDb } from './db/init';
import { agents, messages as messagesTable, plugins } from './db/schema';
import {
  handleAgentResponse,
  handleAgentThinking,
  registerAgentConnection,
  removeAgentConnection,
  sendToAgent,
} from './lib/agent-bus';
import { checkEncryptionKey } from './lib/crypto';
import { initDockerInfrastructure } from './lib/docker';
import {
  ensureInstancesDir,
  ensureSharedDir,
  ensureSharedWorkspaceDir,
} from './lib/nanobot-config';
import { ensureDefaultPack } from './lib/packs';
import { subscribeToAgent, unsubscribeFromAgent } from './lib/ws-manager';
import { requireAuth } from './middleware/auth';
import { wsAuthMiddleware } from './middleware/websocket';
import { agentRoutes } from './routes/agents';
import { auth, setupBootstrapMode } from './routes/auth';
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
app.route('/api/plugins', pluginRoutes);
app.route('/api/mcp', mcpRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/packs', packsRoutes);

app.get('/api/protected', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ message: 'Protected route', user });
});

// Internal routes for plugins/agents — authenticated by NANO_INTERNAL_TOKEN
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

app.get('/internal/agents/:id/messages', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!(await requireInternalToken(token))) return c.json({ error: 'Unauthorized' }, 401);

  const agentId = c.req.param('id');
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.agentId, agentId))
    .orderBy(asc(messagesTable.createdAt));

  return c.json({ messages: rows });
});

app.post('/internal/agents/:id/messages', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!(await requireInternalToken(token))) return c.json({ error: 'Unauthorized' }, 401);

  const agentId = c.req.param('id');
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json();
  if (typeof body.content !== 'string' || !body.content.trim()) {
    return c.json({ error: 'content is required' }, 400);
  }

  const content: string = body.content.trim();

  await db.insert(messagesTable).values({
    id: crypto.randomUUID(),
    agentId,
    role: 'user',
    content,
  });

  const delivered = sendToAgent(agentId, content);
  if (!delivered) {
    return c.json({ error: 'Agent is not connected' }, 503);
  }

  return c.json({ success: true }, 201);
});

app.get(
  '/internal/ws',
  upgradeWebSocket(async (c) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    let agentId: string | null = null;

    return {
      async onOpen(_event, ws) {
        if (!token) {
          ws.close(4001, 'Unauthorized');
          return;
        }

        const [agent] = await db.select().from(agents).where(eq(agents.token, token)).limit(1);

        if (!agent) {
          ws.close(4001, 'Unauthorized');
          return;
        }

        agentId = agent.id;
        registerAgentConnection(agentId, ws as never);
        console.log(`[InternalWS] Agent ${agentId} connected`);
      },
      async onMessage(event, _ws) {
        if (!agentId) return;

        try {
          const message = JSON.parse(event.data as string);

          if (message.type === 'response' && typeof message.content === 'string') {
            await handleAgentResponse(agentId, message.content);
          } else if (message.type === 'thinking') {
            handleAgentThinking(agentId);
          }
        } catch (error) {
          console.error('[InternalWS] Failed to parse message:', error);
        }
      },
      onClose(_event, _ws) {
        if (agentId) {
          removeAgentConnection(agentId);
          console.log(`[InternalWS] Agent ${agentId} disconnected`);
        }
      },
    };
  })
);

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
  await ensureDefaultPack();
  await ensureInstancesDir();
  await ensureSharedWorkspaceDir();
  await ensureSharedDir();
  await setupBootstrapMode();
  await rebuildPluginRegistry();

  console.log(`Server running on http://localhost:${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });
}

start();
