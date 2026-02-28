import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Pause, Play, Plus, Radio, Tag, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useLoadingOverlay } from '../components/LoadingOverlay';
import { api } from '../lib/api';
import { useWebSocket } from '../lib/useWebSocket';

interface Agent {
  id: string;
  name: string;
  status: string;
  packPath: string;
  model: string | null;
  agentVersion?: string | null;
  containerId: string | null;
  token: string;
  tags: string[];
  createdAt: string;
}

function isOlderVersion(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [base = '', post] = v.split('.post');
    const parts = base.split('.').map(Number);
    parts.push(post !== undefined ? Number(post) : -1);
    return parts;
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

const statusColors: Record<string, string> = {
  running: 'bg-green-100 text-green-800',
  paused: 'bg-neutral-100 text-neutral-800',
  starting: 'bg-amber-100 text-amber-800',
  stopped: 'bg-red-100 text-red-800',
};

function AgentMeta({ agentId }: { agentId: string }) {
  const { data: identity } = useQuery({
    queryKey: ['agent-identity', agentId],
    queryFn: () => api.getAgentIdentity(agentId),
    retry: false,
    staleTime: 60_000,
  });
  const { data: skillsData } = useQuery({
    queryKey: ['agent-skills', agentId],
    queryFn: () => api.getAgentSkills(agentId),
    retry: false,
    staleTime: 60_000,
  });

  if (!identity && !skillsData) return null;

  const skillCount = skillsData?.skills?.filter((s) => s.available).length ?? 0;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {identity &&
        (['hasSoul', 'hasMemory', 'hasStyle', 'hasAgents'] as const).map((key) => (
          <span
            key={key}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${identity[key] ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}
          >
            {key.replace('has', '').toLowerCase()}
          </span>
        ))}
      {skillsData && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-neutral-100 text-neutral-500">
          {skillCount} skill{skillCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function AgentUsage({ agentId }: { agentId: string }) {
  const { data } = useQuery({
    queryKey: ['agent-usage', agentId],
    queryFn: () => api.getAgentUsage(agentId),
    retry: false,
    staleTime: 60_000,
  });

  return (
    <div className="flex items-center gap-2 text-[10px] text-neutral-400 font-mono ml-auto">
      {data && data.totalCost != null && (
        <span>
          ${data.totalCost.toFixed(4)} · {data.requests} req
        </span>
      )}
    </div>
  );
}

function AgentVersion({ agentId }: { agentId: string }) {
  const { data } = useQuery({
    queryKey: ['agent-health', agentId],
    queryFn: () => api.getAgentHealth(agentId),
    retry: false,
    staleTime: 60_000,
  });

  if (!data?.version) return null;
  return <span className="text-[10px] text-neutral-400 font-mono">v{data.version}</span>;
}

function ChannelBadge({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [allowedUsers, setAllowedUsers] = useState('');
  const [notificationUserId, setNotificationUserId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['agent-channels', agentId],
    queryFn: () => api.getAgentChannels(agentId),
    retry: false,
    staleTime: 30_000,
  });

  const channels = data?.channels ?? [];
  const hasChannel = channels.length > 0;

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
      toast.success('Channel deployed');
      setOpen(false);
      setBotToken('');
      setAllowedUsers('');
      setNotificationUserId('');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Deploy failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (channelId: string) => api.deleteChannel(agentId, channelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-channels', agentId] });
      toast.success('Channel removed');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    },
  });

  if (isLoading) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`p-1.5 rounded hover:bg-neutral-100 transition-colors ${hasChannel ? 'text-green-500 hover:text-green-700' : 'text-red-400 hover:text-red-600'}`}
        title={hasChannel ? 'Channel configured' : 'No channel — click to configure'}
      >
        <Radio className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Radio className="w-4 h-4" />
                Channel
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-neutral-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4">
              {hasChannel ? (
                <div className="space-y-3">
                  {channels.map((ch) => (
                    <div
                      key={ch.id}
                      className="flex items-center justify-between p-3 bg-neutral-50 rounded-md border border-neutral-200"
                    >
                      <div>
                        <p className="text-sm font-medium capitalize">{ch.type}</p>
                        <p
                          className={`text-xs mt-0.5 ${ch.status === 'running' ? 'text-green-600' : 'text-red-500'}`}
                        >
                          {ch.status}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(ch.id)}
                        disabled={deleteMutation.isPending}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                        title="Remove channel"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-neutral-500 mb-3">
                    Connect a Telegram bot to this agent.
                  </p>
                  <div>
                    <label
                      htmlFor="bot-token"
                      className="block text-xs font-medium text-neutral-700 mb-1"
                    >
                      Bot Token <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="bot-token"
                      type="password"
                      value={botToken}
                      onChange={(e) => setBotToken(e.target.value)}
                      placeholder="123456:ABC..."
                      className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 font-mono"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="allowed-users"
                      className="block text-xs font-medium text-neutral-700 mb-1"
                    >
                      Allowed Users <span className="text-neutral-400">(optional)</span>
                    </label>
                    <input
                      id="allowed-users"
                      type="text"
                      value={allowedUsers}
                      onChange={(e) => setAllowedUsers(e.target.value)}
                      placeholder="user1,user2"
                      className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="notification-user-id"
                      className="block text-xs font-medium text-neutral-700 mb-1"
                    >
                      Notification User ID <span className="text-neutral-400">(optional)</span>
                    </label>
                    <input
                      id="notification-user-id"
                      type="text"
                      value={notificationUserId}
                      onChange={(e) => setNotificationUserId(e.target.value)}
                      placeholder="123456789"
                      className="w-full px-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => deployMutation.mutate()}
                      disabled={!botToken.trim() || deployMutation.isPending}
                      className="px-3 py-1.5 text-sm bg-neutral-900 text-white rounded-md hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2"
                    >
                      {deployMutation.isPending && (
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      )}
                      Deploy
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overlay = useLoadingOverlay();
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [agentName, setAgentName] = useState('');
  const [agentModel, setAgentModel] = useState('');
  const [packFile, setPackFile] = useState<File | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.getAgents(),
  });

  const { subscribe, unsubscribe } = useWebSocket({
    onStatusChange: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const uploadPackMutation = useMutation({
    mutationFn: api.uploadPack,
    onMutate: () => overlay.show(t('dashboard.deploying')),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['packs'] });
      // After upload, immediately deploy with the new pack name
      createAgentMutation.mutate({
        name: agentName,
        packPath: data.packName,
        model: agentModel || undefined,
      });
    },
    onError: (err) => {
      overlay.hide();
      toast.error(err instanceof Error ? err.message : t('dashboard.uploadError'));
    },
  });

  const createAgentMutation = useMutation({
    mutationFn: (data: { name: string; packPath: string; model?: string }) => api.createAgent(data),
    onMutate: () => overlay.show(t('dashboard.deploying')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setIsDeployModalOpen(false);
      setAgentName('');
      setAgentModel('');
      setPackFile(null);
      toast.success(t('dashboard.agentCreated'));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('dashboard.createError'));
    },
    onSettled: () => overlay.hide(),
  });

  useEffect(() => {
    if (data?.agents) {
      for (const agent of data.agents) {
        if (agent.status === 'running') {
          subscribe(agent.id);
        }
      }
    }

    return () => {
      if (data?.agents) {
        for (const agent of data.agents) {
          unsubscribe(agent.id);
        }
      }
    };
  }, [data?.agents, subscribe, unsubscribe]);

  const pauseMutation = useMutation({
    mutationFn: (id: string) => api.pauseAgent(id),
    onMutate: () => overlay.show(t('dashboard.pausing')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(t('dashboard.agentPaused'));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('dashboard.error'));
    },
    onSettled: () => overlay.hide(),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => api.resumeAgent(id),
    onMutate: () => overlay.show(t('dashboard.resuming')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(t('dashboard.agentResumed'));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('dashboard.error'));
    },
    onSettled: () => overlay.hide(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteAgent(id),
    onMutate: () => overlay.show(t('dashboard.deleting')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(t('dashboard.agentDeleted'));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('dashboard.error'));
    },
    onSettled: () => overlay.hide(),
  });

  const upgradeMutation = useMutation({
    mutationFn: (id: string) => api.upgradeAgent(id),
    onMutate: () => overlay.show(t('dashboard.upgrading')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(t('dashboard.agentUpgraded'));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('dashboard.error'));
    },
    onSettled: () => overlay.hide(),
  });

  const updateTagsMutation = useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) => api.updateAgent(id, { tags }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('dashboard.error'));
    },
  });

  // Per-agent tag input state
  const [addingTagFor, setAddingTagFor] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Per-agent model editing state
  const [editingModelFor, setEditingModelFor] = useState<string | null>(null);
  const [modelInput, setModelInput] = useState('');

  const updateModelMutation = useMutation({
    mutationFn: ({ id, model }: { id: string; model: string }) => api.updateAgent(id, { model }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t('dashboard.error'));
    },
  });

  const handleSaveModel = (agent: Agent) => {
    const trimmed = modelInput.trim();
    if (trimmed && trimmed !== agent.model) {
      updateModelMutation.mutate({ id: agent.id, model: trimmed });
    }
    setEditingModelFor(null);
    setModelInput('');
  };

  useEffect(() => {
    if (addingTagFor) tagInputRef.current?.focus();
  }, [addingTagFor]);

  const handleAddTag = (agent: Agent) => {
    const value = tagInput.trim().toLowerCase();
    if (!value || agent.tags.includes(value)) {
      setAddingTagFor(null);
      setTagInput('');
      return;
    }
    updateTagsMutation.mutate({ id: agent.id, tags: [...agent.tags, value] });
    setAddingTagFor(null);
    setTagInput('');
  };

  const handleRemoveTag = (agent: Agent, tag: string) => {
    updateTagsMutation.mutate({ id: agent.id, tags: agent.tags.filter((t) => t !== tag) });
  };

  const handleDeploy = () => {
    if (!agentName.trim()) {
      toast.error(t('dashboard.fillAllFields'));
      return;
    }

    if (packFile) {
      uploadPackMutation.mutate(packFile);
    } else {
      createAgentMutation.mutate({
        name: agentName,
        packPath: 'default',
        model: agentModel || undefined,
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file?.name.endsWith('.zip')) {
      setPackFile(file);
    } else {
      toast.error(t('dashboard.invalidZip'));
    }
  };

  const agentImageVersion = data?.agentImageVersion ?? null;
  const agents: Agent[] = (data?.agents || []).map((a) => ({ ...a, tags: a.tags ?? [] }));

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <h1 className="text-2xl font-bold text-neutral-900">{t('dashboard.title')}</h1>
        </div>
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-neutral-200 rounded-md" />
          <div className="h-32 bg-neutral-200 rounded-md" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-800">
          {t('dashboard.errorLoading')}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{t('dashboard.title')}</h1>
        <button
          type="button"
          onClick={() => setIsDeployModalOpen(true)}
          className="bg-neutral-900 text-white px-4 py-2 rounded-md hover:bg-neutral-800 whitespace-nowrap text-sm flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t('dashboard.deployAgent')}
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="bg-paper-100 border border-dashed border-neutral-300 rounded-md p-12 text-center">
          <p className="text-neutral-600">{t('dashboard.noAgents')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className="bg-paper-100 border border-neutral-200 rounded-md p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-neutral-900">{agent.name}</h3>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        statusColors[agent.status] || 'bg-neutral-100 text-neutral-800'
                      }`}
                    >
                      {t(`dashboard.status.${agent.status}`)}
                    </span>
                    {editingModelFor === agent.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="text"
                          value={modelInput}
                          onChange={(e) => setModelInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveModel(agent);
                            if (e.key === 'Escape') {
                              setEditingModelFor(null);
                              setModelInput('');
                            }
                          }}
                          onBlur={() => handleSaveModel(agent)}
                          placeholder="provider/model-name"
                          className="px-2 py-0.5 text-xs border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-neutral-400 font-mono w-44"
                        />
                        <p className="text-[10px] text-amber-600">
                          {t('dashboard.modelRestartWarning')}
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingModelFor(agent.id);
                          setModelInput(agent.model ?? '');
                        }}
                        className="text-xs text-neutral-400 hover:text-neutral-600 font-mono truncate max-w-[160px] text-left"
                        title={t('dashboard.changeModel')}
                      >
                        {agent.model ?? '—'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <ChannelBadge agentId={agent.id} />
                  {agent.agentVersion &&
                    agentImageVersion &&
                    isOlderVersion(agent.agentVersion, agentImageVersion) && (
                      <button
                        type="button"
                        onClick={() => upgradeMutation.mutate(agent.id)}
                        disabled={upgradeMutation.isPending}
                        className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded"
                        title={`Update available: ${agentImageVersion}`}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                    )}
                  {agent.status === 'running' ? (
                    <button
                      type="button"
                      onClick={() => pauseMutation.mutate(agent.id)}
                      disabled={pauseMutation.isPending}
                      className="p-1.5 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded"
                      title={t('dashboard.pause')}
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                  ) : agent.status === 'paused' || agent.status === 'stopped' ? (
                    <button
                      type="button"
                      onClick={() => resumeMutation.mutate(agent.id)}
                      disabled={resumeMutation.isPending}
                      className="p-1.5 text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200 rounded"
                      title={t('dashboard.resume')}
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAgentToDelete(agent)}
                    disabled={deleteMutation.isPending}
                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                    title={t('dashboard.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap items-center gap-1 mt-3">
                {agent.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleRemoveTag(agent, tag)}
                    className="group flex items-center gap-1 px-2 py-0.5 text-xs bg-neutral-100 text-neutral-600 rounded-full hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                    <X className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
                {addingTagFor === agent.id ? (
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddTag(agent);
                      if (e.key === 'Escape') {
                        setAddingTagFor(null);
                        setTagInput('');
                      }
                    }}
                    onBlur={() => handleAddTag(agent)}
                    placeholder={t('dashboard.tagPlaceholder')}
                    className="px-2 py-0.5 text-xs border border-neutral-300 rounded-full focus:outline-none focus:ring-1 focus:ring-neutral-400 w-24"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingTagFor(agent.id)}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs text-neutral-400 hover:text-neutral-600 rounded-full hover:bg-neutral-100 transition-colors"
                    title={t('dashboard.addTag')}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="mt-2 flex items-center justify-between">
                <AgentMeta agentId={agent.id} />
                <AgentUsage agentId={agent.id} />
              </div>

              <div className="mt-3 flex items-center justify-between">
                <Link
                  to={`/agents/${agent.id}`}
                  className="text-xs text-neutral-500 hover:text-neutral-700"
                >
                  {t('agents.viewWorkspace')} →
                </Link>
                <AgentVersion agentId={agent.id} />
              </div>
            </div>
          ))}
        </div>
      )}

      {agentToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">{t('dashboard.delete')}</h2>
            <p className="text-sm text-neutral-600 mb-6">{t('dashboard.confirmDelete')}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAgentToDelete(null)}
                className="px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteMutation.mutate(agentToDelete.id);
                  setAgentToDelete(null);
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                {t('dashboard.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeployModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">{t('dashboard.deployAgent')}</h2>
              <button
                type="button"
                onClick={() => {
                  setIsDeployModalOpen(false);
                  setPackFile(null);
                  setAgentName('');
                  setAgentModel('');
                }}
                className="p-1 hover:bg-neutral-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label
                  htmlFor="agentName"
                  className="block text-sm font-medium text-neutral-700 mb-1"
                >
                  {t('dashboard.agentName')}
                </label>
                <input
                  id="agentName"
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleDeploy();
                  }}
                  placeholder={t('dashboard.agentNamePlaceholder')}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </div>

              <div>
                <label
                  htmlFor="agentModel"
                  className="block text-sm font-medium text-neutral-700 mb-1"
                >
                  {t('dashboard.modelOverride')}
                </label>
                <input
                  id="agentModel"
                  type="text"
                  value={agentModel}
                  onChange={(e) => setAgentModel(e.target.value)}
                  placeholder={t('dashboard.modelOverridePlaceholder')}
                  className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900"
                />
              </div>

              <div>
                <span className="block text-sm font-medium text-neutral-700 mb-1">
                  {t('dashboard.customPack')}
                </span>
                <label
                  htmlFor="packFile"
                  className="flex items-center justify-center gap-2 px-4 py-2 border border-dashed border-neutral-300 rounded-md cursor-pointer hover:bg-neutral-50"
                >
                  <Upload className="w-4 h-4 text-neutral-400" />
                  <span className="text-sm text-neutral-600">
                    {packFile ? packFile.name : t('dashboard.uploadZip')}
                  </span>
                  <input
                    id="packFile"
                    type="file"
                    accept=".zip"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
                {!packFile && (
                  <p className="mt-1.5 text-xs text-neutral-400">
                    {t('dashboard.defaultPackHint')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t">
              <button
                type="button"
                onClick={() => {
                  setIsDeployModalOpen(false);
                  setPackFile(null);
                  setAgentName('');
                  setAgentModel('');
                }}
                className="px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeploy}
                disabled={createAgentMutation.isPending || uploadPackMutation.isPending}
                className="px-4 py-2 text-sm bg-neutral-900 text-white rounded-md hover:bg-neutral-800 disabled:opacity-50 flex items-center gap-2"
              >
                {(createAgentMutation.isPending || uploadPackMutation.isPending) && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {t('dashboard.deploy')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
