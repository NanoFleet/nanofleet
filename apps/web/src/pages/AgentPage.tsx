import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
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
          <div className="w-64 border-r border-neutral-200 p-3 flex flex-col overflow-hidden">
            <AgentFileExplorer
              agentId={agent.id}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              onFileDeleted={(f) => {
                if (selectedFile === f) setSelectedFile(null);
              }}
            />
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
