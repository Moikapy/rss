/**
 * Nostr NIP-01/07 event verification.
 *
 * Verifies that a signed Nostr event was actually created by the claimed pubkey
 * using Schnorr signatures over the secp256k1 curve (BIP-340).
 */

import { schnorr } from "@noble/curves/secp256k1.js";

export interface NostrSignedEvent {
  id?: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

/**
 * Serialize a Nostr event for ID computation per NIP-01.
 * The serialization is: JSON.stringify([0, pubkey, created_at, kind, tags, content])
 */
function serializeEvent(event: NostrSignedEvent): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}

/**
 * Compute the SHA-256 event ID for a Nostr event.
 */
async function computeEventId(event: NostrSignedEvent): Promise<string> {
  const serialized = serializeEvent(event);
  const encoded = new TextEncoder().encode(serialized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify a Nostr signed event:
 * 1. Compute the event ID and verify it matches the provided ID
 * 2. Verify the Schnorr signature against the event ID using the claimed pubkey
 * 3. Verify the event kind is 27235 (NIP-98 HTTP auth)
 * 4. Verify the `u` tag matches the expected domain
 *
 * @returns true if the event is valid, false otherwise
 */
export async function verifyNostrEvent(
  signedEvent: NostrSignedEvent,
  expectedPubkey: string,
  expectedDomain?: string,
): Promise<{ valid: boolean; error?: string }> {
  // ─── Required fields ──────────────────────────────────────────────────
  if (!signedEvent.sig) {
    return { valid: false, error: "Missing signature" };
  }

  if (!signedEvent.id) {
    return { valid: false, error: "Missing event ID" };
  }

  // ─── Pubkey match ─────────────────────────────────────────────────────
  if (signedEvent.pubkey !== expectedPubkey) {
    return { valid: false, error: "Pubkey mismatch" };
  }

  // ─── Kind check: must be 27235 (NIP-98 HTTP auth) ────────────────────
  if (signedEvent.kind !== 27235) {
    return { valid: false, error: `Invalid event kind: expected 27235, got ${signedEvent.kind}` };
  }

  // ─── Domain check (if expectedDomain provided) ────────────────────────
  if (expectedDomain) {
    const uTag = signedEvent.tags.find((t) => t[0] === "u");
    if (!uTag || !uTag[1]) {
      return { valid: false, error: "Missing required 'u' tag" };
    }
    try {
      const tagUrl = new URL(uTag[1]);
      if (tagUrl.hostname !== expectedDomain && !tagUrl.hostname.endsWith(`.${expectedDomain}`)) {
        return { valid: false, error: `Domain mismatch: expected ${expectedDomain}, got ${tagUrl.hostname}` };
      }
    } catch {
      return { valid: false, error: "Invalid URL in 'u' tag" };
    }
  }

  // ─── Event ID verification ────────────────────────────────────────────
  const computedId = await computeEventId(signedEvent);
  if (computedId !== signedEvent.id) {
    return { valid: false, error: "Event ID does not match computed hash" };
  }

  // ─── Schnorr signature verification ───────────────────────────────────
  try {
    const messageId = hexToBytes(computedId);
    const signature = hexToBytes(signedEvent.sig);
    const pubkey = hexToBytes(signedEvent.pubkey);

    const isValid = schnorr.verify(signature, messageId, pubkey);
    if (!isValid) {
      return { valid: false, error: "Invalid Schnorr signature" };
    }
  } catch (err) {
    return { valid: false, error: `Signature verification failed: ${err instanceof Error ? err.message : "unknown error"}` };
  }

  // ─── Timestamp freshness (reject events older than 5 minutes) ────────
  const eventAge = Math.floor(Date.now() / 1000) - signedEvent.created_at;
  if (Math.abs(eventAge) > 300) {
    return { valid: false, error: "Event timestamp too far from current time" };
  }

  return { valid: true };
}

/** Convert a hex string to Uint8Array */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}