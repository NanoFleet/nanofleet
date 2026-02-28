import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { docker, ensureAgentImage, getAgentImageVersion } from '@nanofleet/docker';
import {
  AgentPackManifestSchema,
  CreateAgentPayloadSchema,
  UpdateAgentPayloadSchema,
} from '@nanofleet/shared';
import { db } from '../db';
import { agentPlugins, agents, apiKeys, plugins } from '../db/schema';
import { rebuildAndRestartAgent } from '../lib/agent-lifecycle';
import { decrypt } from '../lib/crypto';
import { attachToContainerLogs } from '../lib/log-stream';
import {
  type McpServerEntry,
  SHARED_HOST_DIR,
  agentWorkspaceHostPath,
  agentWorkspaceInternalPath,
  setupAgentWorkspace,
} from '../lib/agent-config';
import { PACKS_DIR, getRequiredEnvVars, validatePack } from '../lib/packs';
import { broadcastAgentStatus, broadcastToAgent } from '../lib/ws-manager';
import { requireAuth } from '../middleware/auth';
import type { AuthContext } from '../middleware/auth';
import { pluginRegistry } from './plugins';

export const agentRoutes = new Hono();

const NETWORK_NAME = 'nanofleet-net';

// Routing providers that can handle any model vendor.
const ROUTING_PROVIDERS = ['openrouter', 'vllm'] as const;

// Build the env var name for a provider API key (e.g. "anthropic" → "ANTHROPIC_API_KEY").
function providerEnvVar(providerName: string): string {
  return `${providerName.toUpperCase()}_API_KEY`;
}

// Resolve which provider key to use for a given model string.
// Returns { envVarName, apiKey } so the key can be passed directly as an env var to the container.
async function resolveProviderKey(
  model: string,
  lookupKey: (name: string) => Promise<string | null>
): Promise<{ envVarName: string; apiKey: string }> {
  const vendorName = (model.split('/')[0] || '').toLowerCase();

  const directKey = await lookupKey(vendorName);
  if (directKey) {
    return { envVarName: providerEnvVar(vendorName), apiKey: directKey };
  }

  for (const routingProvider of ROUTING_PROVIDERS) {
    const routingKey = await lookupKey(routingProvider);
    if (routingKey) {
      return { envVarName: providerEnvVar(routingProvider), apiKey: routingKey };
    }
  }

  throw new Error(
    `Missing API key for model '${model}'. Add a '${vendorName}' key or a routing provider key (${ROUTING_PROVIDERS.join(', ')}) in Settings.`
  );
}

