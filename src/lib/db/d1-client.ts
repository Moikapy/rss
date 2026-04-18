/**
 * Database adapter for Cloudflare D1 production environment.
 * Used when the app runs on Cloudflare Workers/Pages.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function createD1Client(d1Binding: D1Database) {
  return drizzle(d1Binding, { schema });
}

export type D1Client = ReturnType<typeof createD1Client>;