/**
 * Environment variable accessor that works in both Cloudflare Workers and local Node.js.
 * In Workers: reads from the Cloudflare context (env bindings).
 * Locally: falls back to process.env.
 */
function getEnvVar(key: string): string | undefined {
  try {
    // Dynamic import to avoid bundling issues in local dev
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    const value = ctx.env?.[key];
    if (value !== undefined) return value as string | undefined;
  } catch {
    // Not in Cloudflare context
  }
  return process.env[key];
}

export function getEnvString(key: string, fallback?: string): string {
  const value = getEnvVar(key);
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${key}`);
}

export function getEnvStringOptional(key: string): string | undefined {
  return getEnvVar(key);
}

export function isProduction(): boolean {
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    getCloudflareContext();
    return true;
  } catch {
    return false;
  }
}