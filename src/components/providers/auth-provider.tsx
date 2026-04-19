"use client";

import { apiUrl, apiFetch, TOKEN_KEY } from "@/lib/api/client";
import { loginWithNostr, loginWithPassword, registerWithPassword, isNostrAvailable } from "@/lib/auth/nostr";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface AuthUser {
  id: string;
  username?: string;
  pubkey?: string;
  role: string;
  method?: string;
}

interface AuthContextType {
  authenticated: boolean;
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  loginNostr: () => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  nostrAvailable: boolean;
}

const AuthContext = createContext<AuthContextType>({
  authenticated: false,
  user: null,
  loading: true,
  login: async () => false,
  loginNostr: async () => false,
  register: async () => false,
  logout: async () => {},
  nostrAvailable: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [nostrAvailable, setNostrAvailable] = useState(false);

  useEffect(() => {
    setNostrAvailable(isNostrAvailable());
  }, []);

  useEffect(() => {
    apiFetch<{ authenticated?: boolean; role?: string; username?: string; pubkey?: string; method?: string }>("/api/auth/me")
      .then((data) => {
        if (data.authenticated) {
          setAuthenticated(true);
          setUser({
            id: data.pubkey ? `nostr:${data.pubkey}` : (data.username || ""),
            username: data.username,
            pubkey: data.pubkey,
            role: data.role || "user",
            method: data.method,
          });
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
    const result = await loginWithPassword(username, password);
    if (result.success && result.token) {
      setAuthenticated(true);
      setUser({ id: username, username, role: result.role || "admin" });
      return true;
    }
    return false;
  }

  async function handleNostrLogin(): Promise<boolean> {
    try {
      const result = await loginWithNostr();
      setAuthenticated(true);
      setUser({
        id: `nostr:${result.pubkey}`,
        pubkey: result.pubkey,
        role: result.role,
        method: "nostr",
      });
      return true;
    } catch {
      return false;
    }
  }

  async function handleRegister(username: string, password: string): Promise<boolean> {
    const result = await registerWithPassword(username, password);
    if (result.success && result.token) {
      setAuthenticated(true);
      setUser({ id: `pwd:${username}`, username, role: result.role || "user", method: "password" });
      return true;
    }
    return false;
  }

  async function logout(): Promise<void> {
    localStorage.removeItem(TOKEN_KEY);
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAuthenticated(false);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{
      authenticated,
      user,
      loading,
      login,
      loginNostr: handleNostrLogin,
      register: handleRegister,
      logout,
      nostrAvailable,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Get the stored JWT token (for use outside React) */
export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}