# 0xRSS — Specification

> A public RSS feed reader with private admin management, Nostr-based user accounts, local read tracking, and AI chat via Ollama Cloud. Deployed on Cloudflare (Pages + Workers + D1 + KV + Queues).

## 1. Overview

### 1.1 Purpose

0xRSS is a personal RSS feed aggregator at `rss.moikapy.dev` with three distinct user experiences:
1. **Public readers** — Anyone can browse curated feeds and articles, cached at the edge. Read state tracked locally via IndexedDB.
2. **Registered users** — Create a Nostr-derived identity (or classic username/password), store their Ollama Cloud API key for AI chat, and export/port their account securely.
3. **The admin** (you, Moikapy) — Manages feeds, folders, tags at `/admin`. Only one admin account exists in D1.

### 1.2 Target Users

- **Moikapy** — The admin who curates and manages RSS subscriptions
- **Public visitors** — Readers who want to browse a curated RSS feed list without creating an account
- **Nostr users** — Tech-savvy readers who want AI chat, local bookmarks, and portable accounts

### 1.3 Out of Scope (v1)

- Multiple admins — v1 has a single admin account
- User-generated RSS feeds — only the admin adds feeds
- Full-text search (Meilisearch/Typesense) — basic SQL LIKE search only
- Real-time WebSocket feed updates
- Mobile native app
- Email notifications
- Social features (sharing, commenting, following other users)
- Nostr event posting — Nostr identity is for auth only
- Self-hosted Ollama support — Cloud API only

### 1.4 Design Principles

| Principle | Guideline |
|-----------|-----------|
| Public-first | All feed data is public and cached. Auth is for management and personalization only. |
| Nostr-native | User identity derives from Nostr keys. No user PII stored server-side. |
| Local state | Read/bookmark state lives in IndexedDB. Server doesn't track per-user article state. |
| Edge-cached | Public routes use KV cache with stale-while-revalidate. Only admin routes hit D1 on every request. |
| Minimal DB | D1 stores admin account, feeds, articles, folders, tags. KV stores user configs. Zero user PII in D1. |
| Portable accounts | Users can export their identity + settings as an encrypted blob. Login anywhere. |

## 2. Package

Monorepo structure (unchanged):

```
rss/
├── packages/0xrss-api/    # Hono Worker (api.rss.moikapy.dev)
├── src/                   # Next.js 16 frontend (rss.moikapy.dev)
└── docs/                  # Cloudflare deployment docs
```

### Frontend Exports

| Export | Path | Description |
|--------|------|-------------|
| `src/app/(public)/` | `/` | Public feed reader (no auth required) |
| `src/app/(auth)/` | `/login`, `/register` | Account creation/login |
| `src/app/(admin)/` | `/admin/*` | Feed management (admin only) |

### API Worker Exports

| Route | Auth | Cache | Description |
|-------|------|-------|-------------|
| `GET /api/public/*` | None | KV 60s | Public feed/article data |
| `GET /api/admin/*` | Admin JWT | None | Admin management |
| `POST /api/auth/*` | None | None | Account creation/login |
| `GET /api/user/*` | User JWT | None | Per-user settings |
| `POST /api/chat` | User JWT | None | AI chat (Ollama Cloud) |

## 3. Client API

### 3.1 Public API (no auth)

```typescript
// GET /api/public/feeds — cached 60s
interface PublicFeed {
  id: string
  title: string
  url: string           // feed XML URL
  siteUrl: string | null
  description: string | null
  folderId: string | null
  folderName: string | null
  tagNames: string[]
  articleCount: number
  lastFetched: string | null  // ISO date
}

// GET /api/public/articles?feedId=&limit=50&offset=0 — cached 60s
interface PublicArticle {
  id: string
  feedId: string
  feedTitle: string
  title: string
  url: string
  author: string | null
  summary: string | null
  publishedAt: string    // ISO date
}

// GET /api/public/articles/:id — cached 60s
interface PublicArticleDetail extends PublicArticle {
  content: string | null
}

// GET /api/public/folders — cached 300s
interface PublicFolder {
  id: string
  name: string
  feedCount: number
}

// GET /api/public/tags — cached 300s
interface PublicTag {
  id: string
  name: string
  feedCount: number
}
```

### 3.2 Auth API

