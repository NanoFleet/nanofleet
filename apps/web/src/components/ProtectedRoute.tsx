import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

interface User {
  id: string;
  username: string;
  role: string;
  createdAt: string;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!checkAuth()) {
      setIsLoading(false);
      return;
    }

    api
      .get<User>('/api/auth/me')
      .then((user) => {
        setUser(user as User);
        setIsAuthorized(true);
      })
      .catch(() => {
        logout();
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [checkAuth, setUser, logout]);

  if (isLoading) {
    return null;
  }

  if (!isAuthorized) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
