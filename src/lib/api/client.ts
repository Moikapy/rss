/**
 * API client for the 0xRSS Hono Worker + local Next.js fallback.
 *
 * Three API tiers (when using Hono Worker):
 * - Public (/api/public/*): cached, no auth required
 * - User (/api/user/*, /api/chat/*): any JWT
 * - Admin (/api/admin/*): admin JWT only
 *
 * When NEXT_PUBLIC_API_URL is empty (local dev), the Hono Worker isn't
 * available. The Next.js API routes at /api/* (without admin/public prefix)
 * serve as the fallback. This client automatically strips the tier prefix
 * when running against the local Next.js server.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
export const TOKEN_KEY = "0xrss-token";

/** True when requests go to the Hono Worker (has /api/public, /api/admin, /api/user routes) */
const USE_HONO_TIERS = API_BASE !== "";

// ─── URL helpers ────────────────────────────────────────────────────────────

export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

/** Prepend /api/public to a path — returns a path, NOT a full URL */
export function publicUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return USE_HONO_TIERS ? `/api/public${normalized}` : `/api${normalized}`;
}

/** Prepend /api/admin to a path — returns a path, NOT a full URL */
export function adminUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return USE_HONO_TIERS ? `/api/admin${normalized}` : `/api${normalized}`;
}

/** Prepend /api/user to a path — returns a path, NOT a full URL */
export function userUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return USE_HONO_TIERS ? `/api/user${normalized}` : `/api${normalized}`;
}

// ─── Auth headers ────────────────────────────────────────────────────────────

/** Get Authorization header from stored JWT token */
export function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Public API (no auth, KV-cached) ────────────────────────────────────────

/** Fetch from public API — no auth headers, includes credentials for CORS */
export async function publicFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const prefix = USE_HONO_TIERS ? "/api/public" : "/api";
  const res = await fetch(`${API_BASE}${prefix}${normalized}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Authenticated API (JWT required) ───────────────────────────────────────

/** Typed fetch wrapper that always includes credentials + auth */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/** Upload/form-data variant — doesn't set Content-Type (browser handles it) */
export async function apiUpload<T = unknown>(
  path: string,
  body: FormData
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    body,
    credentials: "include",
    headers: authHeaders(),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error || `API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}