```typescript
// POST /api/auth/register — creates a Nostr-derived account
interface RegisterRequest {
  method: "nostr" | "password"
  // For nostr method:
  pubkey?: string        // hex pubkey from NIP-07 extension or NIP-46 bunker
  signedEvent?: object   // NIP-98 event proving key ownership
  // For password method:
  username?: string
  password?: string
}
interface RegisterResponse {
  token: string          // JWT
  pubkey: string | null  // Nostr hex pubkey (if nostr method)
  username: string | null
  encryptedExport: string // Encrypted account blob for backup
}

// POST /api/auth/login
interface LoginRequest {
  method: "nostr" | "password"
  pubkey?: string
  signedEvent?: object
  username?: string
  password?: string
}
interface LoginResponse {
  token: string
  pubkey: string | null
  username: string | null
}

// GET /api/auth/me
interface AuthMeResponse {
  authenticated: boolean
  method: "nostr" | "password" | null
  pubkey: string | null
  username: string | null
}
```

### 3.3 User API (requires user JWT)

```typescript
// GET /api/user/settings
interface UserSettings {
  ollamaApiKey: string | null  // masked (last 4 chars only)
  ollamaModel: string          // default: "gpt-oss:120b"
  theme: "light" | "dark" | "system"
}

// POST /api/user/settings
interface UpdateSettingsRequest {
  ollamaApiKey?: string
  ollamaModel?: string
  theme?: "light" | "dark" | "system"
}

// GET /api/user/export — returns encrypted account blob
interface ExportResponse {
  data: string          // encrypted JSON blob
  version: number       // export format version
}

// POST /api/user/import — restore from encrypted blob
interface ImportRequest {
  data: string          // encrypted blob from export
}

// POST /api/chat — AI chat with user's Ollama key or server default
interface ChatRequest {
  messages: { role: string; content: string }[]
  model?: string
  feedId?: string
  articleId?: string
}
```

### 3.4 Admin API (requires admin JWT)

```typescript
// All existing /api/feeds, /api/folders, /api/tags, /api/articles CRUD routes
// moved under /api/admin/ prefix

// GET /api/admin/feeds
// POST /api/admin/feeds
// PATCH /api/admin/feeds/:id
// DELETE /api/admin/feeds/:id
// GET /api/admin/folders
// POST /api/admin/folders
// etc.

// Cron trigger (admin only)
// POST /api/admin/fetch-feeds
```

## 4. Types

### Nostr Identity

```typescript
/** A Nostr account is identified purely by pubkey. No password stored. */
interface NostrIdentity {
  pubkey: string         // 64-char hex secp256k1 public key
  created: string        // ISO date first seen
  lastLogin: string      // ISO date
}
```

### Auth Token Payload

```typescript
interface AdminTokenPayload {
  sub: string            // admin user ID (from D1)
  role: "admin"
  iat: number
  exp: number
}

interface UserTokenPayload {
  sub: string            // pubkey (hex) or "user:{id}"
  role: "user"
  method: "nostr" | "password"
  iat: number
  exp: number
}
```

### Local State (IndexedDB)

```typescript
// Stored in IndexedDB "0xrss-local" on the client
interface LocalArticleState {
  articleId: string
  read: boolean
  bookmarked: boolean
  readLater: boolean
  readAt: string | null    // ISO date
}

interface LocalDBSchema {
  articleStates: LocalArticleState  // key: articleId
  userSettings: {                    // single row
    ollamaApiKey?: string            // only if not synced to server
    theme: "light" | "dark" | "system"
  }
}
```

### Encrypted Export Blob

```typescript
// The encrypted blob contains:
interface ExportPayload {
  version: 1
  pubkey: string | null
  username: string | null
  ollamaApiKey: string | null
  ollamaModel: string
  theme: string
  localState: LocalArticleState[]  // all read/bookmark states
}

// Encrypted with AES-256-GCM, key derived from user's password via PBKDF2
// For Nostr users: key derived from a passphrase they provide at export time
// Format: base64(salt:iv:ciphertext)
```

## 5. Upstream API Reference

### 5.1 Platform

- **Frontend**: Next.js 16 on Cloudflare Workers (via @opennextjs/cloudflare)
- **API**: Hono on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV
- **Queue**: Cloudflare Queues (feed-fetch-queue)
- **AI**: Ollama Cloud API (api.ollama.com)

### 5.2 Base URLs