agentRoutes.post('/', requireAuth, async (c) => {
  const user = c.get('user') as AuthContext;
  const body = await c.req.json();

  const parsed = CreateAgentPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation Error', details: parsed.error.issues }, 400);
  }

  const { name, packPath, sessionVars, tags, model: modelOverride } = parsed.data;

  const packFullPath = resolve(PACKS_DIR, packPath);

  const validation = await validatePack(packFullPath);
  if (!validation.valid) {
    return c.json({ error: 'Invalid Agent Pack', errors: validation.errors }, 400);
  }

  const manifestPath = resolve(packFullPath, 'manifest.json');
  const manifestContent = await readFile(manifestPath, 'utf-8');
  const manifest = AgentPackManifestSchema.parse(JSON.parse(manifestContent));
  const model = modelOverride ?? manifest.model;

  const requiredEnvVars = await getRequiredEnvVars(packFullPath);

  const envVars: Record<string, string> = {};

  for (const varName of requiredEnvVars) {
    if (sessionVars?.[varName]) {
      envVars[varName] = sessionVars[varName];
    } else {
      const keyRecords = await db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.userId, user.userId), sql`lower(${apiKeys.keyName}) = lower(${varName})`)
        )
        .limit(1);

      const keyRecord = keyRecords[0];
      if (!keyRecord) {
        return c.json(
          { error: `Missing API key '${varName}'. Please configure it in Settings.` },
          400
        );
      }
      envVars[varName] = decrypt(keyRecord.encryptedValue);
    }
  }

  let providerEnvVarName: string;
  let providerApiKey: string;
  try {
    const result = await resolveProviderKey(model, async (name) => {
      const varName = `${name.toUpperCase()}_API_KEY`;
      if (envVars[varName]) return envVars[varName];
      const keyRecords = await db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.userId, user.userId), sql`lower(${apiKeys.keyName}) = lower(${name})`)
        )
        .limit(1);
      const keyRecord = keyRecords[0];
      return keyRecord ? decrypt(keyRecord.encryptedValue) : null;
    });
    providerEnvVarName = result.envVarName;
    providerApiKey = result.apiKey;
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Missing API key' }, 400);
  }

  const agentVersion = await ensureAgentImage();

  const agentId = crypto.randomUUID();

  // Auto-link all running plugins to this new agent
  const runningPlugins = await db.select().from(plugins).where(eq(plugins.status, 'running'));

  if (runningPlugins.length > 0) {
    await db.insert(agentPlugins).values(runningPlugins.map((p) => ({ agentId, pluginId: p.id })));
  }

  // Build MCP server entries from the registry
  const mcpServers: McpServerEntry[] = runningPlugins
    .map((p) => {
      const entry = pluginRegistry.get(p.name);
      if (!entry) return null;
      return {
        pluginName: p.name,
        containerName: entry.containerName,
        mcpPort: entry.mcpPort,
        toolsDoc: entry.toolsDoc ?? null,
      };
    })
    .filter((e): e is McpServerEntry => e !== null);

  await setupAgentWorkspace({
    agentId,
    packPath: packFullPath,
    mcpServers,
  });

  const container = await docker.createContainer({
    Image: 'nanofleet-agent:latest',
    name: `nanofleet-agent-${agentId}`,
    Env: [
      `AGENT_MODEL=${model}`,
      `AGENT_WORKSPACE=/workspace`,
      `MEMORY_DB_PATH=/workspace/.db/agent.db`,
      `PORT=4111`,
      `${providerEnvVarName}=${providerApiKey}`,
    ],
    HostConfig: {
      Binds: [
        `${agentWorkspaceHostPath(agentId)}:/workspace`,
        `${SHARED_HOST_DIR}:/shared`,
      ],
      NetworkMode: NETWORK_NAME,
    },
  });

  const containerInfo = await container.inspect();
  const containerId = containerInfo.Id;

  await db.insert(agents).values({
    id: agentId,
    name,
    status: 'starting',
    packPath: packFullPath,
    model,
    agentVersion,
    containerId,
    token: crypto.randomUUID(),
    tags: JSON.stringify(tags ?? []),
  });

  await container.start();

  await db.update(agents).set({ status: 'running' }).where(eq(agents.id, agentId));

  attachToContainerLogs(docker, containerId, agentId, {
    onLog: (id, log) => broadcastToAgent(id, log),
    onError: (id, error) => {
      console.error(`[LogStream] Agent ${id} error:`, error.message);
    },
  });

  return c.json(
    {
      id: agentId,
      name,
      status: 'running',
      containerId,
    },
    201
  );
});

function parseTags(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

agentRoutes.get('/', requireAuth, async (c) => {
  const [allAgents, agentImageVersion] = await Promise.all([
    db.select().from(agents),
    getAgentImageVersion(),
  ]);

  return c.json({
    agentImageVersion,
    agents: allAgents.map((a) => ({ ...a, tags: parseTags(a.tags) })),
  });
});

agentRoutes.get('/:id', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ agent: { ...agent, tags: parseTags(agent.tags) } });
});

agentRoutes.patch('/:id', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  const body = await c.req.json();
  const parsed = UpdateAgentPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation Error', details: parsed.error.issues }, 400);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.tags !== undefined) {
    updates.tags = JSON.stringify(parsed.data.tags);
  }
  if (parsed.data.model !== undefined) {
    updates.model = parsed.data.model;
  }

  if (Object.keys(updates).length > 0) {
    await db.update(agents).set(updates).where(eq(agents.id, agentId));
  }

  return c.json({ success: true });
});

agentRoutes.post('/:id/pause', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  if (!agent.containerId) {
    return c.json({ error: 'Agent has no container' }, 400);
  }

  const container = docker.getContainer(agent.containerId);
  await container.stop();

  await db.update(agents).set({ status: 'stopped' }).where(eq(agents.id, agentId));
  broadcastAgentStatus(agentId, 'stopped');

  return c.json({ success: true });
});

