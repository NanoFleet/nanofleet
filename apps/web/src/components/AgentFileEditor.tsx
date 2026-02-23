import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '../lib/api';

interface Props {
  agentId: string;
  filename: string;
  onClose: () => void;
}

export function AgentFileEditor({ agentId, filename, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [localContent, setLocalContent] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-file', agentId, filename],
    queryFn: () => api.getAgentFile(agentId, filename),
    staleTime: 0,
  });

  const content = localContent ?? data?.content ?? '';

  const saveMutation = useMutation({
    mutationFn: () => api.saveAgentFile(agentId, filename, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-file', agentId, filename] });
      setLocalContent(null);
      toast.success(t('agents.workspace.saved'));
    },
    onError: () => {
      toast.error(t('agents.workspace.saveError'));
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200 bg-paper-100">
        <span className="text-sm font-mono text-neutral-700">{filename}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="px-3 py-1.5 text-sm bg-neutral-900 text-white rounded hover:bg-neutral-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? t('agents.workspace.saving') : t('agents.workspace.save')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-neutral-200 rounded text-neutral-500"
            title={t('agents.workspace.backToChat')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="p-6 animate-pulse space-y-3">
            <div className="h-4 w-48 bg-neutral-200 rounded" />
            <div className="h-4 w-64 bg-neutral-200 rounded" />
            <div className="h-4 w-40 bg-neutral-200 rounded" />
          </div>
        ) : (
          <textarea
            className="w-full h-full p-4 font-mono text-sm text-neutral-900 bg-white resize-none focus:outline-none"
            value={content}
            onChange={(e) => setLocalContent(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
