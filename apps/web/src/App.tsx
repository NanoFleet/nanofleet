import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import './i18n';
import { Layout } from './components/Layout';
import { LoadingOverlayProvider } from './components/LoadingOverlay';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AgentPage } from './pages/AgentPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { PluginPage } from './pages/PluginPage';
import { PluginsPage } from './pages/PluginsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAuthStore } from './store/auth';

const queryClient = new QueryClient();

function App() {
  const user = useAuthStore((state) => state.user);

  return (
    <QueryClientProvider client={queryClient}>
      <LoadingOverlayProvider>
        <BrowserRouter>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#fff',
                color: '#111',
                border: '1px solid #e5e5e5',
                borderRadius: '6px',
              },
            }}
          />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DashboardPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/agents/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AgentPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/channels"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ChannelsPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/plugins"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PluginsPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/plugins/:name/ui"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PluginPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SettingsPage username={user?.username || ''} />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </LoadingOverlayProvider>
    </QueryClientProvider>
  );
}

export default App;
