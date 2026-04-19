/**
 * Nostr NIP-07 authentication module.
 *
 * NIP-07 defines a browser extension API for Nostr:
 * https://github.com/nostr-protocol/nips/blob/master/07.md
 *
 * Users authenticate by signing an event with their Nostr key.
 * The server verifies the signature and issues a JWT with pubkey as identity.
 */

import { apiUrl, TOKEN_KEY } from "@/lib/api/client";

// ─── NIP-07 type declarations ────────────────────────────────────────────────

interface NostrEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey?: string;
  id?: string;
  sig?: string;
}

interface NostrExtension {
  getPublicKey(): Promise<string>;
  signEvent(event: NostrEvent): Promise<NostrEvent>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: NostrExtension;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Check if NIP-07 browser extension is available */
export function isNostrAvailable(): boolean {
  return typeof window !== "undefined" && !!window.nostr;
}

/** Get the user's Nostr public key from the browser extension */
export async function getNostrPublicKey(): Promise<string> {
  if (!window.nostr) throw new Error("Nostr extension not available");
  return window.nostr.getPublicKey();
}

/** Sign a Nostr event with the browser extension */
export async function signNostrEvent(event: {
  kind: number;
  content: string;
  tags?: string[][];
  created_at?: number;
}): Promise<NostrEvent> {
  if (!window.nostr) throw new Error("Nostr extension not available");
  return window.nostr.signEvent({
    kind: event.kind,
    content: event.content,
    tags: event.tags || [],
    created_at: event.created_at || Math.floor(Date.now() / 1000),
  });
}

// ─── Login flow ──────────────────────────────────────────────────────────────

interface NostrLoginResult {
  pubkey: string;
  token: string;
  role: string;
  isNew: boolean;
}

/**
 * Authenticate with Nostr NIP-07.
 *
 * Flow:
 * 1. Get pubkey from extension
 * 2. Sign a kind-27235 auth event (NIP-98-like) with the current domain
 * 3. POST to /api/auth/nostr with { pubkey, signedEvent }
 * 4. Receive JWT token
 */
export async function loginWithNostr(): Promise<NostrLoginResult> {
  const pubkey = await getNostrPublicKey();

  // Sign an authentication event (NIP-98 / kind 27235)
  const signedEvent = await signNostrEvent({
    kind: 27235,
    content: window.location.host,
    tags: [
      ["u", window.location.origin],
      ["method", "GET"],
    ],
  });

  const res = await fetch(apiUrl("/api/auth/nostr"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey, signedEvent }),
  });

  const data: { success?: boolean; token?: string; role?: string; pubkey?: string; isNew?: boolean; error?: string } = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Nostr login failed");
  }

  // Store the JWT token
  if (data.token) {
    localStorage.setItem(TOKEN_KEY, data.token);
  }

  return {
    pubkey: data.pubkey || pubkey,
    token: data.token!,
    role: data.role || "user",
    isNew: data.isNew ?? false,
  };
}

/**
 * Register or login with username/password.
 */
export async function loginWithPassword(username: string, password: string): Promise<{
  success: boolean;
  token?: string;
  role?: string;
  error?: string;
}> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data: { success?: boolean; token?: string; role?: string; error?: string; userId?: string } = await res.json();

  if (!res.ok) {
    return { success: false, error: data.error || "Login failed" };
  }

  if (data.success && data.token) {
    localStorage.setItem(TOKEN_KEY, data.token);
    return { success: true, token: data.token, role: data.role };
  }

  return { success: false, error: data.error || "Login failed" };
}

/**
 * Register a new password-based user account.
 */
export async function registerWithPassword(username: string, password: string): Promise<{
  success: boolean;
  token?: string;
  role?: string;
  error?: string;
}> {
  const res = await fetch(apiUrl("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data: { success?: boolean; token?: string; role?: string; error?: string } = await res.json();

  if (!res.ok) {
    return { success: false, error: data.error || "Registration failed" };
  }

  if (data.success && data.token) {
    localStorage.setItem(TOKEN_KEY, data.token);
    return { success: true, token: data.token, role: data.role };
  }

  return { success: false, error: data.error || "Registration failed" };
}