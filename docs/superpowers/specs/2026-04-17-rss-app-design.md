# RSS App — Design Specification

**Date:** 2026-04-17
**Status:** Approved
**Author:** 0xKobold + Developer

## Overview

A personal RSS feed reader and manager built as a web app with an Electron desktop wrapper for Mac and Arch Linux (Omarchy). Features JWT auth for single-user access, full article reading with fallback, and a Cloudflare deployment path for production.

## Stack

| Component | Technology |
|---|---|
| Runtime | Bun |
| Framework | Next.js (App Router, latest) |
| UI | Tailwind CSS + shadcn/ui |
| ORM | Drizzle ORM |
| Dev Database | SQLite (better-sqlite3) |
| Prod Database | Cloudflare D1 |
| Auth | JWT via `jose` (edge-compatible) |
| Password Hashing | PBKDF2 via Web Crypto API (edge-native, fast) |
| Desktop | Electron + electron-builder |
| Resizable Panels | react-resizable-panels |
| Feed Parsing | Custom lightweight RSS/Atom/JSON Feed parser (edge-compatible) |
| Content Extraction | @mozilla/readability + linkedom (server-side DOM, pure JS) |
| Cloudflare Adapter | @cloudflare/next-on-pages + Wrangler |

## Architecture

```
┌─────────────────────────────────────────┐
│              Electron Shell             │
│  ┌───────────────────────────────────┐  │
│  │         Next.js App               │  │
│  │  ┌────────────┐ ┌──────────────┐  │  │
│  │  │  Frontend   │ │  API Routes  │  │  │
│  │  │  (React +   │ │  (Edge-      │  │  │
│  │  │  shadcn/ui) │ │  compatible) │  │  │
│  │  └────────────┘ └──────────────┘  │  │
│  │         │               │         │  │
│  │         └───────┬───────┘         │  │
│  │                 ▼                 │  │
│  │         ┌──────────────┐          │  │
│  │         │  Drizzle ORM │          │  │
│  │         └──────┬───────┘          │  │
│  │                ▼                  │  │
│  │     ┌─────────────────────┐       │  │
│  │     │ SQLite (dev) / D1   │       │  │
│  │     │ (prod Cloudflare)   │       │  │
│  │     └─────────────────────┘       │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

All API routes are written edge-compatible (no `fs`, no Node `crypto`, no native modules) so they run identically on Cloudflare Workers without changes.

## Project Structure

```
rss-app/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── (auth)/       # Login page
│   │   ├── (dashboard)/  # Main app pages (protected)
│   │   └── api/          # API routes (all edge-compatible)
│   ├── components/       # React components + shadcn
│   ├── lib/              # Shared utilities, auth, DB
│   │   ├── db/           # Drizzle schema, migrations, client
│   │   ├── auth.ts       # JWT handling
│   │   └── feeds/        # Feed fetching + parsing
│   └── electron/         # Electron main process
├── drizzle/              # Migration files
├── public/               # Static assets
└── electron-builder.yml  # Electron packaging config
```

## Database Schema

```sql
-- Users table (single user, extensible)
users
  ├── id        (text, pk, crypto.randomUUID())
  ├── username  (text, unique)
  ├── password  (text, hashed with PBKDF2 via Web Crypto API)
  └── createdAt (integer, unix timestamp)

-- Folders for broad grouping
folders
  ├── id        (text, pk)
  ├── name      (text)
  ├── order     (integer, for drag-to-reorder)
  └── createdAt (integer, unix timestamp)

-- RSS/Atom feeds
feeds
  ├── id              (text, pk)
  ├── title           (text)
  ├── url             (text, unique)  -- RSS/Atom feed URL
  ├── siteUrl         (text, nullable)  -- link to actual website
  ├── description     (text, nullable)
  ├── folderId        (text, fk → folders.id, nullable)
  ├── refreshInterval (integer, default 30, in minutes)
  ├── autoRefresh     (integer, 1=true, 0=false)
  ├── lastFetched     (integer, unix timestamp, nullable)
  ├── createdAt       (integer, unix timestamp)
  └── updatedAt       (integer, unix timestamp)

-- Tags (many-to-many with feeds)
tags
  ├── id   (text, pk)
  └── name (text, unique)

feed_tags
  ├── feedId (text, fk → feeds.id)
  └── tagId  (text, fk → tags.id)

