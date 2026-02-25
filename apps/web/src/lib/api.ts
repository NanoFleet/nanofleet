const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

class AuthError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

const TOKEN_KEY = 'nf_access_token';

let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    setAccessToken(null);
    throw new AuthError(401, 'Refresh failed');
  }

  const data = await response.json();
  setAccessToken(data.accessToken);
  return data.accessToken;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  let response = await fetch(url, { ...options, headers, credentials: 'include' });

  if (response.status === 401) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken();
    }

    try {
      await refreshPromise;
      refreshPromise = null;

      headers.set('Authorization', `Bearer ${accessToken}`);
      response = await fetch(url, { ...options, headers });
    } catch {
      refreshPromise = null;
      throw new AuthError(401, 'Unauthorized');
    }
  }

  return response;
}

export const api = {
  get: async <T>(path: string): Promise<T> => {
    const response = await fetchWithAuth(`${API_BASE_URL}${path}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  },

  post: async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetchWithAuth(`${API_BASE_URL}${path}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  },

  patch: async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetchWithAuth(`${API_BASE_URL}${path}`, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    return response.json();
  },

  login: async (
    username: string,
    password: string,
    totp: string
  ): Promise<{ accessToken: string }> => {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, totp }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();
    setAccessToken(data.accessToken);
    return data;
  },

  updateProfile: async (data: {
    username?: string;
    password?: string;
    currentPassword?: string;
  }): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/auth/me`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Update failed' }));
      throw new Error(error.error || 'Update failed');
    }
    return response.json();
  },

  getApiKeys: async (): Promise<{
    keys: Array<{ id: string; keyName: string; createdAt: string }>;
  }> => {
    return api.get('/api/settings/keys');
  },

  saveApiKey: async (keyName: string, value: string): Promise<{ success: boolean }> => {
    return api.post('/api/settings/keys', { keyName, value });
  },

  deleteApiKey: async (keyName: string): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/settings/keys/${keyName}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(error.error || 'Delete failed');
    }
    return response.json();
  },

  getAgents: async (): Promise<{
    agents: Array<{
      id: string;
      name: string;
      status: string;
      packPath: string;
      model: string | null;
      containerId: string | null;
      token: string;
      tags: string[];
      createdAt: string;
    }>;
  }> => {
    return api.get('/api/agents');
  },

  getAgent: async (
    id: string
  ): Promise<{
    agent: {
      id: string;
      name: string;
      status: string;
      packPath: string;
      model: string | null;
      containerId: string | null;
      token: string;
      tags: string[];
      createdAt: string;
    };
  }> => {
    return api.get(`/api/agents/${id}`);
  },

  updateAgent: async (
    id: string,
    data: { tags?: string[]; model?: string }
  ): Promise<{ success: boolean }> => {
    return api.patch(`/api/agents/${id}`, data);
  },

  createAgent: async (data: {
    name: string;
    packPath: string;
    sessionVars?: Record<string, string>;
  }): Promise<{ id: string; name: string; status: string; containerId: string }> => {
    return api.post('/api/agents', data);
  },

  pauseAgent: async (id: string): Promise<{ success: boolean }> => {
    return api.post(`/api/agents/${id}/pause`);
  },

  resumeAgent: async (id: string): Promise<{ success: boolean }> => {
    return api.post(`/api/agents/${id}/resume`);
  },

  getAgentConfig: async (id: string, file: 'soul' | 'tools'): Promise<{ content: string }> => {
    return api.get(`/api/agents/${id}/config/${file}`);
  },

  saveAgentConfig: async (
    id: string,
    file: 'soul' | 'tools',
    content: string
  ): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/agents/${id}/config/${file}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Save failed' }));
      throw new Error(error.error || 'Save failed');
    }
    return response.json();
  },

  getAgentMessages: async (
    id: string
  ): Promise<{
    messages: Array<{
      id: string;
      agentId: string;
      role: 'user' | 'agent';
      content: string;
      createdAt: string;
    }>;
  }> => {
    return api.get(`/api/agents/${id}/messages`);
  },

  sendAgentMessage: async (id: string, content: string): Promise<{ success: boolean }> => {
    return api.post(`/api/agents/${id}/messages`, { content });
  },

  listAgentFiles: async (id: string): Promise<{ files: Array<{ name: string; size: number }> }> => {
    return api.get(`/api/agents/${id}/workspace`);
  },

  getAgentFile: async (id: string, filename: string): Promise<{ content: string }> => {
    return api.get(`/api/agents/${id}/workspace/${encodeURIComponent(filename)}`);
  },

  saveAgentFile: async (
    id: string,
    filename: string,
    content: string
  ): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/api/agents/${id}/workspace/${encodeURIComponent(filename)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Save failed' }));
      throw new Error(error.error || 'Save failed');
    }
    return response.json();
  },

  deleteAgentFile: async (id: string, filename: string): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/api/agents/${id}/workspace/${encodeURIComponent(filename)}`,
      {
        method: 'DELETE',
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(error.error || 'Delete failed');
    }
    return response.json();
  },

  uploadAgentFile: async (
    id: string,
    file: File
  ): Promise<{ success: boolean; filename: string }> => {
    const formData = new FormData();
    formData.append('file', file);

    const token = getAccessToken();
    const response = await fetch(`${API_BASE_URL}/api/agents/${id}/workspace`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  },

  deleteAgent: async (id: string): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/agents/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(error.error || 'Delete failed');
    }
    return response.json();
  },

  getPacks: async (): Promise<{
    packs: Array<{ name: string; valid: boolean; errors: string[] }>;
  }> => {
    return api.get('/api/packs');
  },

  getPlugins: async (): Promise<{
    plugins: Array<{
      id: string;
      name: string;
      version: string;
      image: string;
      status: string;
      manifestUrl: string;
      sidebarSlot: { icon: string; label: string; route: string } | null;
      replacesNativeFeatures: string[];
      tools: string[];
      createdAt: string;
    }>;
  }> => {
    return api.get('/api/plugins');
  },

  installPlugin: async (
    manifestUrl: string
  ): Promise<{
    id: string;
    name: string;
    version: string;
    status: string;
    tools: string[];
  }> => {
    return api.post('/api/plugins/install', { manifestUrl });
  },

  deletePlugin: async (id: string): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/plugins/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(error.error || 'Delete failed');
    }
    return response.json();
  },

  restartPlugin: async (
    id: string
  ): Promise<{ success: boolean; status: string; tools: string[] }> => {
    return api.post(`/api/plugins/${id}/restart`);
  },

  getAgentPlugins: async (
    agentId: string
  ): Promise<{
    plugins: Array<{ id: string; name: string; status: string }>;
  }> => {
    return api.get(`/api/agents/${agentId}/plugins`);
  },

  enableAgentPlugin: async (agentId: string, pluginId: string): Promise<{ success: boolean }> => {
    return api.post(`/api/agents/${agentId}/plugins/${pluginId}`);
  },

  disableAgentPlugin: async (agentId: string, pluginId: string): Promise<{ success: boolean }> => {
    const response = await fetchWithAuth(
      `${API_BASE_URL}/api/agents/${agentId}/plugins/${pluginId}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed' }));
      throw new Error(error.error || 'Failed');
    }
    return response.json();
  },

  uploadPack: async (file: File): Promise<{ success: boolean; packName: string }> => {
    const formData = new FormData();
    formData.append('file', file);

    const token = getAccessToken();
    const response = await fetch(`${API_BASE_URL}/api/packs`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  },
};
