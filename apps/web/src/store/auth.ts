import { create } from 'zustand';
import { getAccessToken, setAccessToken as setApiAccessToken } from '../lib/api';

const TOKEN_KEY = 'nf_access_token';

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  login: (accessToken: string) => void;
  logout: () => void;
  checkAuth: () => boolean;
}

function getInitialAuth(): boolean {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    setApiAccessToken(token);
  }
  return !!token;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: getInitialAuth(),

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  login: (accessToken) => {
    setApiAccessToken(accessToken);
    set({ isAuthenticated: true });
  },

  logout: () => {
    setApiAccessToken(null);
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: () => {
    return !!getAccessToken();
  },
}));
