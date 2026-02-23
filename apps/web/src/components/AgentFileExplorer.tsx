import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '../lib/api';

interface Props {
  agentId: string;
  selectedFile: string | null;
  onSelectFile: (filename: string) => void;
  onFileDeleted?: (filename: string) => void;
}

export function AgentFileExplorer({ agentId, selectedFile, onSelectFile, onFileDeleted }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-files', agentId],
    queryFn: () => api.listAgentFiles(agentId),
  });

  const files = data?.files ?? [];

  const handleDelete = async (filename: string) => {
    if (!window.confirm(t('agents.workspace.confirmDelete'))) return;
    try {
      await api.deleteAgentFile(agentId, filename);
      await queryClient.invalidateQueries({ queryKey: ['agent-files', agentId] });
      onFileDeleted?.(filename);
      toast.success(t('agents.workspace.deleted'));
    } catch {
      toast.error(t('agents.workspace.deleteError'));
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      await api.uploadAgentFile(agentId, file);
      await queryClient.invalidateQueries({ queryKey: ['agent-files', agentId] });
      toast.success(t('agents.workspace.uploaded'));
    } catch {
      toast.error(t('agents.workspace.uploadError'));
    }
  };

  return (
    <div className="flex flex-col gap-2 h-full">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded w-full"
      >
        <Upload className="w-4 h-4 shrink-0" />
        {t('agents.workspace.upload')}
      </button>
      <input ref={inputRef} type="file" className="hidden" onChange={handleUpload} />

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="animate-pulse space-y-2 pt-1">
            <div className="h-4 bg-neutral-200 rounded w-3/4" />
            <div className="h-4 bg-neutral-200 rounded w-1/2" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-xs text-neutral-400 px-1">{t('agents.workspace.noFiles')}</p>
        ) : (
          <ul className="space-y-0.5">
            {files.map((file) => (
              <li key={file.name} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelectFile(file.name)}
                  className={`flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 text-sm rounded text-left ${
                    selectedFile === file.name
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                  title={file.name}
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(file.name)}
                  className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 hover:bg-neutral-100"
                  title={t('agents.workspace.confirmDelete')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
