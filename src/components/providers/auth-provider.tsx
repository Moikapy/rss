"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface AuthContextType {
  authenticated: boolean;
  user: { id: string; username: string } | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  authenticated: false,
  user: null,
  loading: true,
  login: async () => false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json() as Promise<{ authenticated?: boolean; user?: { id: string; username: string } }>)
      .then((data) => {
        if (data.authenticated && data.user) {
          setAuthenticated(true);
          setUser(data.user);
        } else {
          setAuthenticated(false);
          setUser(null);
        }
      })
      .catch(() => {
        setAuthenticated(false);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string): Promise<boolean> {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as { success?: boolean; userId?: string; error?: string };
      if (res.ok && data.success) {
        setAuthenticated(true);
        setUser({ id: data.userId || "", username });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ authenticated, user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}