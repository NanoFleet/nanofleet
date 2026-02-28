import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Radio,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import { AgentFileEditor } from '../components/AgentFileEditor';
import { AgentFileExplorer } from '../components/AgentFileExplorer';
import { useLoadingOverlay } from '../components/LoadingOverlay';
import { api } from '../lib/api';
import { useWebSocket } from '../lib/useWebSocket';

interface Agent {
  id: string;
  name: string;
  status: string;
  packPath: string;
  containerId: string | null;
  token: string;
  createdAt: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
};

function ChannelsSection({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [allowedUsers, setAllowedUsers] = useState('');
  const [notificationUserId, setNotificationUserId] = useState('');

  const { data } = useQuery({
    queryKey: ['agent-channels', agentId],
    queryFn: () => api.getAgentChannels(agentId),
    staleTime: 30_000,
  });

  const deployMutation = useMutation({
    mutationFn: () =>
      api.deployChannel(agentId, {
        type: 'telegram',
        botToken,
        allowedUsers: allowedUsers || undefined,
        notificationUserId: notificationUserId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-channels', agentId] });
      setIsAdding(false);
      setBotToken('');
      setAllowedUsers('');
      setNotificationUserId('');
      toast.success('Channel deployed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (channelId: string) => api.deleteChannel(agentId, channelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-channels', agentId] });
      toast.success('Channel removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const statusColor: Record<string, string> = {
    running: 'text-green-600',
    stopped: 'text-neutral-400',
    error: 'text-red-500',
  };

  return (
    <div className="mt-4 border-t border-neutral-200 pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide flex items-center gap-1.5">
          <Radio className="w-3 h-3" />
          Channels
        </span>
        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="p-1 hover:bg-neutral-100 rounded text-neutral-400 hover:text-neutral-600"
            title="Add channel"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {data?.channels.map((ch) => (
        <div key={ch.id} className="flex items-center justify-between py-1 group">
          <div>
            <span className="text-xs font-medium text-neutral-700">
              {CHANNEL_LABELS[ch.type] ?? ch.type}
            </span>
            <span
              className={`ml-1.5 text-[10px] font-mono ${statusColor[ch.status] ?? 'text-neutral-400'}`}
            >
              {ch.status}
            </span>
          </div>
          <button
            type="button"
            onClick={() => deleteMutation.mutate(ch.id)}
            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded text-red-400"
            title="Remove channel"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}

      {data?.channels.length === 0 && !isAdding && (
        <p className="text-[11px] text-neutral-400">No channels configured.</p>
      )}

      {isAdding && (
        <div className="mt-2 space-y-2">
          <p className="text-xs font-medium text-neutral-600">Telegram</p>
          <input
            type="text"
            placeholder="Bot token *"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <input
            type="text"
            placeholder="Allowed user IDs (optional)"
            value={allowedUsers}
            onChange={(e) => setAllowedUsers(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <input
            type="text"
            placeholder="Notification user ID (optional)"
            value={notificationUserId}
            onChange={(e) => setNotificationUserId(e.target.value)}
            className="w-full px-2 py-1 text-xs border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => deployMutation.mutate()}
              disabled={!botToken || deployMutation.isPending}
              className="flex-1 px-2 py-1 text-xs bg-neutral-900 text-white rounded hover:bg-neutral-700 disabled:opacity-50"
            >
              {deployMutation.isPending ? 'Deploying…' : 'Deploy'}
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-2 py-1 text-xs border border-neutral-200 rounded hover:bg-neutral-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overlay = useLoadingOverlay();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => (id ? api.getAgent(id) : Promise.reject(new Error('No ID'))),
    enabled: !!id,
  });

  const { subscribe, unsubscribe } = useWebSocket({
    onStatusChange: (agentId) => {
      if (agentId === id && id) {
        queryClient.invalidateQueries({ queryKey: ['agent', id] });
      }
    },
  });

  useEffect(() => {
    if (id) {
      subscribe(id);
    }

    return () => {
      if (id) {
        unsubscribe(id);
      }
    };
  }, [id, subscribe, unsubscribe]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 w-32 bg-neutral-200 rounded mb-4" />
          <div className="h-64 bg-neutral-200 rounded" />
        </div>
      </div>
    );
  }

  if (error || !data?.agent) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-800">
          {t('agents.errorLoading')}
        </div>
      </div>
    );
  }

  const agent: Agent = data.agent;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-neutral-200 bg-paper-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-1.5 hover:bg-neutral-200 rounded" title={t('common.back')}>
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-neutral-900">{agent.name}</h1>
              <span className="text-sm text-neutral-500">
                {t(`dashboard.status.${agent.status}`)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {agent.status === 'running' ? (
              <button
                type="button"
                onClick={async () => {
                  overlay.show(t('dashboard.pausing'));
                  try {
                    await api.pauseAgent(agent.id);
                    await queryClient.invalidateQueries({ queryKey: ['agent', id] });
                  } finally {
                    overlay.hide();
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-100 hover:bg-neutral-200 rounded"
              >
                <Pause className="w-4 h-4" />
                {t('dashboard.pause')}
              </button>
            ) : agent.status === 'paused' || agent.status === 'stopped' ? (
              <button
                type="button"
                onClick={async () => {
                  overlay.show(t('dashboard.resuming'));
                  try {
                    await api.resumeAgent(agent.id);
                    await queryClient.invalidateQueries({ queryKey: ['agent', id] });
                  } finally {
                    overlay.hide();
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-100 hover:bg-neutral-200 rounded"
              >
                <Play className="w-4 h-4" />
                {t('dashboard.resume')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — File Explorer */}
        {sidebarOpen && (
          <div className="w-64 border-r border-neutral-200 p-3 flex flex-col overflow-y-auto">
            <AgentFileExplorer
              agentId={agent.id}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              onFileDeleted={(f) => {
                if (selectedFile === f) setSelectedFile(null);
              }}
            />
            <ChannelsSection agentId={agent.id} />
          </div>
        )}

        {/* Right panel — File Editor or Chat */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center px-3 py-1.5 border-b border-neutral-200 bg-paper-100">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="p-1 hover:bg-neutral-200 rounded text-neutral-500"
              title={sidebarOpen ? 'Hide files' : 'Show files'}
            >
              {sidebarOpen ? (
                <PanelLeftClose className="w-4 h-4" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            {selectedFile ? (
              <AgentFileEditor
                agentId={agent.id}
                filename={selectedFile}
                onClose={() => setSelectedFile(null)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
                {t('agents.selectFile')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
