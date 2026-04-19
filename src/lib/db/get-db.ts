/**
 * Database accessor that works in both Cloudflare Workers (D1) and local development (better-sqlite3).
 *
 * - Production (Workers): Uses D1 binding from Cloudflare context via @opennextjs/cloudflare.
 * - Local dev: Uses better-sqlite3 with auto-init from ./client.
 *
 * All callers should `await` the result and `await` all drizzle operations.
 * In local dev, `await` on sync values is a no-op, so both paths work.
 */

import { createD1Client } from "./d1-client";

// We use `any` for the database return type because better-sqlite3 and D1
// drizzle drivers have incompatible type signatures (sync vs async methods).
// The `await` pattern makes both work at runtime. Schema imports still give
// full autocomplete and type safety for column/table references in queries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDatabase = any;

/**
 * Get the appropriate database client for the current environment.
 * Returns D1 drizzle client in Cloudflare Workers, or better-sqlite3 locally.
 */
export async function getDatabase(): Promise<AnyDatabase> {
  // Try Cloudflare Workers context first
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    if (ctx.env?.DB) {
      return createD1Client(ctx.env.DB);
    }
  } catch {
    // Not in Cloudflare context — fall through to local dev
  }

  // Dynamic import for better-sqlite3 (native module, not available on Workers)
  const { getDb } = await import("./client");
  return getDb();
}