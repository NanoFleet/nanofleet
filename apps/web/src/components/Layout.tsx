import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  CheckSquare,
  KeyRound,
  LayoutDashboard,
  LogOut,
  type LucideIcon,
  Menu,
  MessageSquare,
  Plug,
  Settings,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  CheckSquare,
  KeyRound,
  MessageSquare,
  Plug,
};

const navItems = [
  { path: '/', label: 'dashboard.title', icon: LayoutDashboard },
  { path: '/agents', label: 'nav.agents', icon: Bot },
  { path: '/plugins', label: 'nav.plugins', icon: Plug },
];

const bottomNavItems = [{ path: '/settings', label: 'nav.settings', icon: Settings }];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
    isActive
      ? 'bg-neutral-200 font-semibold text-neutral-900'
      : 'text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900'
  }`;

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: pluginsData } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => api.getPlugins(),
    staleTime: 30_000,
  });

  const pluginNavItems = (pluginsData?.plugins ?? []).flatMap((p) => {
    if (!p.sidebarSlot || p.status !== 'running') return [];
    const { route, label, icon } = p.sidebarSlot;
    return [{ path: route, label, icon: PLUGIN_ICON_MAP[icon] ?? Plug }];
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  const sidebarContent = (
    <>
      <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-8 w-auto" />
          <span className="text-xl font-bold text-neutral-900">{t('common.appName')}</span>
        </div>
        <button
          type="button"
          onClick={closeSidebar}
          className="lg:hidden text-neutral-600 hover:text-neutral-900"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} end className={navLinkClass} onClick={closeSidebar}>
                <item.icon className="w-4 h-4" />
                {t(item.label)}
              </NavLink>
            </li>
          ))}
          {pluginNavItems.length > 0 && (
            <>
              <li className="pt-2 pb-1">
                <span className="px-3 text-xs font-medium text-neutral-400 uppercase tracking-wider">
                  {t('nav.plugins')}
                </span>
              </li>
              {pluginNavItems.map((item) => (
                <li key={item.path}>
                  <NavLink to={item.path} className={navLinkClass} onClick={closeSidebar}>
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </>
          )}
        </ul>
      </nav>

      <div className="p-4 space-y-1">
        {bottomNavItems.map((item) => (
          <NavLink key={item.path} to={item.path} className={navLinkClass} onClick={closeSidebar}>
            <item.icon className="w-4 h-4" />
            {t(item.label)}
          </NavLink>
        ))}
      </div>

      <div className="p-4 border-t border-neutral-200">
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 w-full text-left px-3 py-2 text-sm text-neutral-600 hover:text-neutral-900"
        >
          <LogOut className="w-4 h-4" />
          {t('auth.logout')}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-paper-50">
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={closeSidebar}
          onKeyDown={closeSidebar}
          role="button"
          tabIndex={0}
        />
      )}

      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-64 bg-paper-100 border-r border-neutral-200 flex-col shrink-0">
        {sidebarContent}
      </aside>

      {/* Sidebar mobile (drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-paper-100 border-r border-neutral-200 flex flex-col transition-transform duration-200 lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Workspace */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header mobile */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-paper-100 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="text-neutral-600 hover:text-neutral-900"
          >
            <Menu className="w-5 h-5" />
          </button>
          <img src="/logo.png" alt="" className="h-6 w-auto" />
          <span className="text-sm font-bold text-neutral-900">{t('common.appName')}</span>
        </header>

        <main className="flex-1 min-w-0 overflow-hidden bg-[url('/grid.svg')]">{children}</main>
      </div>
    </div>
  );
}
