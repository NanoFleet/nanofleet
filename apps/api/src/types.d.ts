import type { AgentContext } from '../middleware/agent-auth';
import type { AuthContext } from '../middleware/auth';
import type { WebSocketContext } from '../middleware/websocket';

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthContext;
    wsUser: WebSocketContext;
    agent: AgentContext;
  }
}