| Service | URL |
|---------|-----|
| Frontend | `https://rss.moikapy.dev` |
| API Worker | `https://api.rss.moikapy.dev` |
| Ollama Cloud | `https://api.ollama.com` (with Bearer token) |

### 5.3 Endpoint Map

| Route | HTTP | Auth | Cache | Response | Notes |
|-------|------|------|-------|----------|-------|
| `/api/public/feeds` | GET | None | KV 60s | JSON | All feeds with folder/tag info |
| `/api/public/articles` | GET | None | KV 60s | JSON | Paginated, filterable |
| `/api/public/articles/:id` | GET | None | KV 60s | JSON | Single article with content |
| `/api/public/folders` | GET | None | KV 300s | JSON | Folders with feed counts |
| `/api/public/tags` | GET | None | KV 300s | JSON | Tags with feed counts |
| `/api/auth/register` | POST | None | None | JSON | Create Nostr or password account |
| `/api/auth/login` | POST | None | None | JSON | Login, returns JWT |
| `/api/auth/me` | GET | User/Admin JWT | None | JSON | Current identity |
| `/api/user/settings` | GET | User JWT | None | JSON | User's Ollama config |
| `/api/user/settings` | POST | User JWT | None | JSON | Update Ollama config |
| `/api/user/export` | GET | User JWT | None | JSON blob | Encrypted account export |
| `/api/user/import` | POST | User JWT | None | JSON | Restore from export |
| `/api/chat` | POST | User JWT | None | SSE/JSON | AI chat stream |
| `/api/chat/health` | GET | User JWT | None | JSON | Ollama connectivity check |
| `/api/admin/feeds` | GET/POST | Admin JWT | None | JSON | Feed CRUD |
| `/api/admin/feeds/:id` | GET/PATCH/DEL | Admin JWT | None | JSON | Single feed CRUD |
| `/api/admin/folders` | GET/POST | Admin JWT | None | JSON | Folder CRUD |
| `/api/admin/tags` | GET/POST | Admin JWT | None | JSON | Tag CRUD |
| `/api/admin/articles` | GET | Admin JWT | None | JSON | Article management |
| `/api/admin/fetch-feeds` | POST | Admin JWT | None | JSON | Trigger feed fetch |
| `/api/health` | GET | None | None | JSON | Health check |

## 6. Parsers

No HTML parsing needed — all upstream data is from our own D1 database or Ollama Cloud API.

### Ollama Cloud Chat Response

- **Input**: Ollama Cloud API JSON response (`/api/chat`)
- **Output**: Normalized chat response or SSE stream
- **Strategy**: Forward Ollama response fields; normalize error codes (401 → "needs API key", 429 → "rate limited")

### NIP-07 Event Verification

- **Input**: `window.nostr.signEvent(event)` result from browser extension
- **Output**: Verified pubkey (hex string)
- **Strategy**: Verify `sig` field against `pubkey` + event content using `secp256k1` (noble-secp256k1). Extract `pubkey` as the user identity.

### NIP-46 Bunker Connection

- **Input**: `bunker://<pubkey>?relay=...&secret=...` URI
- **Output**: Verified user pubkey
- **Strategy**: Connect to relay, send connect request via NIP-44 encrypted DM, call `get_public_key`, verify response. Fallback if no extension available.

## 7. Constants

```typescript
// KV cache TTLs (seconds)
const CACHE_TTL = {
  PUBLIC_FEEDS: 60,
  PUBLIC_ARTICLES: 60,
  PUBLIC_ARTICLE_DETAIL: 60,
  PUBLIC_FOLDERS: 300,
  PUBLIC_TAGS: 300,
} as const

// D1 table names
const TABLES = {
  USERS: "users",        // admin only (single row)
  FEEDS: "feeds",
  ARTICLES: "articles",
  FOLDERS: "folders",
  TAGS: "tags",
  FEED_TAGS: "feed_tags",
} as const

// KV key patterns
const KV_KEYS = {
  PUBLIC_CACHE: (path: string) => `pub:${path}`,
  USER_OLLAMA: (pubkey: string) => `ollama:${pubkey}`,
  USER_SETTINGS: (pubkey: string) => `settings:${pubkey}`,
} as const

// Nostr
const NOSTR_KINDS = {
  NIP46_REQUEST: 24133,
  NIP46_RESPONSE: 24133,
  NIP98_AUTH: 27235,
} as const

// Default Ollama config
const DEFAULT_OLLAMA = {
  HOST: "https://api.ollama.com",
  CHAT_MODEL: "gpt-oss:120b",
} as const
```