-- Articles
articles
  ├── id          (text, pk)
  ├── feedId       (text, fk → feeds.id)
  ├── title        (text)
  ├── url          (text)
  ├── author       (text, nullable)
  ├── summary      (text, nullable)
  ├── content      (text, nullable)  -- full article HTML
  ├── publishedAt  (integer, unix timestamp)
  ├── read         (integer, default 0)
  ├── bookmarked   (integer, default 0)
  ├── readLater    (integer, default 0)
  ├── createdAt    (integer, unix timestamp)
  └── UNIQUE(feedId, url)  -- prevent duplicates

-- FTS5 virtual table for full-text search
articles_fts
  ├── title
  ├── summary
  ├── content
  └── (content synced from articles via triggers)
```

**Key decisions:**
- Text PKs with `crypto.randomUUID()` — D1 doesn't support auto-increment well
- Integer booleans (0/1) — SQLite/D1 have no native boolean type
- FTS5 trigger auto-syncs article content for always-current search
- Unique constraint on `(feedId, url)` prevents duplicate articles on re-fetch

## Auth Flow

Single-user JWT auth to keep the app private.

### Flow

1. **First-run setup** — If no user exists in DB, prompt to create username/password (one-time)
2. **Login** — POST `/api/auth/login` validates credentials, returns signed JWT
3. **Token storage** — JWT stored in `httpOnly` secure cookie (not localStorage — safer from XSS)
4. **Middleware** — Next.js middleware validates JWT on `/api/*` and `/(dashboard)/*` routes. Invalid/expired → redirect to login
5. **Logout** — Clears cookie, redirects to login

### Token Details

| Property | Value |
|---|---|
| Library | `jose` (edge-compatible) |
| Algorithm | HS256 |
| Secret | `JWT_SECRET` from env, auto-generated on first run |
| Expiry | 7 days |
| Refresh | Automatic on valid token within expiry window |
| Password hashing | PBKDF2 via Web Crypto API (edge-native, works in Workers + Electron — bcryptjs exceeded CPU limits on Workers free tier) |

## Feed Management & Article Processing

### Feed Fetching Pipeline

1. **Scheduler** — Background timer per feed at configurable `refreshInterval` (default 30 min). Can be paused globally or per-feed.
2. **Fetch** — `fetch()` the feed URL, parse RSS 2.0 / Atom / JSON Feed using a custom lightweight parser (edge-compatible, no Node XML libs).
3. **Dedupe** — Check `feedId + url` for each article. New articles get inserted, existing articles get updated if title/content changed.
4. **Full content extraction** — Attempt to fetch original article URL and extract readable content using `@mozilla/readability` + `linkedom` (both pure JS, edge-compatible). Sanitize HTML before storage.
5. **Fallback** — If full content fetch fails (paywall, timeout, etc.), store summary from feed + external source link.

### OPML Import/Export

- **Import** — Parse OPML XML, extract feed URLs and folder names, bulk-create feeds and folders
- **Export** — Serialize current folders + feeds into OPML XML for backup/migration

### Auto-Refresh Behavior

- App starts → schedule timer per feed based on its interval
- `lastFetched` tracks when feed was last checked
- Manual refresh button triggers immediate fetch for individual feeds or all
- Per-feed config: interval (5, 15, 30, 60, 120 min) and auto-refresh on/off

## UI Layout & Pages

### Three-Panel Resizable Layout

```
┌────────┬───┬────────────┬───┬──────────────────┐
│        │ ▮ │            │ ▮ │                   │
│ Sidebar│ ▮ │  Article   │ ▮ │  Article Reader   │
│        │ ▮ │  List      │ ▮ │                   │
│        │ ▮ │            │ ▮ │                   │
└────────┴───┴────────────┴───┴──────────────────┘
       resize      resize
       handle      handle
```

- **Sidebar** — Resizable, min 180px / max 360px. Collapsible via toggle or `Cmd+\`
- **Article List** — Resizable, min 280px / max 500px
- **Article Reader** — Fills remaining space
- Uses `react-resizable-panels` — lightweight, accessible, persisted sizes in localStorage

### Top Bar

`☰ RSS App  ··················  🔍  ⚙️  👤`

### Status Bar

`Status: 3 feeds refreshing · Last updated 2m ago`

### Pages

| Route | Purpose |
|---|---|
| `/login` | Auth page — clean, centered login form |
| `/` | Main dashboard — three-panel layout |
| `/feeds/add` | Add new feed (URL input, pick folder, assign tags) |
| `/feeds/[id]` | Feed detail — articles filtered to that feed |
| `/settings` | Feeds management, OPML import/export, refresh config, theme, account |
| `/search?q=...` | Full-text search results in article list panel |

### Key Components

- **Sidebar** — Folder tree with feed unread counts. Tag list below. Collapsible.
- **Article List** — Virtualized list (handles thousands). Unread dot, bookmark star, read-later icon. Sort by date. Filter tabs: All / Unread / Bookmarked / Read Later.
- **Article Reader** — Renders sanitized HTML with typography-optimized styling. Header: title, author, date, feed name. Action bar: mark read/unread, bookmark, read later, open source.
- **Settings** — Feeds table, OPML import/export, refresh config, theme toggle (light/dark).

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `j` / `k` | Navigate articles (next/prev) |
| `Enter` | Open selected article |
| `s` | Toggle bookmark |
| `l` | Toggle read later |
| `r` | Toggle read/unread |
| `Cmd+\` | Toggle sidebar |

## Electron & Desktop Packaging

### Architecture

- **Dev mode** — Electron loads `localhost:3000` (Next.js dev server), hot reload works normally
- **Prod mode** — Electron serves built static files via `electron-forge` custom protocol, no dev server needed

### Desktop-Specific Features

- **System tray** — Minimize to tray, tray icon shows unread count badge
- **Native notifications** — "5 new articles from Hacker News" on auto-refresh
- **Auto-update** — `electron-updater` checks GitHub Releases
- **Global shortcut** — `Cmd+Shift+R` to show/hide from anywhere
- **Window state persistence** — Size and position remembered between sessions
- **Auto-launch** — Optional startup on login

### Packaging

| Platform | Format | Notes |
|---|---|---|
| macOS | `.dmg` + `.app` | Universal binary (x64 + arm64) |
| Arch Linux / Omarchy | `.AppImage` + `.pacman` | AppImage for portability, .pacman for native pkg |

### Skills

- Electron skill: `npx skills add https://github.com/teachingai/full-stack-skills --skill electron`

## Cloudflare Deployment Path

### Dev vs Prod

| Component | Dev (Local) | Prod (Cloudflare) |
|---|---|---|
| Runtime | Bun + Node (Electron) | Cloudflare Workers (Edge) |
| Database | SQLite file on disk | Cloudflare D1 |
| Static assets | Next.js dev server | Cloudflare Pages |
| API routes | Next.js API routes | Workers functions (via `@cloudflare/next-on-pages`) |
| JWT secret | `.env` file | Cloudflare Workers secret |
| Feed fetching | Direct fetch + scheduler | Cron Triggers |

### Adapter: `@cloudflare/next-on-pages`

- Wraps Next.js API routes to run as Cloudflare Workers functions
- Handles edge runtime compatibility
- All API routes are edge-compatible from day one

### Migration Strategy

1. **Drizzle handles schema parity** — Same schema, two driver configs:
   - Dev: `drizzle-orm/better-sqlite3`
   - Prod: `drizzle-orm/d1`
2. **Environment-based client switching** — `getDB()` helper checks environment and returns correct client
3. **Wrangler for D1 local dev** — Test D1 locally with `wrangler dev` before deploying
4. **Cron Triggers replace auto-poll** — Cloudflare Cron Triggers call `/api/cron/fetch-feeds` on schedule

### Deployment Flow

```bash
wrangler d1 migrations apply rss-db     # Run D1 migrations
npx @cloudflare/next-on-pages           # Build for Pages
wrangler pages deploy .vercel/output    # Deploy
```

## Triage Features

- **Read/Unread** — Toggle on article. Auto-marked read when opened in reader.
- **Bookmarks** — Star articles for permanent reference. Filter by bookmarked in article list.
- **Read Later Queue** — Separate from bookmarks. Articles you want to get to but haven't yet. Dedicated filter tab.

## Full-Text Search

**Note:** Cloudflare D1 does not support FTS5 virtual tables. Search is implemented via an adapter pattern:

- **Dev (SQLite):** FTS5 virtual table with triggers to auto-sync `title`, `summary`, `content` from `articles` → `articles_fts` on insert/update. Queries use `MATCH` for fast, ranked results.
- **Prod (D1):** Uses `LIKE` queries with `LOWER()` on `title` and `summary` columns. An index on `LOWER(title)` and `LOWER(summary)` improves performance. Full content search is limited to title + summary in prod (article body content is too large for `LIKE` on D1).
- **Future (optional):** Cloudflare Workers AI text embeddings for semantic search in prod.
- **Adapter pattern:** A `search()` abstraction in `lib/db/search.ts` detects the environment and routes to the appropriate implementation.
- Search API: `GET /api/search?q=...` — returns results from the active implementation
- Frontend: search bar in top bar, results render in article list panel