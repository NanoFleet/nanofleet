import { Key, Lock, Trash2, User } from 'lucide-react';
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

export function SettingsPage({ username: initialUsername }: SettingsPageProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState(initialUsername);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
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

          {/* Keys list */}
          <div className="space-y-2 mb-5">
            {apiKeys.length === 0 ? (
              <p className="text-xs text-neutral-500 py-2">{t('settings.noApiKeys')}</p>
            ) : (
              apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between px-3 py-2 bg-white border border-neutral-200 rounded-md"
                >
                  <div>
                    <p className="text-sm font-medium text-neutral-900 font-mono">{key.keyName}</p>
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
              ))
            )}
          </div>

          {/* Add key form */}
          <form onSubmit={handleAddApiKey} className="space-y-3 pt-4 border-t border-neutral-200">
            <div>
              <label htmlFor="keyName" className="block text-xs text-neutral-500 mb-1">
                {t('settings.keyName')}
              </label>
              <input
                id="keyName"
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="openai"
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
