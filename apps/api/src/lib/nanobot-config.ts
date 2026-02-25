import { access, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Internal base: where the API reads/writes files (container path or local home).
const NANOFLEET_BASE = resolve(homedir(), '.nanofleet');

// Host base: path on the Docker HOST machine, used only for bind mount strings
// passed to the Docker daemon. Must be set when the API runs inside Docker.
const NANOFLEET_HOST_BASE = process.env.NANOFLEET_HOST_HOME ?? NANOFLEET_BASE;

export const INSTANCES_DIR = resolve(NANOFLEET_BASE, 'instances');
export const SHARED_WORKSPACE_DIR = resolve(NANOFLEET_BASE, 'workspace');
export const SHARED_DIR = resolve(NANOFLEET_BASE, 'shared');

// Returns the path as seen by the Docker daemon (host machine path).
// Use this ONLY for Docker bind mount strings, not for reading/writing files.
export function agentWorkspaceHostPath(agentId: string): string {
  return resolve(NANOFLEET_HOST_BASE, 'workspace', agentId);
}

// Returns the path accessible by the API process for reading/writing files.
export function agentWorkspaceInternalPath(agentId: string): string {
  return resolve(NANOFLEET_BASE, 'workspace', agentId);
}

// Returns the host-side paths for bind mounts.
export const INSTANCES_HOST_DIR = resolve(NANOFLEET_HOST_BASE, 'instances');
export const SHARED_HOST_DIR = resolve(NANOFLEET_HOST_BASE, 'shared');

export interface McpServerEntry {
  pluginName: string;
  containerName: string;
  mcpPort: number;
  toolsDoc?: string | null;
}

// Providers that can route requests to any model vendor.
// When no direct provider key is found, these are checked as fallback.
export const ROUTING_PROVIDERS = ['openrouter', 'vllm'] as const;

export interface ResolveProviderResult {
  providerName: string;
  apiKey: string;
}

/**
 * Resolves which provider and API key to use for a given model.
 *
 * Resolution order:
 * 1. Direct match: key named after the model's vendor prefix (e.g. "anthropic" for "anthropic/claude-...")
 * 2. Routing provider fallback: first matching key from ROUTING_PROVIDERS (e.g. "openrouter")
 *
 * The lookupKey function receives a provider name and returns the decrypted API key or null.
 */
export async function resolveProvider(
  model: string,
  lookupKey: (name: string) => Promise<string | null>
): Promise<ResolveProviderResult> {
  const vendorName = (model.split('/')[0] || '').toLowerCase();

  // 1. Try direct vendor key
  const directKey = await lookupKey(vendorName);
  if (directKey) {
    return { providerName: vendorName, apiKey: directKey };
  }

  // 2. Try routing providers in order
  for (const routingProvider of ROUTING_PROVIDERS) {
    const routingKey = await lookupKey(routingProvider);
    if (routingKey) {
      return { providerName: routingProvider, apiKey: routingKey };
    }
  }

  throw new Error(
    `Missing API key for model '${model}'. Add a '${vendorName}' key or a routing provider key (${ROUTING_PROVIDERS.join(', ')}) in Settings.`
  );
}

export interface GenerateAgentConfigParams {
  agentId: string;
  model: string;
  providerKeys: Record<string, string>;
  /** Resolved provider name (may differ from model vendor when routing via openrouter/vllm). */
  resolvedProviderName?: string;
  packPath: string;
  mcpServers?: McpServerEntry[];
  webSearch?: boolean;
  braveApiKey?: string;
}

export async function generateAgentConfig({
  agentId,
  model,
  providerKeys,
  resolvedProviderName,
  packPath,
  mcpServers = [],
  webSearch = false,
  braveApiKey,
}: GenerateAgentConfigParams): Promise<string> {
  const providerName = resolvedProviderName ?? (model.split('/')[0]?.toLowerCase() || '');
  const apiKey = providerKeys[providerName];

  if (!apiKey) {
    throw new Error(`Missing API key in Vault for provider: ${providerName}`);
  }

  // Each agent gets its own subdirectory in the shared workspace
  // so SOUL.md and TOOLS.md don't collide between agents.
  const agentWorkspace = `/workspace/${agentId}`;

  // Build mcpServers map — agents connect directly to plugin containers on the Docker network.
  // No proxy needed: plugin MCP servers are only reachable from within nanofleet-net.
  const mcpServersConfig: Record<string, { url: string }> = {};
  for (const server of mcpServers) {
    // Include agentId as query param so the plugin can identify the caller
    mcpServersConfig[server.pluginName] = {
      url: `http://${server.containerName}:${server.mcpPort}/mcp?agent_id=${agentId}`,
    };
  }

  const config = {
    agents: {
      defaults: {
        workspace: agentWorkspace,
        model: model,
        maxTokens: 8192,
        temperature: 0.7,
        maxToolIterations: 20,
        memoryWindow: 50,
      },
    },
    channels: {
      whatsapp: { enabled: false },
      telegram: { enabled: false },
      discord: { enabled: false },
      slack: { enabled: false },
      email: { enabled: false },
      nanofleet: { enabled: true },
    },
    providers: {
      [providerName]: {
        apiKey: apiKey,
        apiBase: null,
        extraHeaders: null,
      },
    },
    gateway: {
      host: '0.0.0.0',
      port: 18790,
    },
    tools: {
      restrictToWorkspace: true,
      mcpServers: mcpServersConfig,
      ...(webSearch && braveApiKey
        ? {
            web: {
              search: {
                apiKey: braveApiKey,
                maxResults: 5,
              },
            },
          }
        : {}),
    },
  };

  const instanceDir = resolve(INSTANCES_DIR, agentId);
  await mkdir(instanceDir, { recursive: true });
  await mkdir(resolve(instanceDir, 'sessions'), { recursive: true });
  await mkdir(resolve(instanceDir, 'cron'), { recursive: true });
  await mkdir(resolve(instanceDir, 'bridge'), { recursive: true });

  const configPath = resolve(instanceDir, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Use internal path for both existence check and write (this is the path the API process can access)
  const internalWorkspaceDir = agentWorkspaceInternalPath(agentId);
  await mkdir(internalWorkspaceDir, { recursive: true });

  const soulPath = resolve(internalWorkspaceDir, 'SOUL.md');
  try {
    await access(soulPath);
    // File already exists — don't overwrite user edits
  } catch {
    try {
      await copyFile(resolve(packPath, 'SOUL.md'), soulPath);
    } catch {
      console.warn(`[Config] No SOUL.md found in pack: ${packPath}`);
    }
  }

  // Copy skills/ from pack to workspace (only if not already present)
  const skillsSrc = resolve(packPath, 'skills');
  const skillsDst = resolve(internalWorkspaceDir, 'skills');
  try {
    await access(skillsDst);
    // Already exists — don't overwrite
  } catch {
    try {
      await cp(skillsSrc, skillsDst, { recursive: true });
    } catch {
      // No skills directory in pack — that's fine
    }
  }

  // TOOLS.md is regenerated from active plugin docs + optional pack-level TOOLS.md
  const toolsPath = resolve(internalWorkspaceDir, 'TOOLS.md');
  const toolsSections = mcpServers.filter((s) => s.toolsDoc).map((s) => s.toolsDoc as string);

  // Append pack-level TOOLS.md if present (agent-specific tool instructions)
  let packToolsDoc: string | null = null;
  try {
    packToolsDoc = await readFile(resolve(packPath, 'TOOLS.md'), 'utf-8');
  } catch {
    // No TOOLS.md in pack — that's fine
  }

  const allSections = packToolsDoc ? [...toolsSections, packToolsDoc] : toolsSections;

  const toolsContent =
    allSections.length > 0
      ? `# Available Tools\n\n${allSections.join('\n\n---\n\n')}`
      : '# Available Tools\n\nNo plugins are currently installed. You have no external tools available.';

  await writeFile(toolsPath, toolsContent, 'utf-8');

  return instanceDir;
}

export async function ensureInstancesDir(): Promise<void> {
  await mkdir(INSTANCES_DIR, { recursive: true });
}

export async function ensureSharedWorkspaceDir(): Promise<void> {
  await mkdir(SHARED_WORKSPACE_DIR, { recursive: true });
}

export async function ensureSharedDir(): Promise<void> {
  await mkdir(SHARED_DIR, { recursive: true });
}
