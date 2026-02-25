import { useCallback, useEffect, useRef, useState } from 'react';

import { getAccessToken } from './api';

interface LogMessage {
  type: 'log' | 'status' | 'chat_message' | 'chat_thinking';
  agentId: string;
  message?: string;
  status?: string;
  role?: 'user' | 'agent';
  content?: string;
  timestamp: string;
}

interface UseWebSocketOptions {
  onLog?: (agentId: string, message: string) => void;
  onStatusChange?: (agentId: string, status: string) => void;
  onChatMessage?: (agentId: string, role: 'user' | 'agent', content: string) => void;
  onChatThinking?: (agentId: string) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const subscribedAgentsRef = useRef<Set<string>>(new Set());
  const optionsRef = useRef(options);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectingRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    optionsRef.current = options;
  });

  const connect = useCallback(() => {
    if (connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    connectingRef.current = true;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?token=${token}`);

    ws.onopen = () => {
      connectingRef.current = false;
      setIsConnected(true);
      for (const agentId of subscribedAgentsRef.current) {
        ws.send(JSON.stringify({ type: 'subscribe', agentId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: LogMessage = JSON.parse(event.data);
        const opts = optionsRef.current;

        if (data.type === 'log' && opts.onLog && data.message) {
          opts.onLog(data.agentId, data.message);
        } else if (data.type === 'status' && opts.onStatusChange && data.status) {
          opts.onStatusChange(data.agentId, data.status);
        } else if (
          data.type === 'chat_message' &&
          opts.onChatMessage &&
          data.role &&
          data.content
        ) {
          opts.onChatMessage(data.agentId, data.role, data.content);
        } else if (data.type === 'chat_thinking' && opts.onChatThinking) {
          opts.onChatThinking(data.agentId);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      connectingRef.current = false;
      setIsConnected(false);
      wsRef.current = null;

      if (!reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectRef.current();
        }, 3000);
      }
    };

    ws.onerror = () => {
      connectingRef.current = false;
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, []);

  connectRef.current = connect;

  const subscribe = useCallback((agentId: string) => {
    subscribedAgentsRef.current.add(agentId);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', agentId }));
    }
  }, []);

  const unsubscribe = useCallback((agentId: string) => {
    subscribedAgentsRef.current.delete(agentId);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', agentId }));
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    isConnected,
    subscribe,
    unsubscribe,
  };
}