## 8. Error Handling

### 8.1 Error Response Format

```typescript
interface ApiError {
  error: string          // human-readable message
  code?: string          // machine-readable code
  details?: unknown      // additional context
}
```

### 8.2 Behavior Table

| Scenario | HTTP | Code | Behavior |
|----------|------|------|----------|
| No auth token on protected route | 401 | `unauthorized` | Return error, frontend redirects to login |
| Invalid/expired JWT | 401 | `token_expired` | Return error, frontend clears token |
| Admin route accessed by non-admin | 403 | `forbidden` | Return error |
| Invalid NIP-07 signature | 401 | `invalid_signature` | Return error, prompt re-sign |
| NIP-46 bunker unreachable | 502 | `bunker_unreachable` | Return error, suggest NIP-07 fallback |
| Ollama 401 (no API key) | 401 | `ollama_needs_key` | Return error, prompt to set API key |
| Ollama 429 (rate limited) | 429 | `ollama_rate_limited` | Return error with retry-after |
| Feed URL already exists | 409 | `duplicate_feed` | Return error |
| Invalid feed URL | 400 | `invalid_url` | Return error |
| Export passphrase too short | 400 | `weak_passphrase` | Return error (min 8 chars) |
| Failed to decrypt import | 400 | `decrypt_failed` | Return error (wrong passphrase) |
| Cache miss on public route | — | — | Fetch from D1, populate cache, return |

## 9. Caching

### Strategy: KV Cache with `stale-while-revalidate`

All `/api/public/*` routes read from KV first. If cache exists, return immediately and trigger background revalidation. If no cache, fetch from D1 synchronously.

| Route | TTL | Rationale |
|-------|-----|-----------|
| `/api/public/feeds` | 60s | Feeds change rarely but cron fetches every 30 min; 60s keeps it fresh |
| `/api/public/articles` | 60s | New articles appear every few minutes via cron; 60s is acceptable |
| `/api/public/articles/:id` | 60s | Article content doesn't change after publish |
| `/api/public/folders` | 300s | Folder structure almost never changes |
| `/api/public/tags` | 300s | Tags almost never change |

### Cache Invalidation

Admin mutations (add/delete feed, update folder/tag) **delete** relevant KV keys after the D1 write. This ensures the next public request rebuilds the cache.

### Cache Key Format

```
pub:/api/public/feeds
pub:/api/public/articles?feedId=abc&limit=50&offset=0
pub:/api/public/articles/:id
pub:/api/public/folders
pub:/api/public/tags
```

## 10. Rate Limiting

No server-side rate limiting in v1 (Cloudflare handles DDoS). Client-side:

- Auto-refresh interval: 5 minutes minimum
- Chat: 1 request at a time (disable send button until response)
- Feed fetch: 1 request per click

## 11. Testing Strategy

### 11.1 Fixtures

| File | Content |
|------|---------|
| `feeds.json` | 5 sample feeds with folder/tag assignments |
| `articles.json` | 10 sample articles across feeds |
| `nip07-event.json` | Sample signed NIP-07 event for auth test |
| `ollama-response.json` | Sample Ollama Cloud chat response |

### 11.2 Unit Tests

- JWT sign/verify for admin vs user tokens
- NIP-07 event signature verification
- AES-256-GCM encrypt/decrypt for account export
- KV cache hit/miss/revalidation logic
- Public route cache key derivation
- Admin middleware blocks non-admin JWTs

### 11.3 Integration Tests

- Login flow (Nostr + password)
- Public routes return cached data
- Admin CRUD invalidates cache
- Chat with Ollama Cloud (mocked)
- Account export → import round-trip

## 12. Project Structure

