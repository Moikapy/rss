import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables } from "./types";
import { publicRoutes } from "./routes/public";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { feeds } from "./db/schema";
import { eq } from "drizzle-orm";
import { createDb } from "./db/client";
import { processFeed } from "./lib/feed-processor";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── CORS ────────────────────────────────────────────────────────────────
app.use("*", cors({
  origin: ["https://rss.moikapy.dev", "https://api.rss.moikapy.dev", "https://0xrss.moikapy.workers.dev", "http://localhost:3000"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "Cookie"],
  credentials: true,
  maxAge: 86400,
}));

// ─── Health (public, no cache) ──────────────────────────────────────────
app.get("/api/health", (c) => c.json({ ok: true, version: "0.2.0" }));

// ─── All routes are self-contained with their own middleware ────────────────
app.route("/", publicRoutes);
app.route("/", authRoutes);
app.route("/", userRoutes);
app.route("/", adminRoutes);

// ─── Export handler ───────────────────────────────────────────────────────
export default {
  fetch: app.fetch,

  scheduled: async (controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil((async () => {
      const db = createDb(env.DB);
      const allFeeds = await db.select().from(feeds).all();
      for (const feed of allFeeds) {
        if (!feed.autoRefresh) continue;
        if (feed.lastFetched) {
          const elapsed = Date.now() - feed.lastFetched.getTime();
          const intervalMs = feed.refreshInterval * 60 * 1000;
          if (elapsed < intervalMs) continue;
        }
        await env.FEED_QUEUE.send({ feedId: feed.id });
      }
    })());
  },

  queue: async (batch: MessageBatch, env: Bindings) => {
    for (const message of batch.messages) {
      const { feedId } = message.body as { feedId: string };
      try {
        const result = await processFeed(feedId, env);
        console.log(`Feed ${feedId}: ${result.newArticles} new articles, ${result.errors.length} errors`);
        message.ack();
      } catch (err: any) {
        console.error(`Feed ${feedId} processing failed:`, err.message);
        message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Bindings>;