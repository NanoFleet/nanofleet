import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { docker } from '@nanofleet/docker';
import { InstallPluginPayloadSchema, PluginManifestSchema } from '@nanofleet/shared';
import { db } from '../db';
import { agentPlugins, agents, plugins } from '../db/schema';
import { rebuildAndRestartAgent } from '../lib/agent-lifecycle';
import { SHARED_HOST_DIR } from '../lib/agent-config';
import { requireAuth } from '../middleware/auth';

export const pluginRoutes = new Hono();

const NETWORK_NAME = 'nanofleet-net';
const NANO_API_URL = process.env.NANO_API_INTERNAL_URL ?? 'http://nanofleet-api:3000';

// ---------------------------------------------------------------------------
// In-memory tool registry
// Map<pluginName, { pluginId, containerName, mcpPort, uiPort, tools: string[] }>
// ---------------------------------------------------------------------------

interface PluginRegistryEntry {
  pluginId: string;
  containerName: string;
  mcpPort: number;
  uiPort: number | null;
  tools: string[];
  toolsDoc: string | null;
}

export const pluginRegistry = new Map<string, PluginRegistryEntry>();

// ---------------------------------------------------------------------------
// Helper: fetch tools/list from a plugin MCP server
// ---------------------------------------------------------------------------

async function fetchPluginTools(containerName: string, mcpPort: number): Promise<string[]> {
  // Use the REST health endpoint on uiPort if available, else probe MCP with initialize.
  // We send initialize (which returns server capabilities) — if it succeeds the plugin is up.
  // Then reuse the same session for tools/list in a single logical exchange.
  try {
    const baseUrl = `http://${containerName}:${mcpPort}/mcp`;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    // Step 1: Initialize — creates session, plugin confirms it's alive
    const initRes = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'nanofleet-api', version: '1.0.0' },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!initRes.ok) return [];
    const sessionId = initRes.headers.get('mcp-session-id');
    if (!sessionId) return [];

    // Drain the init response body before sending next request
    await initRes.text();

    // Step 2: tools/list on same session
    const listRes = await fetch(baseUrl, {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(5000),
    });

    if (!listRes.ok) return [];

    const data = (await listRes.json()) as { result?: { tools?: Array<{ name: string }> } };

    // Clean up session
    fetch(baseUrl, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId },
    }).catch(() => {});

    return data.result?.tools?.map((t) => t.name) ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helper: pull a Docker image (stream progress to console)
// ---------------------------------------------------------------------------

