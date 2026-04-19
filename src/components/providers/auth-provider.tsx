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

// ─── Local JWT decoding (no server round-trip) ────────────────────────────

interface JWTPayload {
  sub: string;
  role: string;
  method?: string;
  iat: number;
  exp: number;
}

/** Decode JWT payload without verifying signature (client-side only for UI state) */
function decodeJWTPayload(token: string): JWTPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Build AuthUser from a locally-decoded JWT payload */
function userFromToken(token: string): AuthUser | null {
  const payload = decodeJWTPayload(token);
  if (!payload) return null;

  const userId = payload.sub;
  let username: string | undefined;
  let pubkey: string | undefined;

  if (userId.startsWith("nostr:")) {
    pubkey = userId.replace("nostr:", "");
  } else if (userId.startsWith("pwd:")) {
    username = userId.replace("pwd:", "");
  } else {
    username = userId; // admin users have UUID as sub
  }

  return {
    id: userId,
    username,
    pubkey,
    role: payload.role || "user",
    method: payload.method,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [nostrAvailable, setNostrAvailable] = useState(false);

  useEffect(() => {
    setNostrAvailable(isNostrAvailable());
  }, []);

  // Instant auth check: decode JWT locally, then validate in background
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);

    if (!token) {
      setAuthenticated(false);
      setUser(null);
      setLoading(false);
      return;
    }

    // 1. Decode locally for instant UI state
    const localUser = userFromToken(token);
    if (localUser) {
      setAuthenticated(true);
      setUser(localUser);
    }
    setLoading(false);

    // 2. Background server validation (catches expired/invalid tokens)
    apiFetch<{ authenticated?: boolean; role?: string; username?: string; pubkey?: string; method?: string }>("/api/auth/session")
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
          // Token invalid/expired — clear it
          localStorage.removeItem(TOKEN_KEY);
          setAuthenticated(false);
          setUser(null);
        }
      })
      .catch(() => {
        // Network error — keep local auth state (optimistic)
        // Server validation will retry on next API call
      });
  }, []);

  async function login(username: string, password: string): Promise<boolean> {
    const result = await loginWithPassword(username, password);
    if (result.success && result.token) {
      const localUser = userFromToken(result.token);
      setAuthenticated(true);
      setUser(localUser || { id: username, username, role: result.role || "admin" });
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
      const localUser = userFromToken(result.token);
      setAuthenticated(true);
      setUser(localUser || { id: `pwd:${username}`, username, role: result.role || "user", method: "password" });
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