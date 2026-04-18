# 🐉 0xRSS

A personal RSS feed reader and manager — web app + Electron desktop app for Mac and Arch Linux.

## Features

- 🔒 **JWT Auth** — Single-user login with PBKDF2 password hashing
- 📰 **Feed Management** — Add RSS/Atom/JSON Feed URLs, auto-detect titles
- 📖 **Full Content Extraction** — Mozilla Readability + linkedom for in-app reading
- 📂 **Folders + Tags** — Organize feeds with folders and tags, filter across feeds
- ✅ **Full Triage** — Read/unread, bookmarks, read-later queue
- 🔍 **Full-Text Search** — FTS5 in SQLite, LIKE fallback for D1
- 📥 **OPML Import/Export** — Standard RSS subscription format
- 🔄 **Auto-Refresh** — Configurable per-feed intervals (5–120 min), manual refresh
- 🌙 **Dark Mode** — System/light/dark themes
- ⌨️ **Keyboard Shortcuts** — j/k navigate, s bookmark, l read later, r read/unread, ⌘\ toggle sidebar
- 🖥️ **Resizable 3-Panel Layout** — Sidebar, article list, reader with drag handles
- ✏️ **Feed Editing** — Edit title, folder, tags, refresh interval; delete feeds
- 📦 **Electron Desktop** — System tray, native notifications, auto-update

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Bun |
| Framework | Next.js 16 (App Router) |
| UI | Tailwind CSS 4 + shadcn/ui |
| ORM | Drizzle ORM |
| Dev DB | SQLite (better-sqlite3) |
| Prod DB | Cloudflare D1 |
| Auth | JWT via jose + PBKDF2 (Web Crypto) |
| Desktop | Electron 41 + electron-builder |
| Deploy | Cloudflare Pages/Workers |

## Quick Start

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Open http://localhost:3000
# First visit prompts account creation
```

## Development

```bash
bun run dev              # Web dev server
bun run build            # Build Next.js
bun run electron:dev     # Web + Electron
bun run db:push          # Push schema to DB
```

## Deployment

### Cloudflare

```bash
npx wrangler d1 create 0xrss-db
# Update wrangler.toml with the database_id
npx wrangler d1 migrations apply 0xrss-db --remote
npx wrangler pages secret put JWT_SECRET
bun run cf:deploy
```

See [docs/cloudflare-deployment.md](docs/cloudflare-deployment.md) for details.

### Electron Desktop

```bash
bun run electron:dist:mac      # macOS .dmg + .app
bun run electron:dist:linux    # Linux .AppImage + .pacman
```

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

## License

MIT