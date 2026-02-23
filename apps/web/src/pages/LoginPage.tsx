import { LoginPayloadSchema } from '@nanofleet/shared';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const parsed = LoginPayloadSchema.safeParse({ username, password, totp });
    if (!parsed.success) {
      toast.error(t('auth.validationError'));
      setIsLoading(false);
      return;
    }

    try {
      const { accessToken } = await api.login(username, password, totp);
      login(accessToken);
      navigate('/');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-neutral-900">{t('common.appName')}</h1>
          <p className="text-neutral-600 mt-2">AI Agent Orchestrator</p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-md p-8">
          <h2 className="text-xl font-semibold text-neutral-900 mb-6">{t('auth.login')}</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-neutral-700 mb-1">
                {t('auth.username')}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('auth.usernamePlaceholder')}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-neutral-700 mb-1">
                {t('auth.password')}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label htmlFor="totp" className="block text-sm font-medium text-neutral-700 mb-1">
                {t('auth.totp')}
              </label>
              <input
                id="totp"
                type="text"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('auth.totpPlaceholder')}
                maxLength={6}
                className="w-full px-3 py-2 border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-neutral-900 text-white py-2 px-4 rounded-md hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 disabled:opacity-50"
            >
              {isLoading ? '...' : t('auth.loginButton')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
