import { Key, Lock, Save, Trash2, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { api } from '../lib/api';

interface ApiKey {
  id: string;
  keyName: string;
  createdAt: string;
}

interface SettingsPageProps {
  username: string;
}

interface PresetSlot {
  name: string;
  placeholder: string;
  tooltip?: string;
}

const PRESET_SLOTS: PresetSlot[] = [
  { name: 'anthropic', placeholder: 'sk-ant-...' },
  { name: 'openai', placeholder: 'sk-...' },
  { name: 'gemini', placeholder: 'AIza...' },
];

export function SettingsPage({ username: initialUsername }: SettingsPageProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(initialUsername);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  // Per-slot input values for preset slots
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [slotSaving, setSlotSaving] = useState<Record<string, boolean>>({});
  // Custom key form
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    try {
      const data = await api.getApiKeys();
      setApiKeys(data.keys);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    }
  };

  const isConfigured = (name: string) => apiKeys.some((k) => k.keyName === name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword && newPassword !== confirmPassword) {
      toast.error(t('settings.passwordMismatch'));
      return;
    }

    setIsLoading(true);

    try {
      await api.updateProfile({
        username: username !== initialUsername ? username : undefined,
        password: newPassword || undefined,
        currentPassword: newPassword ? currentPassword : undefined,
      });
      toast.success(t('settings.updateSuccess'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.updateError'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSlot = async (name: string) => {
    const value = slotValues[name]?.trim();
    if (!value) {
      toast.error(t('settings.apiKeyNameAndValueRequired'));
      return;
    }

    setSlotSaving((prev) => ({ ...prev, [name]: true }));
    try {
      await api.saveApiKey(name, value);
      toast.success(t('settings.apiKeySaved'));
      setSlotValues((prev) => ({ ...prev, [name]: '' }));
      loadApiKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.apiKeyError'));
    } finally {
      setSlotSaving((prev) => ({ ...prev, [name]: false }));
    }
  };

  const handleAddApiKey = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newKeyName || !newKeyValue) {
      toast.error(t('settings.apiKeyNameAndValueRequired'));
      return;
    }

    setIsLoadingKeys(true);

    try {
      await api.saveApiKey(newKeyName, newKeyValue);
      toast.success(t('settings.apiKeySaved'));
      setNewKeyName('');
      setNewKeyValue('');
      loadApiKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.apiKeyError'));
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const handleDeleteApiKey = async (keyName: string) => {
    if (!confirm(t('settings.confirmDeleteApiKey'))) return;

    try {
      await api.deleteApiKey(keyName);
      toast.success(t('settings.apiKeyDeleted'));
      loadApiKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.apiKeyError'));
    }
  };

  // Custom keys = configured keys that are not preset slots
  const presetNames = PRESET_SLOTS.map((s) => s.name);
  const customKeys = apiKeys.filter((k) => !presetNames.includes(k.keyName));

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">{t('settings.title')}</h1>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-4xl">
        {/* Account card */}
        <div className="bg-paper-100 border border-neutral-200 rounded-md p-5">
          <div className="flex items-center gap-2 mb-5">
            <User className="w-4 h-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
              {t('settings.username')}
            </h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs text-neutral-500 mb-1">
                {t('settings.username')}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
              />
            </div>

            <div className="pt-3 border-t border-neutral-200">
              <div className="flex items-center gap-2 mb-3">
                <Lock className="w-3.5 h-3.5 text-neutral-500" />
                <span className="text-xs font-semibold text-neutral-900 uppercase tracking-wide">
                  {t('settings.changePassword')}
                </span>
              </div>
              <div className="space-y-3">
                <div>
                  <label htmlFor="currentPassword" className="block text-xs text-neutral-500 mb-1">
                    {t('settings.currentPassword')}
                  </label>
                  <input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
                  />
                </div>
                <div>
                  <label htmlFor="newPassword" className="block text-xs text-neutral-500 mb-1">
                    {t('settings.newPassword')}
                  </label>
                  <input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
                  />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="block text-xs text-neutral-500 mb-1">
                    {t('settings.confirmPassword')}
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-neutral-900 text-white text-sm py-2 px-4 rounded-md hover:bg-neutral-800 disabled:opacity-50 transition-colors"
            >
              {isLoading ? '...' : t('settings.save')}
            </button>
          </form>
        </div>

        {/* API Keys card */}
        <div className="bg-paper-100 border border-neutral-200 rounded-md p-5">
          <div className="flex items-center gap-2 mb-5">
            <Key className="w-4 h-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">
              {t('settings.apiKeys')}
            </h2>
          </div>

          {/* Preset slots */}
          <div className="space-y-3 mb-5">
            {PRESET_SLOTS.map((slot) => {
              const configured = isConfigured(slot.name);
              return (
                <div key={slot.name}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-medium text-neutral-700 font-mono">
                      {slot.name}
                    </span>
                    {configured && (
                      <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                        {t('settings.configured')}
                      </span>
                    )}
                    {slot.tooltip && (
                      <div className="group relative ml-0.5">
                        <Info className="w-3 h-3 text-neutral-400 cursor-help" />
                        <div className="absolute left-0 bottom-full mb-1.5 w-56 bg-neutral-800 text-white text-xs rounded px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          {slot.tooltip}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={slotValues[slot.name] ?? ''}
                      onChange={(e) =>
                        setSlotValues((prev) => ({ ...prev, [slot.name]: e.target.value }))
                      }
                      placeholder={configured ? '••••••••••••••••' : slot.placeholder}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveSlot(slot.name);
                      }}
                      className="flex-1 px-3 py-1.5 text-sm bg-white border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveSlot(slot.name)}
                      disabled={slotSaving[slot.name] || !slotValues[slot.name]?.trim()}
                      className="px-2.5 py-1.5 bg-neutral-900 text-white text-xs rounded-md hover:bg-neutral-800 disabled:opacity-40 transition-colors flex items-center"
                      title={t('settings.save')}
                    >
                      <Save className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteApiKey(slot.name)}
                      disabled={!configured}
                      className="px-2.5 py-1.5 text-neutral-400 hover:text-red-600 border border-neutral-200 bg-white rounded-md transition-colors disabled:opacity-0 disabled:pointer-events-none"
                      title={t('settings.delete')}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom keys */}
          {customKeys.length > 0 && (
            <div className="mb-4 pt-4 border-t border-neutral-200">
              <p className="text-xs text-neutral-400 uppercase tracking-wide mb-2">
                {t('settings.otherKeys')}
              </p>
              <div className="space-y-2">
                {customKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between px-3 py-2 bg-white border border-neutral-200 rounded-md"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-900 font-mono">
                        {key.keyName}
                      </p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteApiKey(key.keyName)}
                      className="text-neutral-400 hover:text-red-600 transition-colors p-1 rounded"
                      title={t('settings.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom key form */}
          <form onSubmit={handleAddApiKey} className="space-y-3 pt-4 border-t border-neutral-200">
            <p className="text-xs text-neutral-400 uppercase tracking-wide">
              {t('settings.customKey')}
            </p>
            <div>
              <label htmlFor="keyName" className="block text-xs text-neutral-500 mb-1">
                {t('settings.keyName')}
              </label>
              <input
                id="keyName"
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="my-provider"
                className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 font-mono"
              />
            </div>
            <div>
              <label htmlFor="keyValue" className="block text-xs text-neutral-500 mb-1">
                {t('settings.keyValue')}
              </label>
              <input
                id="keyValue"
                type="password"
                value={newKeyValue}
                onChange={(e) => setNewKeyValue(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3 py-2 text-sm bg-white border border-neutral-300 rounded-md focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={isLoadingKeys}
              className="w-full bg-neutral-900 text-white text-sm py-2 px-4 rounded-md hover:bg-neutral-800 disabled:opacity-50 transition-colors"
            >
              {isLoadingKeys ? '...' : t('settings.addApiKey')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
