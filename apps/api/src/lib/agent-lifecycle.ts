import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';

import { docker } from '@nanofleet/docker';
import { AgentPackManifestSchema } from '@nanofleet/shared';
import { db } from '../db';
import { agentPlugins, agents, apiKeys, plugins } from '../db/schema';
import { pluginRegistry } from '../routes/plugins';
import { decrypt } from './crypto';
import { attachToContainerLogs } from './log-stream';
import { type McpServerEntry, generateAgentConfig, resolveProvider } from './agent-config';
import { broadcastAgentStatus, broadcastToAgent } from './ws-manager';

// ---------------------------------------------------------------------------
// Rebuild config and restart an agent container with its current plugins.
// Called when a plugin is installed/removed or manually linked/unlinked.
// ---------------------------------------------------------------------------

export async function rebuildAndRestartAgent(agentId: string): Promise<void> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || !agent.containerId) return;

  // Resolve current MCP servers for this agent
  const agentPluginRows = await db
    .select({ plugin: plugins })
    .from(agentPlugins)
    .innerJoin(plugins, eq(agentPlugins.pluginId, plugins.id))
    .where(eq(agentPlugins.agentId, agentId));

  const mcpServers: McpServerEntry[] = agentPluginRows
    .map((row) => {
      const entry = pluginRegistry.get(row.plugin.name);
      if (!entry) return null;
      return {
        pluginName: row.plugin.name,
        containerName: entry.containerName,
        mcpPort: entry.mcpPort,
        toolsDoc: entry.toolsDoc ?? null,
      };
    })
    .filter((e): e is McpServerEntry => e !== null);

  // Use model from DB if set (user override), otherwise fall back to pack manifest
  const manifestPath = resolve(agent.packPath, 'manifest.json');
  const manifestContent = await readFile(manifestPath, 'utf-8');
  const manifest = AgentPackManifestSchema.parse(JSON.parse(manifestContent));
  const model = agent.model ?? manifest.model;

  // Resolve provider key with routing fallback (openrouter, vllm, etc.)
  const { providerName, apiKey } = await resolveProvider(model, async (name) => {
    const [keyRecord] = await db.select().from(apiKeys).where(eq(apiKeys.keyName, name)).limit(1);
    return keyRecord ? decrypt(keyRecord.encryptedValue) : null;
  });

  const providerKeys: Record<string, string> = { [providerName]: apiKey };

  // Read Brave Search key if the pack requests web search
  let braveApiKey: string | undefined;
  if (manifest.webSearch) {
    const [braveRecord] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyName, 'brave'))
      .limit(1);
    if (braveRecord) {
      braveApiKey = decrypt(braveRecord.encryptedValue);
    }
  }

  // Regenerate config.json (does NOT overwrite SOUL.md/TOOLS.md if already present)
  await generateAgentConfig({
    agentId,
    model,
    providerKeys,
    resolvedProviderName: providerName,
    packPath: agent.packPath,
    mcpServers,
    webSearch: manifest.webSearch && !!braveApiKey,
    braveApiKey,
  });

  // Stop + start the container to pick up new config
  const container = docker.getContainer(agent.containerId);
  try {
    await container.stop();
  } catch {
    // may already be stopped
  }
  await container.start();

  await db.update(agents).set({ status: 'running' }).where(eq(agents.id, agentId));
  broadcastAgentStatus(agentId, 'running');

  attachToContainerLogs(docker, agent.containerId, agentId, {
    onLog: (id, log) => broadcastToAgent(id, log),
    onError: (id, error) => {
      console.error(`[LogStream] Agent ${id} error:`, error.message);
    },
  });
}
