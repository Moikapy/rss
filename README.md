# 🐉 0xRSS

A privacy-first, edge-deployed RSS feed aggregator — your corner of the internet, curated by you.

**Live at [rss.moikapy.dev](https://rss.moikapy.dev)** · Installable PWA · Works offline

## Why 0xRSS?

The internet is noisy. 0xRSS gives you one quiet place to read what matters — no algorithm, no ads, no tracking. Just feeds, folders, and full-text articles.

## Features

- **📰 Smart Feed Aggregation** — 54+ curated feeds across AI, Gaming, Tech, News, Pop Culture, and Anime
- **📖 Full Content Extraction** — Mozilla Readability renders full articles inline, no tab-switching
- **📂 Folders + Tags** — Organize feeds your way, filter across feeds
- **✅ Full Triage** — Read/unread, bookmarks, read-later queue
- **🔍 Full-Text Search** — FTS5 in SQLite, LIKE fallback for D1
- **📥 OPML Import/Export** — Standard RSS subscription format
- **🔄 Auto-Refresh** — Configurable per-feed intervals, Cloudflare Queue-powered fetching
- **🌙 Dark Mode** — System/light/dark themes
- **⌨️ Keyboard Shortcuts** — j/k navigate, s bookmark, l read later, r read/unread, ⌘\ toggle sidebar
- **🖥️ 3-Panel Layout** — Resizable sidebar, article list, reader
- **📱 PWA** — Install on any device, works offline, app shell cached
- **🔑 Nostr Login** — NIP-07 browser extension auth for passwordless login
- **🤖 AI Chat** — Ollama-powered chat about your feeds and articles

## Architecture

```
┌──────────────────┐     ┌───────────────────┐     ┌─────────────┐
│  Next.js 16 PWA  │────▶│  Hono API Worker  │────▶│ Cloudflare  │
│  (Cloudflare      │     │  api.rss.moikapy   │     │ D1 + KV     │
│   Workers)        │     │  .dev              │     │ + Queues    │
└──────────────────┘     └───────────────────┘     └─────────────┘
```

**Three-tier API:**
| Tier | Path | Auth | Cache |
|---|---|---|---|
| Public | `/api/public/*` | None | KV stale-while-revalidate |
| User | `/api/user/*` | Any JWT | No-store |
| Admin | `/api/admin/*` | Admin JWT | No-store |

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + Tailwind CSS 4 |
| API | Hono on Cloudflare Workers |
| Database | Cloudflare D1 (prod) / SQLite (dev) |
| ORM | Drizzle ORM |
| Auth | JWT via jose + PBKDF2 (Web Crypto) |
| Caching | Cloudflare KV |
| Feed Processing | Cloudflare Queues |
| AI | Ollama Cloud |
| Nostr | NIP-07 browser extension |
| Deploy | Cloudflare Workers + OpenNext |

## Quick Start

```bash
# Clone and install
git clone https://github.com/Moikapy/rss.git
cd rss
bun install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your JWT_SECRET

# Run development server
bun run dev

# Open http://localhost:3000
# First visit prompts account creation
```

## Development

```bash
bun run dev              # Web dev server
bun run build            # Build Next.js
bun run db:push          # Push schema to DB
```

### API Worker (local)

```bash
cd packages/0xrss-api

# Create .dev.vars with JWT_SECRET
cp .dev.vars.example .dev.vars

# Run with local D1
npx wrangler dev
```

## Deployment

### Frontend (Cloudflare Workers via OpenNext)

```bash
# Build and deploy
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy
```

### API Worker

```bash
cd packages/0xrss-api

# Create D1 database
npx wrangler d1 create 0xrss-db
# Update wrangler.toml with the database_id

# Apply migrations
npx wrangler d1 migrations apply 0xrss-db --remote

# Set secrets
npx wrangler secret put JWT_SECRET

# Deploy
npx wrangler deploy
```

### Custom Domain Setup

1. Frontend: `rss.moikapy.dev` → Cloudflare Worker `0xrss`
2. API: `api.rss.moikapy.dev` → Cloudflare Worker `0xrss-api`
3. Set `NEXT_PUBLIC_API_URL=https://api.rss.moikapy.dev` in `.env.production`

## PWA Support

0xRSS is a Progressive Web App:

- **Installable** — Add to home screen on iOS/Android/desktop
- **Offline-capable** — Service worker caches app shell and API responses
- **App-like** — Standalone display mode, no browser chrome
- **Theme-aware** — Matches system dark/light mode

The service worker uses a **network-first strategy** for API calls (fresh data with offline fallback) and **cache-first** for static assets.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `j` / `↓` | Next article |
| `k` / `↑` | Previous article |
| `s` | Toggle bookmark |
| `l` | Toggle read later |
| `r` | Toggle read/unread |
| `⇧R` | Refresh all feeds |
| `⌘\` | Toggle sidebar |

## Seeded Content

The app comes pre-loaded with 54 curated feeds across 6 folders:

| Folder | Feeds | Highlights |
|---|---|---|
| 🧠 AI | 17 | OpenAI, Google AI, HuggingFace, arXiv cs.AI, Anthropic, Claude, LangChain, Simon Willison, VentureBeat AI |
| 🎮 Gaming | 8 | IGN, Kotaku, Polygon, PC Gamer, Eurogamer, Rock Paper Shotgun, Game Developer |
| 💻 Technology | 9 | Ars Technica, The Verge, TechCrunch, Wired, Hacker News, MIT Tech Review, Engadget |
| 📰 News | 7 | BBC, The Guardian, NPR, AP News, Reuters, NYT |
| 🎭 Pop Culture | 7 | Vulture, A.V. Club, Pitchfork, Billboard, Variety, Hollywood Reporter |
| 📺 Anime | 6 | Anime News Network, Crunchyroll, MyAnimeList, MangaUpdates |

## Project Structure

```
├── src/                    # Next.js frontend
│   ├── app/               # App Router pages
│   ├── components/        # React components
│   │   ├── article/       # Article list + reader
│   │   ├── chat/          # AI chat panel
│   │   ├── feed/          # Feed management
│   │   ├── layout/        # Sidebar + header
│   │   └── providers/     # Auth, theme, SW providers
│   ├── lib/               # API client, auth, parsers
│   └── hooks/             # Custom React hooks
├── packages/0xrss-api/    # Hono API Worker
│   ├── src/
│   │   ├── routes/        # Public, admin, user, auth routes
│   │   ├── middleware/     # Cache, auth, rate-limit
│   │   ├── db/            # Drizzle schema + client
│   │   └── lib/           # Feed processor, password hashing, Nostr
│   └── wrangler.toml      # Worker config
├── public/                # Static assets + PWA files
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
└── wrangler.toml          # Frontend Worker config
```

## License

MIT