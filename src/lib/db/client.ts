import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { initDevDb } from "./init";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

function getDevDbPath(): string {
  const dbDir = path.join(process.cwd(), ".data");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  return path.join(dbDir, "0xrss.db");
}

// Dev: SQLite via better-sqlite3
export function createDevDb() {
  const dbPath = getDevDbPath();
  const sqlite = new Database(dbPath);
  // Enable WAL mode for better concurrent reads
  sqlite.pragma("journal_mode = WAL");
  // Enable foreign keys
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

let _db: ReturnType<typeof createDevDb> | null = null;
let _initialized = false;

export function getDb() {
  if (!_db) {
    _db = createDevDb();
  }
  // Auto-initialize schema on first call
  if (!_initialized) {
    _initialized = true;
    initDevDb();
  }
  return _db;
}

export type Database = ReturnType<typeof getDb>;