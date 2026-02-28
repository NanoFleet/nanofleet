import type Dockerode from 'dockerode';

export interface LogStreamHandler {
  onLog: (agentId: string, log: string) => void;
  onError: (agentId: string, error: Error) => void;
}

const activeStreams: Map<string, Dockerode.Container> = new Map();

function parseDockerStream(chunk: Buffer): string[] {
  const lines: string[] = [];
  let offset = 0;

  while (offset < chunk.length) {
    if (offset + 8 > chunk.length) break;

    const header = chunk.slice(offset, offset + 8);
    const size = header.readUInt32BE(4);

    if (size === 0 || offset + 8 + size > chunk.length) break;

    const payload = chunk.slice(offset + 8, offset + 8 + size);
    const text = payload.toString('utf-8').trim();

    if (text) {
      lines.push(text);
    }

    offset += 8 + size;
  }

  return lines;
}

export async function attachToContainerLogs(
  docker: Dockerode,
  containerId: string,
  agentId: string,
  handler: LogStreamHandler
): Promise<void> {
  const container = docker.getContainer(containerId);

  try {
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 100,
    });

    activeStreams.set(agentId, container);

    stream.on('data', (chunk: Buffer) => {
      const lines = parseDockerStream(chunk);
      for (const line of lines) {
        handler.onLog(agentId, line);
      }
    });

    stream.on('error', (error: Error) => {
      handler.onError(agentId, error);
    });

    stream.on('end', () => {
      activeStreams.delete(agentId);
    });
  } catch (error) {
    console.error(`[LogStream] Failed to attach to container for agent ${agentId}:`, error);
    handler.onError(agentId, error instanceof Error ? error : new Error(String(error)));
  }
}

export function stopLogStream(agentId: string): void {
  activeStreams.delete(agentId);
}
