-- Migration: 0001_initial_schema
-- Compatible with both SQLite and Cloudflare D1

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Folders
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Feeds
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
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Feed-Tags (many-to-many)
CREATE TABLE IF NOT EXISTS feed_tags (
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (feed_id, tag_id)
);

-- Articles
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
);

-- Indexes
CREATE INDEX IF NOT EXISTS articles_feed_id_idx ON articles(feed_id);
CREATE INDEX IF NOT EXISTS articles_published_idx ON articles(published_at);
CREATE UNIQUE INDEX IF NOT EXISTS articles_feed_url_unique ON articles(feed_id, url);
CREATE INDEX IF NOT EXISTS articles_read_idx ON articles("read");
CREATE INDEX IF NOT EXISTS articles_bookmarked_idx ON articles(bookmarked);
CREATE INDEX IF NOT EXISTS articles_read_later_idx ON articles(read_later);