agentRoutes.post('/:id/resume', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  if (!agent.containerId) {
    return c.json({ error: 'Agent has no container' }, 400);
  }

  const container = docker.getContainer(agent.containerId);
  await container.start();

  await db.update(agents).set({ status: 'running' }).where(eq(agents.id, agentId));
  broadcastAgentStatus(agentId, 'running');

  attachToContainerLogs(docker, agent.containerId, agentId, {
    onLog: (id, log) => broadcastToAgent(id, log),
    onError: (id, error) => {
      console.error(`[LogStream] Agent ${id} error:`, error.message);
    },
  });

  return c.json({ success: true });
});

agentRoutes.post('/:id/upgrade', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  if (agent.containerId) {
    try {
      const old = docker.getContainer(agent.containerId);
      await old.stop();
      await old.remove();
    } catch (error) {
      console.error('[Upgrade] Failed to stop/remove old container:', error);
    }
  }

  const agentVersion = await getAgentImageVersion();

  // Resolve provider key from vault to rebuild env vars
  const model = agent.model ?? '';
  let providerEnvVarName: string | undefined;
  let providerApiKey: string | undefined;
  if (model) {
    try {
      const result = await resolveProviderKey(model, async (name) => {
        const [keyRecord] = await db
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.keyName, name))
          .limit(1);
        return keyRecord ? decrypt(keyRecord.encryptedValue) : null;
      });
      providerEnvVarName = result.envVarName;
      providerApiKey = result.apiKey;
    } catch {
      // If key resolution fails, container will start without provider key
      console.warn(`[Upgrade] Could not resolve provider key for agent ${agentId}`);
    }
  }

  const envVars = [
    `AGENT_MODEL=${model}`,
    `AGENT_WORKSPACE=/workspace`,
    `MEMORY_DB_PATH=/workspace/.db/agent.db`,
    `PORT=4111`,
    ...(providerEnvVarName && providerApiKey
      ? [`${providerEnvVarName}=${providerApiKey}`]
      : []),
  ];

  const container = await docker.createContainer({
    Image: 'nanofleet-agent:latest',
    name: `nanofleet-agent-${agentId}`,
    Env: envVars,
    HostConfig: {
      Binds: [
        `${agentWorkspaceHostPath(agentId)}:/workspace`,
        `${SHARED_HOST_DIR}:/shared`,
      ],
      NetworkMode: NETWORK_NAME,
    },
  });

  const containerInfo = await container.inspect();
  const containerId = containerInfo.Id;

  await db
    .update(agents)
    .set({ containerId, agentVersion, status: 'starting' })
    .where(eq(agents.id, agentId));

  await container.start();

  await db.update(agents).set({ status: 'running' }).where(eq(agents.id, agentId));
  broadcastAgentStatus(agentId, 'running');

  attachToContainerLogs(docker, containerId, agentId, {
    onLog: (id, log) => broadcastToAgent(id, log),
    onError: (id, error) => console.error(`[LogStream] Agent ${id} error:`, error.message),
  });

  return c.json({ success: true });
});

agentRoutes.delete('/:id', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  if (agent.containerId) {
    try {
      const container = docker.getContainer(agent.containerId);
      await container.stop();
      await container.remove();
    } catch (error) {
      console.error('Failed to remove container:', error);
    }
  }

  broadcastAgentStatus(agentId, 'stopped');
  await db.delete(agents).where(eq(agents.id, agentId));

  return c.json({ success: true });
});

const CONFIG_FILES = { soul: 'SOUL.md', tools: 'TOOLS.md' } as const;
type ConfigFile = keyof typeof CONFIG_FILES;