```
packages/0xrss-api/
├── src/
│   ├── index.ts              # Hono app, route definitions
│   ├── routes/
│   │   ├── public.ts         # GET /api/public/* routes
│   │   ├── auth.ts           # POST /api/auth/* routes
│   │   ├── user.ts           # GET/POST /api/user/* routes
│   │   ├── admin.ts          # Admin CRUD routes
│   │   └── chat.ts           # POST /api/chat, GET /api/chat/health
│   ├── middleware/
│   │   ├── auth.ts           # JWT extraction (Bearer + cookie)
│   │   ├── admin.ts         # Admin role check
│   │   └── cache.ts          # KV cache read/write/revalidate
│   ├── lib/
│   │   ├── auth.ts           # JWT sign/verify with jose
│   │   ├── nostr.ts          # NIP-07/NIP-46 verification
│   │   ├── ollama.ts         # Ollama Cloud client
│   │   ├── crypto.ts         # AES-256-GCM for account export
│   │   └── password.ts       # PBKDF2 hashing (admin + password users)
│   ├── db/
│   │   ├── client.ts          # Drizzle D1 client
│   │   └── schema.ts          # Drizzle schema
│   └── types.ts              # Bindings, Variables, interfaces
├── drizzle/
│   └── 0000_*.sql            # Migrations
├── wrangler.toml
├── package.json
└── tsconfig.json

src/                           # Next.js frontend
├── app/
│   ├── (public)/             # No auth required
│   │   ├── page.tsx          # Public feed reader
│   │   └── article/[id]/     # Article detail
│   ├── (auth)/               # Login/register
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (admin)/              # Admin only (JWT + role check)
│   │   ├── page.tsx          # Admin dashboard
│   │   ├── feeds/page.tsx    # Feed management
│   │   └── settings/page.tsx # Admin settings
│   └── layout.tsx
├── components/
│   ├── article/              # Article list, reader
│   ├── chat/                 # AI chat panel
│   ├── feed/                 # Feed cards, edit dialog
│   ├── layout/              # Sidebar, topbar, statusbar
│   ├── providers/           # Auth, theme, indexeddb
│   └── ui/                   # Design system components
├── hooks/
│   ├── use-local-article-state.ts  # IndexedDB read/bookmark tracking
│   ├── use-auto-refresh.ts
│   └── use-keyboard-shortcuts.ts
├── lib/
│   ├── api/client.ts         # apiFetch, apiUpload, authHeaders, apiUrl
│   ├── db/                   # IndexedDB setup
│   │   └── indexeddb.ts      # idb-keyval or Dexie wrapper
│   ├── nostr/
│   │   ├── nip07.ts          # window.nostr integration
│   │   └── nip46.ts          # Bunker connection
│   └── crypto.ts             # AES-256-GCM for export/import
└── types/
    └── index.d.ts
```

## 13. Usage Examples

### Example 1: Public visitor browsing feeds

```typescript
// Visitor arrives at rss.moikapy.dev — no account needed
// Frontend calls:
const feeds = await apiFetch<PublicFeed[]>("/api/public/feeds");
const articles = await apiFetch<PublicArticle[]>("/api/public/articles?limit=25");

// User clicks an article — read state tracked locally
await localDB.put("articleStates", { articleId: "abc", read: true, readAt: new Date().toISOString() });
```

### Example 2: Nostr user registration + AI chat

```typescript
// User clicks "Sign in with Nostr"
const pubkey = await window.nostr.getPublicKey();
const event = await window.nostr.signEvent({
  kind: 27235,  // NIP-98
  content: "Login to 0xRSS",
  created_at: Math.floor(Date.now() / 1000),
  tags: [["u", "https://rss.moikapy.dev"]],
});

const { token } = await apiFetch<{ token: string }>("/api/auth/register", {
  method: "POST",
  body: JSON.stringify({ method: "nostr", pubkey, signedEvent: event }),
});

// Store token, then set Ollama key
localStorage.setItem(TOKEN_KEY, token);
await apiFetch("/api/user/settings", {
  method: "POST",
  body: JSON.stringify({ ollamaApiKey: "ollama-abc123", ollamaModel: "gpt-oss:120b" }),
});

// Chat with AI about an article
const response = await fetch(apiUrl("/api/chat"), {
  method: "POST",
  headers: { ...authHeaders(), "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Summarize this article" }], articleId: "abc" }),
});
```

### Example 3: Admin adding a feed + cache invalidation

```typescript
// Admin at rss.moikapy.dev/admin
const result = await apiFetch<{ id: string; success: boolean }>("/api/admin/feeds", {
  method: "POST",
  body: JSON.stringify({ url: "https://blog.example.com/feed.xml", title: "Example Blog", folderId: "tech" }),
});

// API Worker: inserts into D1, then deletes KV cache keys
// Next public request rebuilds cache from D1
```

