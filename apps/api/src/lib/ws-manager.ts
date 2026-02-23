import type { ServerWebSocket } from 'bun';

const clients: Map<string, Set<ServerWebSocket<{ userId: string; agentId?: string }>>> = new Map();

export function subscribeToAgent(
  ws: ServerWebSocket<{ userId: string; agentId?: string }>,
  agentId: string,
  userId: string
): void {
  const wsData = ws.data;
  const room = `agent:${agentId}`;

  if (!clients.has(room)) {
    clients.set(room, new Set());
  }

  const roomClients = clients.get(room);
  if (roomClients) {
    roomClients.add(ws);
    if (wsData) {
      wsData.agentId = agentId;
    }
  }
}

export function unsubscribeFromAgent(
  ws: ServerWebSocket<{ userId: string; agentId?: string }>
): void {
  const wsData = ws.data;
  if (!wsData) return;

  const agentId = wsData.agentId;
  if (!agentId) return;

  const room = `agent:${agentId}`;
  const roomClients = clients.get(room);

  if (roomClients) {
    roomClients.delete(ws);

    if (roomClients.size === 0) {
      clients.delete(room);
    }
  }
}

export function broadcastToAgent(agentId: string, message: string): void {
  const room = `agent:${agentId}`;
  const roomClients = clients.get(room);

  if (!roomClients || roomClients.size === 0) {
    return;
  }

  const payload = JSON.stringify({
    type: 'log',
    agentId,
    message,
    timestamp: new Date().toISOString(),
  });

  for (const client of roomClients) {
    try {
      client.send(payload);
    } catch (error) {
      console.error('[WS] Failed to send to client:', error);
    }
  }
}

export function broadcastToAgentClients(agentId: string, payload: unknown): void {
  const room = `agent:${agentId}`;
  const roomClients = clients.get(room);

  if (!roomClients) return;

  const json = JSON.stringify(payload);

  for (const client of roomClients) {
    try {
      client.send(json);
    } catch (error) {
      console.error('[WS] Failed to send to client:', error);
    }
  }
}

export function broadcastAgentStatus(agentId: string, status: string): void {
  const room = `agent:${agentId}`;
  const roomClients = clients.get(room);

  if (!roomClients) return;

  const payload = JSON.stringify({
    type: 'status',
    agentId,
    status,
    timestamp: new Date().toISOString(),
  });

  for (const client of roomClients) {
    try {
      client.send(payload);
    } catch (error) {
      console.error('[WS] Failed to send status to client:', error);
    }
  }
}
