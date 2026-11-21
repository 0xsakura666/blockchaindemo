import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, currentUserId, setCurrentUserId } from './api';

export interface DemoUser { id: string; name: string; role: 'player' | 'merchant' | 'admin'; merchantId?: string; avatar: string }

interface Session {
  userId: string;
  user: DemoUser | null;
  users: DemoUser[];
  switchUser: (id: string) => void;
  refreshUsers: () => void;
  embed: boolean;
}

const Ctx = createContext<Session>(null as never);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState(currentUserId());
  const [users, setUsers] = useState<DemoUser[]>([]);
  const embed = new URLSearchParams(location.search).get('embed') === '1' || location.pathname.startsWith('/embed/');
  const refreshUsers = useCallback(() => {
    api<DemoUser[]>('/api/demo/users').then(setUsers).catch(() => undefined);
  }, []);
  useEffect(refreshUsers, [refreshUsers]);
  const switchUser = (id: string) => {
    setCurrentUserId(id);
    setUserId(id);
  };
  const user = users.find((u) => u.id === userId) ?? null;
  return <Ctx.Provider value={{ userId, user, users, switchUser, refreshUsers, embed }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
