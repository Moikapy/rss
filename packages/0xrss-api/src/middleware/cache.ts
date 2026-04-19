import { createMiddleware } from "hono/factory";
import type { Bindings, Variables } from "../types";

/** Cache TTL constants (seconds) */
export const CACHE_TTL = {
  FEEDS: 60,
  ARTICLES: 60,
  ARTICLE_DETAIL: 60,
  FOLDERS: 300,
  TAGS: 300,
} as const;

/** Derive KV cache key from request URL */
function cacheKey(url: string): string {
  return `pub:${url}`;
}

/**
 * KV cache middleware for public routes.
 * HIT: return cached JSON immediately.
 * MISS: run handler, cache the result, return.
 */
export const cacheMiddleware = createMiddleware<{ Bindings: Bindings; Variables: Variables }>(
  async (c, next) => {
    const url = new URL(c.req.url);
    const key = `pub:${url.pathname}${url.search}`;
    const cached = await c.env.CACHE.get(key, "text");

    if (cached) {
      return new Response(cached, {
        headers: {
          "Content-Type": "application/json",
          "X-Cache": "HIT",
          // Prevent CDN from caching — only KV cache is authoritative,
          // and KV gets invalidated on admin mutations.
          "Cache-Control": "public, max-age=0, s-maxage=0, must-revalidate",
        },
      });
    }

    // MISS — run handler
    await next();

    // Cache successful JSON responses in KV (but not CDN)
    if (c.res.status >= 200 && c.res.status < 300) {
      const ttl = parseInt(c.res.headers.get("X-Cache-TTL") || "60");

      // Read body, then recreate response with CDN no-cache headers
      const body = await c.res.text();
      const headers = new Headers(c.res.headers);
      headers.set("Cache-Control", "public, max-age=0, s-maxage=0, must-revalidate");
      c.res = new Response(body, {
        status: c.res.status,
        headers,
      });

      // Write to KV synchronously (waitUntil is unreliable for KV writes in this context)
      try {
        await c.env.CACHE.put(key, body, { expirationTtl: ttl });
      } catch {
        // KV write failed — non-critical
      }
    }
  }
);

/** Delete KV cache keys matching path prefixes (called after admin mutations) */
export async function invalidateCache(env: Bindings, prefixes: string[]) {
  for (const prefix of prefixes) {
    const kvPrefix = `pub:${prefix}`;
    const listed = await env.CACHE.list({ prefix: kvPrefix });
    for (const key of listed.keys) {
      await env.CACHE.delete(key.name);
    }
  }
}