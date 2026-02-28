import { access, copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// Internal base: where the API reads/writes files (container path or local home).
const NANOFLEET_BASE = resolve(homedir(), '.nanofleet');

// Host base: path on the Docker HOST machine, used only for bind mount strings
// passed to the Docker daemon. Must be set when the API runs inside Docker.
const NANOFLEET_HOST_BASE = process.env.NANOFLEET_HOST_HOME ?? NANOFLEET_BASE;

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

// Returns the host-side path for the shared bind mount.
export const SHARED_HOST_DIR = resolve(NANOFLEET_HOST_BASE, 'shared');

export interface McpServerEntry {
  pluginName: string;
  containerName: string;
  mcpPort: number;
}

export interface SetupAgentWorkspaceParams {
  agentId: string;
  packPath: string | null;
  mcpServers?: McpServerEntry[];
}

export async function setupAgentWorkspace({
  agentId,
  packPath,
  mcpServers = [],
}: SetupAgentWorkspaceParams): Promise<void> {
  const workspaceDir = agentWorkspaceInternalPath(agentId);
  await mkdir(workspaceDir, { recursive: true });

  if (packPath) {
    // Copy SOUL.md from pack → workspace (only if not already present)
    const soulPath = resolve(workspaceDir, 'SOUL.md');
    try {
      await access(soulPath);
      // Already exists — don't overwrite user edits
    } catch {
      try {
        await copyFile(resolve(packPath, 'SOUL.md'), soulPath);
      } catch {
        console.warn(`[AgentConfig] No SOUL.md found in pack: ${packPath}`);
      }
    }

    // Copy skills/ from pack → workspace (only if not already present)
    const skillsDst = resolve(workspaceDir, 'skills');
    try {
      await access(skillsDst);
      // Already exists — don't overwrite
    } catch {
      try {
        await cp(resolve(packPath, 'skills'), skillsDst, { recursive: true });
      } catch {
        // No skills directory in pack — that's fine
      }
    }
  }

  // Create required/optional workspace files if absent (nanofleet-agent expects them to exist)
  for (const filename of ['SOUL.md', 'MEMORY.md', 'STYLE.md', 'AGENTS.md', 'HISTORY.md']) {
    const filePath = resolve(workspaceDir, filename);
    try {
      await access(filePath);
    } catch {
      await writeFile(filePath, '', 'utf-8');
    }
  }

  // Ensure skills directory exists
  await mkdir(resolve(workspaceDir, 'skills'), { recursive: true });

  // Generate .mcp.json from active plugins.
  // Overwrite on every call so plugin changes are reflected on next restart.
  const mcpConfig: Record<string, { url: string }> = {};
  for (const server of mcpServers) {
    mcpConfig[server.pluginName] = {
      url: `http://${server.containerName}:${server.mcpPort}/mcp?agent_id=${agentId}`,
    };
  }

  await writeFile(
    resolve(workspaceDir, '.mcp.json'),
    JSON.stringify({ mcpServers: mcpConfig }, null, 2),
    'utf-8'
  );
}

export async function ensureSharedWorkspaceDir(): Promise<void> {
  await mkdir(SHARED_WORKSPACE_DIR, { recursive: true });
}

export async function ensureSharedDir(): Promise<void> {
  await mkdir(SHARED_DIR, { recursive: true });
}