agentRoutes.get('/:id/config/:file', requireAuth, async (c) => {
  const agentId = c.req.param('id');
  const file = c.req.param('file') as ConfigFile;

  if (!CONFIG_FILES[file]) {
    return c.json({ error: 'Invalid config file' }, 400);
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const filePath = resolve(agentWorkspaceInternalPath(agentId), CONFIG_FILES[file]);
  try {
    const content = await readFile(filePath, 'utf-8');
    return c.json({ content });
  } catch {
    return c.json({ content: '' });
  }
});

agentRoutes.put('/:id/config/:file', requireAuth, async (c) => {
  const agentId = c.req.param('id');
  const file = c.req.param('file') as ConfigFile;

  if (!CONFIG_FILES[file]) {
    return c.json({ error: 'Invalid config file' }, 400);
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json();
  if (typeof body.content !== 'string') {
    return c.json({ error: 'content must be a string' }, 400);
  }

  const filePath = resolve(agentWorkspaceInternalPath(agentId), CONFIG_FILES[file]);
  await writeFile(filePath, body.content, 'utf-8');

  return c.json({ success: true });
});

agentRoutes.get('/:id/workspace', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const workspaceDir = agentWorkspaceInternalPath(agentId);
  try {
    const entries = await readdir(workspaceDir, { recursive: true });
    const files = await Promise.all(
      entries.map(async (name) => {
        const fileStat = await stat(resolve(workspaceDir, name as string));
        return fileStat.isFile() ? { name, size: fileStat.size } : null;
      })
    );
    return c.json({ files: files.filter(Boolean) });
  } catch {
    return c.json({ files: [] });
  }
});

agentRoutes.get('/:id/workspace/:filename', requireAuth, async (c) => {
  const agentId = c.req.param('id');
  const filename = c.req.param('filename');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const workspaceDir = agentWorkspaceInternalPath(agentId);
  const filePath = resolve(workspaceDir, filename);

  if (!filePath.startsWith(workspaceDir)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    return c.json({ content });
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }
});

agentRoutes.put('/:id/workspace/:filename', requireAuth, async (c) => {
  const agentId = c.req.param('id');
  const filename = c.req.param('filename');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const workspaceDir = agentWorkspaceInternalPath(agentId);
  const filePath = resolve(workspaceDir, filename);

  if (!filePath.startsWith(`${workspaceDir}/`)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const body = await c.req.json();
  if (typeof body.content !== 'string') {
    return c.json({ error: 'content must be a string' }, 400);
  }

  await writeFile(filePath, body.content, 'utf-8');
  return c.json({ success: true });
});

agentRoutes.post('/:id/workspace', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.parseBody();
  const file = body.file;

  if (!(file instanceof File)) {
    return c.json({ error: 'No file provided' }, 400);
  }

  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_SIZE) {
    return c.json({ error: 'File too large (max 10MB)' }, 400);
  }

  const filename = basename(file.name);
  if (!filename) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const workspaceDir = agentWorkspaceInternalPath(agentId);
  const filePath = resolve(workspaceDir, filename);

  if (!filePath.startsWith(workspaceDir)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const buffer = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(buffer));

  return c.json({ success: true, filename });
});

agentRoutes.delete('/:id/workspace/:filename', requireAuth, async (c) => {
  const agentId = c.req.param('id');
  const filename = c.req.param('filename');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const workspaceDir = agentWorkspaceInternalPath(agentId);
  const filePath = resolve(workspaceDir, filename);

  if (!filePath.startsWith(workspaceDir)) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  try {
    await rm(filePath);
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// Agent ↔ Plugin scope management
// ---------------------------------------------------------------------------

agentRoutes.get('/:id/plugins', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const rows = await db
    .select({ plugin: plugins })
    .from(agentPlugins)
    .innerJoin(plugins, eq(agentPlugins.pluginId, plugins.id))
    .where(eq(agentPlugins.agentId, agentId));

  return c.json({ plugins: rows.map((r) => r.plugin) });
});

agentRoutes.post('/:id/plugins/:pluginId', requireAuth, async (c) => {
  const agentId = c.req.param('id');
  const pluginId = c.req.param('pluginId');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  const [plugin] = await db.select().from(plugins).where(eq(plugins.id, pluginId)).limit(1);
  if (!plugin) return c.json({ error: 'Plugin not found' }, 404);

  const [existing] = await db
    .select()
    .from(agentPlugins)
    .where(and(eq(agentPlugins.agentId, agentId), eq(agentPlugins.pluginId, pluginId)))
    .limit(1);

  if (existing) {
    return c.json({ error: 'Plugin already enabled for this agent' }, 409);
  }

  await db.insert(agentPlugins).values({ agentId, pluginId });

  // Rebuild .mcp.json and restart agent so the new MCP server is available
  try {
    await rebuildAndRestartAgent(agentId);
  } catch (err) {
    console.error(`[Agents] Failed to restart agent ${agentId} after plugin link:`, err);
  }

  return c.json({ success: true }, 201);
});

agentRoutes.delete('/:id/plugins/:pluginId', requireAuth, async (c) => {
  const agentId = c.req.param('id');
  const pluginId = c.req.param('pluginId');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  await db
    .delete(agentPlugins)
    .where(and(eq(agentPlugins.agentId, agentId), eq(agentPlugins.pluginId, pluginId)));

  return c.json({ success: true });
});
