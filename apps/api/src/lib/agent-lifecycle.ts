import { eq } from 'drizzle-orm';

import { docker } from '@nanofleet/docker';
import { db } from '../db';
import { agentPlugins, agents, plugins } from '../db/schema';
import { pluginRegistry } from '../routes/plugins';
import { type McpServerEntry, setupAgentWorkspace } from './agent-config';
import { attachToContainerLogs } from './log-stream';
import { broadcastAgentStatus, broadcastToAgent } from './ws-manager';

// ---------------------------------------------------------------------------
// Rebuild .mcp.json and restart an agent container with its current plugins.
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

  // Regenerate .mcp.json (does NOT overwrite SOUL.md/skills if already present)
  await setupAgentWorkspace({
    agentId,
    packPath: agent.packPath,
    mcpServers,
  });

  // Stop + start the container to pick up new .mcp.json
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
