import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../lib/api';
import { useWebSocket } from '../lib/useWebSocket';

interface Message {
  id: string;
  agentId: string;
  role: 'user' | 'agent';
  content: string;
  createdAt: string;
}

interface AgentChatProps {
  agentId: string;
}

export function AgentChat({ agentId }: AgentChatProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['messages', agentId],
    queryFn: () => api.getAgentMessages(agentId),
  });

  const messages: Message[] = data?.messages ?? [];

  const { subscribe, unsubscribe } = useWebSocket({
    onChatMessage: (id, role, content) => {
      if (id !== agentId) return;
      setIsThinking(false);
      queryClient.setQueryData<{ messages: Message[] }>(['messages', agentId], (old) => {
        const existing = old?.messages ?? [];
        return {
          messages: [
            ...existing,
            {
              id: crypto.randomUUID(),
              agentId,
              role,
              content,
              createdAt: new Date().toISOString(),
            },
          ],
        };
      });
    },
    onChatThinking: (id) => {
      if (id !== agentId) return;
      setIsThinking(true);
    },
  });

  useEffect(() => {
    subscribe(agentId);
    return () => unsubscribe(agentId);
  }, [agentId, subscribe, unsubscribe]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages/thinking state
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  async function handleSend() {
    const content = input.trim();
    if (!content || isSending) return;

    setSendError(null);
    setIsSending(true);
    setInput('');

    // Optimistically add user message to the list
    queryClient.setQueryData<{ messages: Message[] }>(['messages', agentId], (old) => {
      const existing = old?.messages ?? [];
      return {
        messages: [
          ...existing,
          {
            id: crypto.randomUUID(),
            agentId,
            role: 'user',
            content,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    });

    try {
      await api.sendAgentMessage(agentId, content);
      setIsThinking(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t('agents.chat.sendError'));
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-pulse text-neutral-400 text-sm">{t('agents.chat.loading')}</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex justify-center py-8">
            <p className="text-neutral-400 text-sm">{t('agents.chat.empty')}</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-900 border border-neutral-200'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}

        {isThinking && (
          <div className="flex justify-start">
            <div className="bg-neutral-100 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-400 italic">
              {t('agents.chat.thinking')}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {sendError && (
        <div className="px-4 py-1 text-xs text-red-600 bg-red-50 border-t border-red-100">
          {sendError}
        </div>
      )}

      <div className="border-t border-neutral-200 p-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agents.chat.placeholder')}
          rows={1}
          className="flex-1 resize-none rounded border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-neutral-400 min-h-[38px] max-h-32"
          style={{ height: 'auto', overflowY: 'auto' }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!input.trim() || isSending}
          className="flex items-center justify-center px-3 py-2 bg-neutral-900 text-white rounded disabled:opacity-40 hover:bg-neutral-700 transition-colors"
          title={t('agents.chat.send')}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
