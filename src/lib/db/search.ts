import { sql } from "drizzle-orm";
import { getDb } from "./client";

/**
 * Initialize FTS5 virtual table and triggers for local SQLite.
 * This is only called in dev — D1 doesn't support FTS5.
 */
export function initSearchIndex() {
  const db = getDb();

  // Create FTS5 virtual table
  db.run(sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
      title,
      summary,
      content,
      content=articles,
      content_rowid=rowid
    )
  `);

  // Trigger: sync on insert
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
      INSERT INTO articles_fts(rowid, title, summary, content)
      VALUES (new.rowid, new.title, new.summary, new.content);
    END
  `);

  // Trigger: sync on update
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, summary, content)
      VALUES ('delete', old.rowid, old.title, old.summary, old.content);
      INSERT INTO articles_fts(rowid, title, summary, content)
      VALUES (new.rowid, new.title, new.summary, new.content);
    END
  `);

  // Trigger: sync on delete
  db.run(sql`
    CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, summary, content)
      VALUES ('delete', old.rowid, old.title, old.summary, old.content);
    END
  `);
}