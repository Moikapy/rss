# Cloudflare Deployment Guide

## Prerequisites
- Cloudflare account with Workers/Pages enabled
- Wrangler CLI installed (`npm install -g wrangler`)
- D1 database created

## Setup

### 1. Login to Cloudflare
```bash
npx wrangler login
```

### 2. Create D1 Database
```bash
npx wrangler d1 create 0xrss-db
```
Update the `database_id` in `wrangler.toml` with the ID returned.

### 3. Run D1 Migrations
```bash
npx wrangler d1 migrations apply 0xrss-db --remote
```

### 4. Set JWT Secret
```bash
npx wrangler pages secret put JWT_SECRET
# Enter a strong random string when prompted
```

### 5. Build for Cloudflare
```bash
bun run cf:build
```

### 6. Deploy
```bash
bun run cf:deploy
```

## Cron Triggers

The `wrangler.toml` defines a cron trigger that runs every 30 minutes to fetch new articles via `/api/cron/fetch-feeds`.

## Environment Variables (secrets)

| Variable | Description | How to set |
|---|---|---|
| `JWT_SECRET` | Signing key for JWT tokens | `wrangler pages secret put JWT_SECRET` |

## Local Development with D1

```bash
npx wrangler pages dev .vercel/output/static --d1=DB
```

## Notes

- D1 doesn't support FTS5. The app automatically falls back to LIKE queries for search.
- All API routes must be edge-compatible (no Node.js `fs`, `path`, `crypto`).
- The `better-sqlite3` driver is only used in local dev; D1 uses its own driver via `drizzle-orm/d1`.
- `@cloudflare/next-on-pages` handles the build adapter for Workers runtime.