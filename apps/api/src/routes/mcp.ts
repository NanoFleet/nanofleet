import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { db } from '../db';
import { agentPlugins, agents, plugins } from '../db/schema';
import { pluginRegistry } from './plugins';

export const mcpRoutes = new Hono();

// ---------------------------------------------------------------------------
// Authenticate an agent by its NANO_INTERNAL_TOKEN
// Returns the agentId or null
// ---------------------------------------------------------------------------

async function resolveAgentFromToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.token, token))
    .limit(1);

  return agent?.id ?? null;
}

// ---------------------------------------------------------------------------
// POST /api/mcp/proxy/:pluginName
// Used by nanobot agents as their configured MCP server URL.
// Auth: Authorization: Bearer <NANO_INTERNAL_TOKEN>
// ---------------------------------------------------------------------------

mcpRoutes.post('/proxy/:pluginName', async (c) => {
  const pluginName = c.req.param('pluginName');
  // Accept token from Authorization header OR query param (streamable_http_client doesn't send headers)
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ?? c.req.query('token');

  // 1. Authenticate agent
  const agentId = await resolveAgentFromToken(token);
  if (!agentId) {
    return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' } }, 401);
  }

  // 2. Look up plugin in registry
  const entry = pluginRegistry.get(pluginName);
  if (!entry) {
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32002, message: `Plugin '${pluginName}' not found or not running` },
      },
      404
    );
  }

  // 3. Check agent has this plugin enabled (agent_plugins)
  const [permission] = await db
    .select()
    .from(agentPlugins)
    .where(and(eq(agentPlugins.agentId, agentId), eq(agentPlugins.pluginId, entry.pluginId)))
    .limit(1);

  if (!permission) {
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32003, message: `Agent does not have access to plugin '${pluginName}'` },
      },
      403
    );
  }

  // 4. Forward JSON-RPC request to plugin container
  const body = await c.req.json();

  // Inject agentId into params._meta so plugin tools can identify the caller
  if (body.params && typeof body.params === 'object') {
    body.params._meta = { ...(body.params._meta ?? {}), agentId };
  }

  try {
    const res = await fetch(`http://${entry.containerName}:${entry.mcpPort}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-NanoFleet-Agent-Id': agentId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const result = await res.json();
    return c.json(result, res.status as 200);
  } catch (err) {
    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32004,
          message: `Plugin unreachable: ${err instanceof Error ? err.message : 'Unknown error'}`,
        },
      },
      502
    );
  }
});

// ---------------------------------------------------------------------------
// GET /api/mcp/tools
// Returns aggregated list of all MCP tools across all running plugins.
// Auth: JWT (user session) — used by the UI and for documentation
// ---------------------------------------------------------------------------

mcpRoutes.get('/tools', async (c) => {
  const allPlugins = await db.select().from(plugins).where(eq(plugins.status, 'running'));

  const tools = allPlugins.flatMap((plugin) => {
    const entry = pluginRegistry.get(plugin.name);
    if (!entry) return [];

    return entry.tools.map((toolName) => ({
      pluginId: plugin.id,
      pluginName: plugin.name,
      name: toolName,
    }));
  });

  return c.json({ tools });
});
