import { getDb } from "./client";
import { users } from "./schema";
import { sql } from "drizzle-orm";
import { initSearchIndex } from "./search";

/**
 * Initialize the database for development.
 * Creates tables, indexes, and FTS5 search index.
 * Called automatically on first getDb() invocation.
 * Safe to call multiple times (all statements use IF NOT EXISTS).
 */
export function initDevDb() {
  const db = getDb();

  // Create tables
  db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS feeds (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      site_url TEXT,
      description TEXT,
      folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
      refresh_interval INTEGER NOT NULL DEFAULT 30,
      auto_refresh INTEGER NOT NULL DEFAULT 1,
      last_fetched INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS feed_tags (
      feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (feed_id, tag_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      author TEXT,
      summary TEXT,
      content TEXT,
      published_at INTEGER NOT NULL,
      "read" INTEGER NOT NULL DEFAULT 0,
      bookmarked INTEGER NOT NULL DEFAULT 0,
      read_later INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  // Create indexes
  db.run(sql`CREATE INDEX IF NOT EXISTS articles_feed_id_idx ON articles(feed_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS articles_published_idx ON articles(published_at)`);
  db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS articles_feed_url_unique ON articles(feed_id, url)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS articles_read_idx ON articles("read")`);
  db.run(sql`CREATE INDEX IF NOT EXISTS articles_bookmarked_idx ON articles(bookmarked)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS articles_read_later_idx ON articles(read_later)`);

  // Initialize FTS5 search
  try {
    initSearchIndex();
  } catch {
    // FTS5 may already exist or not supported
  }

  console.log("✅ Dev database initialized");
}