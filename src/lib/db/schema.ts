import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

// Users
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // PBKDF2 hash
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Folders
export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Feeds
export const feeds = sqliteTable("feeds", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  siteUrl: text("site_url"),
  description: text("description"),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  refreshInterval: integer("refresh_interval").notNull().default(30), // minutes
  autoRefresh: integer("auto_refresh", { mode: "boolean" }).notNull().default(true),
  lastFetched: integer("last_fetched", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Tags
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

// Feed-Tags (many-to-many)
export const feedTags = sqliteTable("feed_tags", {
  feedId: text("feed_id").notNull().references(() => feeds.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.feedId, table.tagId] }),
]);

// Articles
export const articles = sqliteTable("articles", {
  id: text("id").primaryKey(),
  feedId: text("feed_id").notNull().references(() => feeds.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").notNull(),
  author: text("author"),
  summary: text("summary"),
  content: text("content"), // full article HTML
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  bookmarked: integer("bookmarked", { mode: "boolean" }).notNull().default(false),
  readLater: integer("read_later", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => [
  uniqueIndex("articles_feed_url_unique").on(table.feedId, table.url),
  index("articles_feed_id_idx").on(table.feedId),
  index("articles_published_idx").on(table.publishedAt),
  index("articles_read_idx").on(table.read),
  index("articles_bookmarked_idx").on(table.bookmarked),
  index("articles_read_later_idx").on(table.readLater),
]);