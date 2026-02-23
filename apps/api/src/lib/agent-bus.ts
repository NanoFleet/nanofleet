import type { ServerWebSocket } from 'bun';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { agents, messages } from '../db/schema';
import { broadcastToAgentClients } from './ws-manager';

// Map of agentId → live WebSocket connection from the nanobot container
const agentConnections = new Map<string, ServerWebSocket<unknown>>();

export function registerAgentConnection(agentId: string, ws: ServerWebSocket<unknown>): void {
  agentConnections.set(agentId, ws);
}

export function removeAgentConnection(agentId: string): void {
  agentConnections.delete(agentId);
}

export function sendToAgent(agentId: string, content: string): boolean {
  const ws = agentConnections.get(agentId);
  if (!ws) return false;

  const sessionKey = `nanofleet:${agentId}`;
  ws.send(JSON.stringify({ type: 'message', content, sessionKey }));
  return true;
}

export async function handleAgentResponse(agentId: string, content: string): Promise<void> {
  await db.insert(messages).values({
    id: crypto.randomUUID(),
    agentId,
    role: 'agent',
    content,
  });

  broadcastToAgentClients(agentId, {
    type: 'chat_message',
    agentId,
    role: 'agent',
    content,
    timestamp: new Date().toISOString(),
  });
}

export function handleAgentThinking(agentId: string): void {
  broadcastToAgentClients(agentId, {
    type: 'chat_thinking',
    agentId,
    timestamp: new Date().toISOString(),
  });
}

export function isAgentConnected(agentId: string): boolean {
  return agentConnections.has(agentId);
}
