import type { ServerWebSocket } from 'bun';

type WS = ServerWebSocket<{ userId: string; agentId?: string }>;

const clients: Map<string, Set<WS>> = new Map();

const allClients = new Set<WS>();
let pingInterval: ReturnType<typeof setInterval> | null = null;

export function registerClient(ws: WS): void {
  allClients.add(ws);
  if (!pingInterval) {
    pingInterval = setInterval(() => {
      for (const client of allClients) {
        try {
          client.ping();
        } catch {
          allClients.delete(client);
        }
      }
    }, 30_000);
  }
}

export function unregisterClient(ws: WS): void {
  allClients.delete(ws);
  if (allClients.size === 0 && pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

export function subscribeToAgent(ws: WS, agentId: string, userId: string): void {
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

export function unsubscribeFromAgent(ws: WS): void {
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

  if (!roomClients || roomClients.size === 0) return;

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
