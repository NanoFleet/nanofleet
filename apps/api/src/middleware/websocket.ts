import { verifyAccessToken } from '../lib/auth';

export interface WebSocketContext {
  userId: string;
  role: string;
}

export async function verifyWebSocketToken(token: string): Promise<WebSocketContext | null> {
  const payload = await verifyAccessToken(token);
  if (!payload) return null;

  return {
    userId: payload.userId as string,
    role: payload.role as string,
  };
}

export async function wsAuthMiddleware(
  token: string | undefined
): Promise<WebSocketContext | null> {
  if (!token) return null;
  return verifyWebSocketToken(token);
}