### Example 4: Account export and import on another device

```typescript
// Export
const exportData = await apiFetch<{ data: string; version: number }>("/api/user/export");

// User saves the encrypted blob. Later, on another device:
await apiFetch("/api/user/import", {
  method: "POST",
  body: JSON.stringify({ data: exportData.data }),
});

// Account restored — Ollama key, read states, all settings ported over
```

### Example 5: Password-based user (no Nostr)

```typescript
// Register
const { token, encryptedExport } = await apiFetch<{ token: string; encryptedExport: string }>(
  "/api/auth/register",
  { method: "POST", body: JSON.stringify({ method: "password", username: "alice", password: "secure-pass" }) }
);

// The encryptedExport blob is their backup — store it safely
// Login later
const { token } = await apiFetch<{ token: string }>("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ method: "password", username: "alice", password: "secure-pass" }),
});
```

## 14. Security & Ethics

### 14.1 Data Sensitivity

| Data | Sensitivity | Storage | Notes |
|------|------------|---------|-------|
| Admin password hash | High | D1 | PBKDF2, never returned in API |
| Admin JWT | High | Cookie/localStorage | HttpOnly cookie + Bearer token |
| User Nostr pubkey | Low (public by nature) | KV | Nostr pubkeys are public |
| User Ollama API key | High | KV | Encrypted at rest, masked in GET |
| User read state | Low | IndexedDB (local) | Never sent to server |
| Export blob | High | User device | AES-256-GCM encrypted with passphrase |
| Feed URLs | Public | D1 + KV cache | Curated by admin, publicly readable |
| Article content | Public | D1 + KV cache | From RSS feeds, publicly readable |

### 14.2 Auth Design

- **Admin**: Single account in D1. JWT with `role: "admin"`. Password login only.
- **Nostr users**: Identity is their `pubkey`. No password stored server-side. Auth via NIP-07 signed event. JWT with `role: "user", method: "nostr"`.
- **Password users**: Username + hashed password in KV (not D1 — avoids PII in DB). JWT with `role: "user", method: "password"`.
- **Account export**: AES-256-GCM encrypted with user-provided passphrase. PBKDF2 key derivation (600k iterations). The blob contains everything needed to restore on another device.

### 14.3 No PII in D1

The D1 database contains ZERO user personal information. It only has:
- Admin account (single row, password hashed)
- Feeds, articles, folders, tags (public content)

User data (pubkeys, usernames, Ollama keys, settings) lives exclusively in KV, keyed by pubkey.

## 15. Changelog & Versioning

### v1.0.0 (Current Scope)

- Public feed reader with KV caching
- Admin CRUD for feeds/folders/tags
- Nostr NIP-07 login
- Password login
- Ollama Cloud AI chat
- IndexedDB local read tracking
- Account export/import (encrypted)

### v1.1 (Planned)

- NIP-46 bunker login (remote signing)
- OPML import/export for admin
- Full-text search (SQL FTS5)
- Feed fetch queue implementation

### v2.0 (Future)

- Real-time feed updates via WebSocket
- Multiple admin accounts
- User-curated feed lists
- Mobile PWA

## 16. Dependencies

### API Worker

| Package | Type | Purpose |
|---------|------|---------|
| hono | Runtime | HTTP framework |
| drizzle-orm | Runtime | D1 query builder |
| jose | Runtime | JWT sign/verify |
| @noble/secp256k1 | Runtime | NIP-07 signature verification |
| @noble/hashes | Runtime | SHA-256 for Nostr event IDs |

### Frontend

| Package | Type | Purpose |
|---------|------|---------|
| next | Runtime | Framework |
| react | Runtime | UI |
| idb | Runtime | IndexedDB wrapper (local read state) |
| next-themes | Runtime | Dark/light mode |
| lucide-react | Runtime | Icons |
| @noble/secp256k1 | Runtime | Nostr event verification (if doing client-side verify) |

### Dev

| Package | Type | Purpose |
|---------|------|---------|
| wrangler | Dev | Cloudflare Workers CLI |
| drizzle-kit | Dev | D1 migrations |
| typescript | Dev | Type checking |
| tailwindcss | Dev | Styling |

---

*Spec generated with kapy-spec skill. Ready for implementation review.*