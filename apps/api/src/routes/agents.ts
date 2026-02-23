import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { docker, ensureNanobotImage } from '@nanofleet/docker';
import { AgentPackManifestSchema, CreateAgentPayloadSchema } from '@nanofleet/shared';
import { db } from '../db';
import { agentPlugins, agents, apiKeys, messages, plugins } from '../db/schema';
import { sendToAgent } from '../lib/agent-bus';
import { rebuildAndRestartAgent } from '../lib/agent-lifecycle';
import { decrypt } from '../lib/crypto';
import { attachToContainerLogs } from '../lib/log-stream';
import {
  INSTANCES_HOST_DIR,
  type McpServerEntry,
  SHARED_HOST_DIR,
  agentWorkspaceHostPath,
  agentWorkspaceInternalPath,
  generateAgentConfig,
} from '../lib/nanobot-config';
import { PACKS_DIR, getRequiredEnvVars, validatePack } from '../lib/packs';
import { broadcastAgentStatus, broadcastToAgent } from '../lib/ws-manager';
import { requireAuth } from '../middleware/auth';
import type { AuthContext } from '../middleware/auth';
import { pluginRegistry } from './plugins';

export const agentRoutes = new Hono();

const NETWORK_NAME = 'nanofleet-net';

agentRoutes.post('/', requireAuth, async (c) => {
  const user = c.get('user') as AuthContext;
  const body = await c.req.json();

  const parsed = CreateAgentPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation Error', details: parsed.error.issues }, 400);
  }

  const { name, packPath, sessionVars } = parsed.data;

  const packFullPath = resolve(PACKS_DIR, packPath);

  const validation = await validatePack(packFullPath);
  if (!validation.valid) {
    return c.json({ error: 'Invalid Agent Pack', errors: validation.errors }, 400);
  }

  const manifestPath = resolve(packFullPath, 'manifest.json');
  const manifestContent = await readFile(manifestPath, 'utf-8');
  const manifest = AgentPackManifestSchema.parse(JSON.parse(manifestContent));
  const model = manifest.model;

  const requiredEnvVars = await getRequiredEnvVars(packFullPath);

  const envVars: Record<string, string> = {};

  for (const varName of requiredEnvVars) {
    if (sessionVars?.[varName]) {
      envVars[varName] = sessionVars[varName];
    } else {
      const keyRecords = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, user.userId), eq(apiKeys.keyName, varName.toLowerCase())))
        .limit(1);

      if (keyRecords.length === 0) {
        return c.json(
          { error: `Missing API key '${varName}'. Please configure it in Settings.` },
          400
        );
      }

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

  const modelParts = model.split('/');
  const providerName = (modelParts[0] || '').toLowerCase();
  const providerKeyVar = `${providerName.toUpperCase()}_API_KEY`;

  if (!envVars[providerKeyVar]) {
    const keyRecords = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, user.userId), eq(apiKeys.keyName, providerName)))
      .limit(1);

    if (keyRecords.length === 0) {
      return c.json(
        { error: `Missing API key '${providerName}'. Please configure it in Settings.` },
        400
      );
    }

    const keyRecord = keyRecords[0];
    if (!keyRecord) {
      return c.json(
        { error: `Missing API key '${providerName}'. Please configure it in Settings.` },
        400
      );
    }
    envVars[providerKeyVar] = decrypt(keyRecord.encryptedValue);
  }

  await ensureNanobotImage();

  const agentId = crypto.randomUUID();
  const internalToken = crypto.randomUUID();

  const providerKeyName = `${providerName.toUpperCase()}_API_KEY`;
  const providerKeys: Record<string, string> = {};

  providerKeys[providerName] = envVars[providerKeyName] || '';

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

  const instanceDir = await generateAgentConfig({
    agentId,
    model,
    providerKeys,
    packPath: packFullPath,
    mcpServers,
  });

  const container = await docker.createContainer({
    Image: 'nanofleet-nanobot:latest',
    name: `nanofleet-agent-${agentId}`,
    Env: [
      `NANO_INTERNAL_TOKEN=${internalToken}`,
      `NANO_API_URL=${process.env.NANO_API_INTERNAL_URL ?? 'http://host.docker.internal:3000'}`,
      `NANO_AGENT_ID=${agentId}`,
    ],
    HostConfig: {
      Binds: [
        `${agentWorkspaceHostPath(agentId)}:/workspace/${agentId}`,
        `${SHARED_HOST_DIR}:/shared`,
        `${INSTANCES_HOST_DIR}/${agentId}:/root/.nanobot`,
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
    containerId,
    token: internalToken,
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

agentRoutes.get('/', requireAuth, async (c) => {
  const allAgents = await db.select().from(agents);

  return c.json({ agents: allAgents });
});

agentRoutes.get('/:id', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json({ agent });
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
    const entries = await readdir(workspaceDir);
    const files = await Promise.all(
      entries.map(async (name) => {
        const fileStat = await stat(resolve(workspaceDir, name));
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
  const filename = basename(c.req.param('filename'));

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
  const filename = basename(c.req.param('filename'));

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const workspaceDir = agentWorkspaceInternalPath(agentId);
  const filePath = resolve(workspaceDir, filename);

  if (!filePath.startsWith(workspaceDir)) {
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
  const filename = basename(c.req.param('filename'));

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

agentRoutes.get('/:id/messages', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.agentId, agentId))
    .orderBy(messages.createdAt);

  return c.json({ messages: history });
});

// ---------------------------------------------------------------------------
// Agent ↔ Plugin scope management (7.4)
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

  // Rebuild config and restart agent so the new MCP server is available
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

agentRoutes.post('/:id/messages', requireAuth, async (c) => {
  const agentId = c.req.param('id');

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  const body = await c.req.json();
  if (typeof body.content !== 'string' || !body.content.trim()) {
    return c.json({ error: 'content must be a non-empty string' }, 400);
  }

  const content: string = body.content.trim();

  await db.insert(messages).values({
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
