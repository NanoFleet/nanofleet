import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowUp,
  CheckCircle2,
  CheckSquare,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { useLoadingOverlay } from '../components/LoadingOverlay';
import { api } from '../lib/api';

interface Plugin {
  id: string;
  name: string;
  version: string;
  image: string;
  status: string;
  manifestUrl: string;
  sidebarSlot: { icon: string; label: string; route: string } | null;
  tools: string[];
  remoteVersion: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Official plugins catalogue
// ---------------------------------------------------------------------------

interface OfficialPlugin {
  name: string;
  description: string;
  icon: React.ElementType;
  // TODO: replace with the real hosted manifest URL once available
  manifestUrl: string;
}

const OFFICIAL_PLUGINS: OfficialPlugin[] = [
  {
    name: 'nanofleet-tasks',
    description: 'Kanban task manager for human-agent collaboration',
    icon: CheckSquare,
    manifestUrl: 'https://raw.githubusercontent.com/NanoFleet/nanofleet-tasks/main/manifest.json',
  },
  {
    name: 'nanofleet-vault',
    description: 'Secret manager with per-agent access control',
    icon: KeyRound,
    manifestUrl: 'https://raw.githubusercontent.com/NanoFleet/nanofleet-vault/main/manifest.json',
  },
];

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PluginsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const overlay = useLoadingOverlay();
  const [tab, setTab] = useState<'installed' | 'official'>('installed');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [pluginToDelete, setPluginToDelete] = useState<Plugin | null>(null);
  const [manifestUrl, setManifestUrl] = useState('');
  const [installing, setInstalling] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.getPlugins(),
  });

  const plugins: Plugin[] = data?.plugins ?? [];

  const handleInstall = async () => {
    if (!manifestUrl.trim()) return;
    setInstalling(true);
    setShowInstallModal(false);
    overlay.show(t('plugins.installing'));
    try {
      await api.installPlugin(manifestUrl.trim());
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(t('plugins.installSuccess'));
      setManifestUrl('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('plugins.installError'));
      setShowInstallModal(true);
    } finally {
      setInstalling(false);
      overlay.hide();
    }
  };

  const handleInstallOfficial = async (url: string) => {
    overlay.show(t('plugins.installing'));
    try {
      await api.installPlugin(url);
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(t('plugins.installSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('plugins.installError'));
    } finally {
      overlay.hide();
    }
  };

  const handleDelete = async (plugin: Plugin) => {
    overlay.show(t('plugins.deleting'));
    try {
      await api.deletePlugin(plugin.id);
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(t('plugins.deleted'));
    } catch {
      toast.error(t('plugins.deleteError'));
    } finally {
      overlay.hide();
    }
  };

  const handleRestart = async (plugin: Plugin) => {
    overlay.show(t('plugins.restarting'));
    try {
      await api.restartPlugin(plugin.id);
      await queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(t('plugins.restarted'));
    } catch {
      toast.error(t('plugins.restartError'));
    } finally {
      overlay.hide();
    }
  };

  const upgradeMutation = useMutation({
    mutationFn: (id: string) => api.upgradePlugin(id),
    onMutate: () => overlay.show(t('plugins.upgrading')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success(t('plugins.upgraded'));
    },
    onError: () => toast.error(t('plugins.upgradeError')),
    onSettled: () => overlay.hide(),
  });

  const installedNames = new Set(plugins.map((p) => p.name));

  return (
    <div className="p-6 h-full overflow-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-neutral-900">{t('plugins.title')}</h1>
          <p className="text-sm text-neutral-500 mt-0.5">{t('plugins.subtitle')}</p>
        </div>
        {tab === 'installed' && (
          <button
            type="button"
            onClick={() => setShowInstallModal(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-neutral-900 text-white rounded hover:bg-neutral-700 shrink-0"
          >
            <Plus className="w-4 h-4" />
            {t('plugins.install')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-neutral-200">
        {(['installed', 'official'] as const).map((t_) => (
          <button
            key={t_}
            type="button"
            onClick={() => setTab(t_)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t_
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t_ === 'installed' ? t('plugins.tabInstalled') : t('plugins.tabOfficial')}
          </button>
        ))}
      </div>

      {/* ── Installed tab ── */}
      {tab === 'installed' && (
        <>
          {isLoading && (
            <div className="animate-pulse space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-20 bg-neutral-200 rounded-lg" />
              ))}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 text-red-800 text-sm">
              {t('plugins.errorLoading')}
            </div>
          )}

          {!isLoading && !error && plugins.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
              <Plug className="w-10 h-10 mb-3" />
              <p className="text-sm">{t('plugins.none')}</p>
            </div>
          )}

          {!isLoading && plugins.length > 0 && (
            <div className="space-y-3">
              {plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className="bg-white border border-neutral-200 rounded-lg p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-neutral-900 text-sm">{plugin.name}</span>
                      <span className="text-xs text-neutral-400">v{plugin.version}</span>
                      <StatusBadge status={plugin.status} />
                    </div>
                    <p className="text-xs text-neutral-500 truncate mb-2">{plugin.image}</p>
                    {plugin.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {plugin.tools.map((tool) => (
                          <span
                            key={tool}
                            className="text-xs bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                    {plugin.tools.length === 0 && (
                      <span className="text-xs text-neutral-400">{t('plugins.noTools')}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {plugin.remoteVersion && plugin.remoteVersion !== plugin.version && (
                      <button
                        type="button"
                        onClick={() => upgradeMutation.mutate(plugin.id)}
                        disabled={upgradeMutation.isPending}
                        className="p-1.5 rounded text-amber-500 hover:text-amber-700 hover:bg-amber-50"
                        title={`Update available: ${plugin.remoteVersion}`}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRestart(plugin)}
                      className="p-1.5 rounded text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
                      title={t('plugins.restart')}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPluginToDelete(plugin)}
                      className="p-1.5 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50"
                      title={t('plugins.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Official tab ── */}
      {tab === 'official' && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500 mb-4">{t('plugins.officialDescription')}</p>
          {OFFICIAL_PLUGINS.map((op) => {
            const isInstalled = installedNames.has(op.name);
            return (
              <div
                key={op.name}
                className="bg-white border border-neutral-200 rounded-lg p-4 flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0">
                    <op.icon className="w-5 h-5 text-neutral-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900 text-sm">{op.name}</p>
                    <p className="text-xs text-neutral-500">{op.description}</p>
                  </div>
                </div>

                {isInstalled ? (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-400 bg-neutral-100 border border-neutral-200 rounded cursor-default shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {t('plugins.officialAlreadyInstalled')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleInstallOfficial(op.manifestUrl)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white rounded hover:bg-neutral-700 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('plugins.officialInstall')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation modal */}
      {pluginToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-neutral-900 mb-2">{t('plugins.delete')}</h2>
            <p className="text-sm text-neutral-600 mb-6">
              {t('plugins.confirmDelete', { name: pluginToDelete.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPluginToDelete(null)}
                className="px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 rounded"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDelete(pluginToDelete);
                  setPluginToDelete(null);
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('plugins.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install modal */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-neutral-900 mb-4">
              {t('plugins.installTitle')}
            </h2>

            <label
              htmlFor="manifest-url"
              className="block text-sm font-medium text-neutral-700 mb-1"
            >
              {t('plugins.manifestUrl')}
            </label>
            <input
              id="manifest-url"
              type="url"
              value={manifestUrl}
              onChange={(e) => setManifestUrl(e.target.value)}
              placeholder="https://example.com/my-plugin/manifest.json"
              className="w-full border border-neutral-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 mb-4"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInstall();
              }}
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowInstallModal(false);
                  setManifestUrl('');
                }}
                className="px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 rounded"
                disabled={installing}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleInstall}
                disabled={installing || !manifestUrl.trim()}
                className="px-4 py-2 text-sm bg-neutral-900 text-white rounded hover:bg-neutral-700 disabled:opacity-50"
              >
                {installing ? t('plugins.installing') : t('plugins.install')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