async function pullImage(image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream | null) => {
      if (err) {
        reject(err);
        return;
      }
      if (!stream) {
        resolve();
        return;
      }
      docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Rebuild registry on API startup
// ---------------------------------------------------------------------------

export async function rebuildPluginRegistry(): Promise<void> {
  // Try all plugins (running or error) — container may have recovered
  const allPlugins = await db.select().from(plugins);

  pluginRegistry.clear();

  for (const plugin of allPlugins) {
    const tools = await fetchPluginTools(plugin.containerName, plugin.mcpPort);
    const status = tools.length > 0 ? 'running' : 'error';

    if (status === 'error') {
      console.warn(`[Plugins] Registry: '${plugin.name}' is unreachable or has no tools`);
    } else {
      console.log(
        `[Plugins] Registry: '${plugin.name}' registered with tools: ${tools.join(', ')}`
      );
    }

    await db.update(plugins).set({ status }).where(eq(plugins.id, plugin.id));

    // Always register in memory — toolsDoc comes from DB and must be available
    // for TOOLS.md generation even if the MCP server is temporarily unreachable.
    pluginRegistry.set(plugin.name, {
      pluginId: plugin.id,
      containerName: plugin.containerName,
      mcpPort: plugin.mcpPort,
      uiPort: plugin.uiPort ?? null,
      tools,
      toolsDoc: plugin.toolsDoc ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/plugins/install
// ---------------------------------------------------------------------------

pluginRoutes.post('/install', requireAuth, async (c) => {
  const body = await c.req.json();

  const parsed = InstallPluginPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation Error', details: parsed.error.issues }, 400);
  }

  const { manifestUrl } = parsed.data;

  // 1. Fetch and validate manifest
  let manifestRaw: unknown;
  try {
    const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return c.json({ error: `Failed to fetch manifest: HTTP ${res.status}` }, 400);
    }
    manifestRaw = await res.json();
  } catch (err) {
    return c.json(
      {
        error: `Failed to fetch manifest: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      400
    );
  }

  const manifestParsed = PluginManifestSchema.safeParse(manifestRaw);
  if (!manifestParsed.success) {
    return c.json({ error: 'Invalid manifest', details: manifestParsed.error.issues }, 400);
  }

  const manifest = manifestParsed.data;

  // 2. Check for duplicate name
  const [existing] = await db
    .select()
    .from(plugins)
    .where(eq(plugins.name, manifest.name))
    .limit(1);

  if (existing) {
    return c.json({ error: `Plugin '${manifest.name}' is already installed` }, 409);
  }

  // 3. Pull Docker image
  console.log(`[Plugins] Pulling image '${manifest.image}'...`);
  try {
    await pullImage(manifest.image);
  } catch (err) {
    return c.json(
      { error: `Failed to pull image: ${err instanceof Error ? err.message : 'Unknown error'}` },
      500
    );
  }

  // 4. Start container
  const pluginId = crypto.randomUUID();
  const containerName = `nanofleet-plugin-${manifest.name}`;
  const internalToken = crypto.randomUUID();

  // Auto-generate values for vars listed in generateEnvVars
  const generatedEnvVarsMap: Record<string, string> = {};
  for (const varName of manifest.generateEnvVars ?? []) {
    generatedEnvVarsMap[varName] = crypto.randomUUID().replace(/-/g, '');
  }

  // Named volume for persistent plugin data (survives container removal/reinstall)
  const dataVolumeName = `nanofleet-plugin-${manifest.name}-data`;
  const binds = [`${dataVolumeName}:/data`];
  if (manifest.mountShared) {
    binds.push(`${SHARED_HOST_DIR}:/shared`);
  }

  try {
    const container = await docker.createContainer({
      Image: manifest.image,
      name: containerName,
      Env: [
        `NANO_API_URL=${NANO_API_URL}`,
        `NANO_INTERNAL_TOKEN=${internalToken}`,
        `NANO_PLUGIN_ID=${pluginId}`,
        ...Object.entries(generatedEnvVarsMap).map(([k, v]) => `${k}=${v}`),
      ],
      ExposedPorts: {
        [`${manifest.mcpPort}/tcp`]: {},
      },
      HostConfig: {
        NetworkMode: NETWORK_NAME,
        Binds: binds,
      },
    });

    await container.start();
  } catch (err) {
    return c.json(
      {
        error: `Failed to start plugin container: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      500
    );
  }

  // 5. Poll until MCP server is ready (up to 15s)
  let tools: string[] = [];
  for (let i = 0; i < 15; i++) {
    await Bun.sleep(1000);
    tools = await fetchPluginTools(containerName, manifest.mcpPort);
    if (tools.length > 0) break;
  }
  const status = tools.length > 0 ? 'running' : 'error';

  if (status === 'error') {
    console.warn(`[Plugins] Plugin '${manifest.name}' started but MCP server is unreachable`);
  }

  // 6. Save to DB
  const sidebarSlot = manifest.sidebar ? JSON.stringify(manifest.sidebar) : null;
  const toolsDoc = manifest.toolsDoc ?? null;
  const replacesNativeFeatures =
    manifest.replacesNativeFeatures && manifest.replacesNativeFeatures.length > 0
      ? JSON.stringify(manifest.replacesNativeFeatures)
      : null;

  const generatedEnvVars =
    Object.keys(generatedEnvVarsMap).length > 0 ? JSON.stringify(generatedEnvVarsMap) : null;

  await db.insert(plugins).values({
    id: pluginId,
    name: manifest.name,
    version: manifest.version,
    image: manifest.image,
    mcpPort: manifest.mcpPort,
    uiPort: manifest.uiPort ?? null,
    containerName,
    token: internalToken,
    status,
    manifestUrl,
    sidebarSlot,
    toolsDoc,
    replacesNativeFeatures,
    generatedEnvVars,
  });

  // 7. Register in memory
  pluginRegistry.set(manifest.name, {
    pluginId,
    containerName,
    mcpPort: manifest.mcpPort,
    uiPort: manifest.uiPort ?? null,
    tools,
    toolsDoc,
  });

  console.log(
    `[Plugins] Plugin '${manifest.name}' installed (status: ${status}, tools: ${tools.join(', ') || 'none'})`
  );

  // 8. Auto-link all existing agents; restart them only if plugin is running
  const allAgents = await db.select().from(agents);
  for (const agent of allAgents) {
    const [existing] = await db
      .select()
      .from(agentPlugins)
      .where(and(eq(agentPlugins.agentId, agent.id), eq(agentPlugins.pluginId, pluginId)))
      .limit(1);

    if (!existing) {
      await db.insert(agentPlugins).values({ agentId: agent.id, pluginId });
    }

    if (status === 'running') {
      // Fire-and-forget — don't block the HTTP response
      rebuildAndRestartAgent(agent.id)
        .then(() => {
          console.log(`[Plugins] Agent '${agent.id}' restarted with plugin '${manifest.name}'`);
        })
        .catch((err) => {
          console.error(`[Plugins] Failed to restart agent '${agent.id}':`, err);
        });
    }
  }

  return c.json(
    {
      id: pluginId,
      name: manifest.name,
      version: manifest.version,
      status,
      tools,
      sidebarSlot: manifest.sidebar ?? null,
    },
    201
  );
});

// ---------------------------------------------------------------------------
// GET /api/plugins
// ---------------------------------------------------------------------------

pluginRoutes.get('/', requireAuth, async (c) => {
  const allPlugins = await db.select().from(plugins);

  const result = allPlugins.map((p) => {
    const entry = pluginRegistry.get(p.name);
    return {
      ...p,
      sidebarSlot: p.sidebarSlot ? JSON.parse(p.sidebarSlot) : null,
      replacesNativeFeatures: p.replacesNativeFeatures ? JSON.parse(p.replacesNativeFeatures) : [],
      tools: entry?.tools ?? [],
    };
  });

  return c.json({ plugins: result });
});

// ---------------------------------------------------------------------------
// GET /api/plugins/:id
// ---------------------------------------------------------------------------

pluginRoutes.get('/:id', requireAuth, async (c) => {
  const pluginId = c.req.param('id');

  const [plugin] = await db.select().from(plugins).where(eq(plugins.id, pluginId)).limit(1);

  if (!plugin) {
    return c.json({ error: 'Plugin not found' }, 404);
  }

  const entry = pluginRegistry.get(plugin.name);

  return c.json({
    plugin: {
      ...plugin,
      sidebarSlot: plugin.sidebarSlot ? JSON.parse(plugin.sidebarSlot) : null,
      replacesNativeFeatures: plugin.replacesNativeFeatures
        ? JSON.parse(plugin.replacesNativeFeatures)
        : [],
      tools: entry?.tools ?? [],
    },
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/plugins/:id
// ---------------------------------------------------------------------------

pluginRoutes.delete('/:id', requireAuth, async (c) => {
  const pluginId = c.req.param('id');

  const [plugin] = await db.select().from(plugins).where(eq(plugins.id, pluginId)).limit(1);

  if (!plugin) {
    return c.json({ error: 'Plugin not found' }, 404);
  }

  // Stop and remove container
  try {
    const container = docker.getContainer(plugin.containerName);
    await container.stop();
    await container.remove();
  } catch (err) {
    console.warn(`[Plugins] Failed to stop/remove container '${plugin.containerName}':`, err);
  }

  // Find all agents linked to this plugin before removing
  const linkedRows = await db
    .select({ agentId: agentPlugins.agentId })
    .from(agentPlugins)
    .where(eq(agentPlugins.pluginId, pluginId));

  // Remove from registry first so rebuildAndRestartAgent won't include it
  pluginRegistry.delete(plugin.name);

  // Cascade delete agent_plugins
  await db.delete(agentPlugins).where(eq(agentPlugins.pluginId, pluginId));

  // Delete plugin record
  await db.delete(plugins).where(eq(plugins.id, pluginId));

  console.log(`[Plugins] Plugin '${plugin.name}' deleted`);

  // Restart affected agents without the removed plugin (fire-and-forget)
  for (const { agentId } of linkedRows) {
    rebuildAndRestartAgent(agentId)
      .then(() => {
        console.log(`[Plugins] Agent '${agentId}' restarted after plugin removal`);
      })
      .catch((err) => {
        console.error(`[Plugins] Failed to restart agent '${agentId}':`, err);
      });
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Helper: generic HTTP proxy to a plugin container port
// ---------------------------------------------------------------------------

async function proxyToPlugin(
  c: Parameters<typeof pluginRoutes.all>[1],
  containerName: string,
  port: number,
  stripPrefix: string
): Promise<Response> {
  const rawPath = c.req.path.replace(new RegExp(`^${stripPrefix}`), '') || '/';
  const queryString = c.req.url.includes('?') ? `?${c.req.url.split('?')[1]}` : '';
  const targetUrl = `http://${containerName}:${port}${rawPath}${queryString}`;

  const body = ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer();
  const headers = new Headers();
  const contentType = c.req.header('content-type');
  if (contentType) headers.set('content-type', contentType);

  const res = await fetch(targetUrl, {
    method: c.req.method,
    headers,
    body,
    signal: AbortSignal.timeout(10000),
  });

  const responseBody = await res.arrayBuffer();
  return new Response(responseBody, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    },
  });
}

// ---------------------------------------------------------------------------
// ALL /api/plugins/:name/ui/* — transparent UI proxy (no auth, iframe-safe)
// Proxies HTML/JS/CSS assets from the plugin's uiPort
// Passes nf_token query param as X-NanoFleet-Token header to the plugin
// ---------------------------------------------------------------------------

pluginRoutes.all('/:name/ui/*', async (c) => {
  const pluginName = c.req.param('name');
  const entry = pluginRegistry.get(pluginName);

  if (!entry || !entry.uiPort) {
    return c.json({ error: `Plugin '${pluginName}' has no UI` }, 404);
  }

  try {
    return await proxyToPlugin(
      c,
      entry.containerName,
      entry.uiPort,
      `/api/plugins/${pluginName}/ui`
    );
  } catch (err) {
    return c.json(
      { error: `UI proxy error: ${err instanceof Error ? err.message : 'Unknown error'}` },
      502
    );
  }
});

// ---------------------------------------------------------------------------
// ALL /api/plugins/:name/rest/* — REST API proxy (auth required)
// Proxies JSON API calls from the NanoFleet web UI to the plugin's uiPort
// ---------------------------------------------------------------------------

pluginRoutes.all('/:name/rest/*', requireAuth, async (c) => {
  const pluginName = c.req.param('name');
  const entry = pluginRegistry.get(pluginName);

  if (!entry || !entry.uiPort) {
    return c.json({ error: `Plugin '${pluginName}' not found or has no REST API` }, 404);
  }

  try {
    return await proxyToPlugin(
      c,
      entry.containerName,
      entry.uiPort,
      `/api/plugins/${pluginName}/rest`
    );
  } catch (err) {
    return c.json(
      { error: `Proxy error: ${err instanceof Error ? err.message : 'Unknown error'}` },
      502
    );
  }
});

// ---------------------------------------------------------------------------
// POST /api/plugins/:id/restart
// ---------------------------------------------------------------------------

pluginRoutes.post('/:id/restart', requireAuth, async (c) => {
  const pluginId = c.req.param('id');

  const [plugin] = await db.select().from(plugins).where(eq(plugins.id, pluginId)).limit(1);

  if (!plugin) {
    return c.json({ error: 'Plugin not found' }, 404);
  }

  try {
    const container = docker.getContainer(plugin.containerName);
    await container.stop();
    await container.start();
  } catch (err) {
    return c.json(
      {
        error: `Failed to restart container: ${err instanceof Error ? err.message : 'Unknown error'}`,
      },
      500
    );
  }

  // Re-fetch tools after restart
  await Bun.sleep(2000);
  const tools = await fetchPluginTools(plugin.containerName, plugin.mcpPort);
  const status = tools.length > 0 ? 'running' : 'error';

  await db.update(plugins).set({ status }).where(eq(plugins.id, pluginId));

  pluginRegistry.set(plugin.name, {
    pluginId: plugin.id,
    containerName: plugin.containerName,
    mcpPort: plugin.mcpPort,
    uiPort: plugin.uiPort ?? null,
    tools,
    toolsDoc: plugin.toolsDoc ?? null,
  });

  console.log(`[Plugins] Plugin '${plugin.name}' restarted (status: ${status})`);

  // Ensure all agents are linked and rebuild their config (fire-and-forget)
  if (status === 'running') {
    const allAgents = await db.select().from(agents);
    for (const agent of allAgents) {
      const [existing] = await db
        .select()
        .from(agentPlugins)
        .where(and(eq(agentPlugins.agentId, agent.id), eq(agentPlugins.pluginId, plugin.id)))
        .limit(1);

      if (!existing) {
        await db.insert(agentPlugins).values({ agentId: agent.id, pluginId });
      }

      rebuildAndRestartAgent(agent.id)
        .then(() => {
          console.log(`[Plugins] Agent '${agent.id}' restarted with plugin '${plugin.name}'`);
        })
        .catch((err) => {
          console.error(`[Plugins] Failed to restart agent '${agent.id}':`, err);
        });
    }
  }

  return c.json({ success: true, status, tools });
});
