import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  Radio,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { useLoadingOverlay } from '../components/LoadingOverlay';
import { api } from '../lib/api';

interface Channel {
  id: string;
  agentId: string;
  agentName: string;
  type: string;
  image: string;
  containerName: string;
  status: string;
  version: string | null;
  remoteVersion: string | null;
  envVars: Record<string, string> | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" />
        Running
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
        <XCircle className="w-3 h-3" />
        Error
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-neutral-600 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded-full">
      <AlertCircle className="w-3 h-3" />
      Stopped
    </span>
  );
}

export function ChannelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overlay = useLoadingOverlay();
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.getChannels(),
  });

  const channels: Channel[] = data?.channels ?? [];

  const upgradeMutation = useMutation({
    mutationFn: (id: string) => api.upgradeChannel(id),
    onMutate: () => overlay.show(t('channels.upgrading')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
      toast.success(t('channels.upgraded'));
    },
    onError: () => toast.error(t('channels.upgradeError')),
    onSettled: () => overlay.hide(),
  });

  const handleDelete = async (channel: Channel) => {
    overlay.show(t('channels.deleting'));
    try {
      await api.deleteChannel(channel.agentId, channel.id);
      await queryClient.invalidateQueries({ queryKey: ['channels'] });
      toast.success(t('channels.deleted'));
    } catch {
      toast.error(t('channels.deleteError'));
    } finally {
      overlay.hide();
    }
  };

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">{t('channels.title')}</h1>
        <p className="text-sm text-neutral-500 mt-0.5">{t('channels.subtitle')}</p>
      </div>

      {isLoading && (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-neutral-200 rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-800 text-sm">
          {t('channels.errorLoading')}
        </div>
      )}

      {!isLoading && !error && channels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
          <Radio className="w-10 h-10 mb-3" />
          <p className="text-sm">{t('channels.none')}</p>
        </div>
      )}

      {!isLoading && channels.length > 0 && (
        <div className="space-y-3">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="bg-white border border-neutral-200 rounded-lg p-4 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-neutral-900 text-sm capitalize">
                    {channel.type}
                  </span>
                  {channel.version && (
                    <span className="text-xs text-neutral-400">v{channel.version}</span>
                  )}
                  <StatusBadge status={channel.status} />
                </div>
                <p className="text-xs text-neutral-500 mb-1">
                  {t('channels.agent')}:{' '}
                  <span className="font-medium text-neutral-700">{channel.agentName}</span>
                </p>
                <p className="text-xs text-neutral-400 truncate">{channel.image}</p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {channel.remoteVersion &&
                  channel.remoteVersion !== channel.version && (
                    <button
                      type="button"
                      onClick={() => upgradeMutation.mutate(channel.id)}
                      disabled={upgradeMutation.isPending}
                      className="p-1.5 rounded text-amber-500 hover:text-amber-700 hover:bg-amber-50"
                      title={`Update available: ${channel.remoteVersion}`}
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setChannelToDelete(channel)}
                  className="p-1.5 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50"
                  title={t('channels.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {channelToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">{t('channels.delete')}</h2>
            <p className="text-sm text-neutral-600 mb-6">
              {t('channels.confirmDelete', {
                type: channelToDelete.type,
                agent: channelToDelete.agentName,
              })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setChannelToDelete(null)}
                className="px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 rounded"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDelete(channelToDelete);
                  setChannelToDelete(null);
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('channels.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
