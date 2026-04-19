/**
 * Cloudflare Worker bindings / environment type
 */
export type Bindings = {
  // D1 Database
  DB: D1Database;

  // KV Namespace (caching, user settings, ollama config)
  CACHE: KVNamespace;

  // Queue (async feed fetching)
  FEED_QUEUE: Queue;

  // Secrets (set via `wrangler secret put`)
  JWT_SECRET: string;
};

/**
 * Variables attached to each request by auth middleware
 */
export type Variables = {
  userId: string;
  role: string;
  method: string;
};