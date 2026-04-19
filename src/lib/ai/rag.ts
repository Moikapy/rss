import { sql, eq, desc, and, like } from "drizzle-orm";
import { getDatabase } from "@/lib/db/get-db";
import { articles, feeds } from "@/lib/db/schema";
import { embedText, embedBatch, cosineSimilarity } from "./ollama";

export interface SearchResult {
  articleId: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
  publishedAt: Date;
  feedTitle?: string;
  feedId?: string;
  method: "fts" | "embedding" | "like" | "hybrid";
}

/**
 * Search articles using a multi-strategy approach:
 * 1. FTS5 full-text search (fast, precise, content-indexed)
 * 2. Embedding similarity (semantic, fuzzy matching)
 * 3. LIKE keyword fallback (for when FTS5/embeddings unavailable)
 * 4. Reciprocal Rank Fusion to merge results
 */
export async function searchArticles(
  query: string,
  options: {
    limit?: number;
    feedId?: string;
    /** If true, skip embedding search (only FTS + LIKE) */
    skipEmbeddings?: boolean;
  } = {}
): Promise<SearchResult[]> {
  const { limit = 8, feedId, skipEmbeddings = false } = options;
  const db = await getDatabase();

  const ftsResults = await ftsSearch(db, query, limit * 2, feedId);
  const likeResults = await likeSearch(db, query, limit * 2, feedId);
  const embedResults = skipEmbeddings
    ? []
    : await embeddingSearch(db, query, limit * 2, feedId);

  // Reciprocal Rank Fusion: merge all result sets
  const fused = reciprocalRankFusion(
    { results: ftsResults, weight: 1.2 }, // FTS is most precise, boost it
    { results: likeResults, weight: 0.6 }, // LIKE is noisy, lower weight
    { results: embedResults, weight: 1.0 } // Embeddings are semantic, medium weight
  );

  // Enrich with feed titles
  const feedIds = [...new Set(fused.map((r) => r.feedId).filter(Boolean))] as string[];
  const feedMap = new Map<string, string>();
  if (feedIds.length > 0) {
    const feedRows = await db.select({ id: feeds.id, title: feeds.title })
      .from(feeds)
      .where(sql`${feeds.id} IN (${sql.join(feedIds.map((id) => sql`${id}`), sql`, `)})`)
      .all();
    for (const f of feedRows) {
      feedMap.set(f.id, f.title);
    }
  }

  return fused.slice(0, limit).map((r) => ({
    ...r,
    feedTitle: r.feedId ? feedMap.get(r.feedId) : undefined,
  }));
}

// ─── Strategy 1: FTS5 ──────────────────────────────────────────────────────

async function ftsSearch(
  db: ReturnType<typeof getDatabase> extends Promise<infer T> ? T : never,
  query: string,
  limit: number,
  feedId?: string
): Promise<SearchResult[]> {
  try {
    // Escape special FTS5 characters and build query
    const ftsQuery = query
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => `"${w.replace(/"/g, '""')}"`)
      .join(" OR ");

    if (!ftsQuery) return [];

    const feedFilter = feedId ? sql` AND a.feed_id = '${feedId}'` : sql``;

    const rows = await db.all(sql`
      SELECT a.id, a.title, a.url, a.summary, a.content, a.published_at, a.feed_id,
             f.title as feed_title,
             fts.rank
      FROM articles a
      LEFT JOIN feeds f ON a.feed_id = f.id
      JOIN articles_fts fts ON a.rowid = fts.rowid
      WHERE articles_fts MATCH ${ftsQuery}${feedFilter}
      ORDER BY fts.rank
      LIMIT ${limit}
    `) as any[];

    return rows.map((row) => ({
      articleId: row.id,
      title: row.title,
      url: row.url,
      snippet: extractSnippet(row.summary || stripHtml(row.content || ""), query),
      score: Math.exp(-row.rank / 10), // Normalize BM25 rank to 0-1ish
      publishedAt: new Date(row.published_at),
      feedTitle: row.feed_title,
      feedId: row.feed_id,
      method: "fts" as const,
    }));
  } catch {
    // FTS5 not available (D1) or query syntax error
    return [];
  }
}

// ─── Strategy 2: LIKE keyword search ────────────────────────────────────────

async function likeSearch(
  db: ReturnType<typeof getDatabase> extends Promise<infer T> ? T : never,
  query: string,
  limit: number,
  feedId?: string
): Promise<SearchResult[]> {
  const keywords = query
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.toLowerCase());

  if (keywords.length === 0) return [];

  // Each keyword must match in title OR summary (OR across fields, AND across keywords scored higher)
  const conditions = keywords.map((kw) =>
    sql`(${sql`${articles.title}`} LIKE ${`%${kw}%`} OR ${sql`${articles.summary}`} LIKE ${`%${kw}%`} OR ${sql`${articles.content}`} LIKE ${`%${kw}%`})`
  );

  const whereClause = conditions.length > 0
    ? sql`(${sql.join(conditions, sql` OR `)})`
    : undefined;

  const feedCondition = feedId ? eq(articles.feedId, feedId) : undefined;
  const finalWhere = feedCondition && whereClause
    ? and(feedCondition, whereClause)
    : whereClause || feedCondition;

  try {
    const rows = finalWhere
      ? await db.select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          summary: articles.summary,
          content: articles.content,
          publishedAt: articles.publishedAt,
          feedId: articles.feedId,
        })
          .from(articles)
          .where(finalWhere)
          .orderBy(desc(articles.publishedAt))
          .limit(limit)
          .all()
      : [];

    return rows.map((row: any) => {
      const matchCount = countKeywordMatches(
        `${row.title} ${row.summary || ""}`,
        keywords
      );
      return {
        articleId: row.id,
        title: row.title,
        url: row.url,
        snippet: extractSnippet(row.summary || stripHtml(row.content || ""), query),
        score: 0.3 + (matchCount / keywords.length) * 0.4, // 0.3-0.7 based on keyword coverage
        publishedAt: new Date(row.publishedAt),
        feedId: row.feedId,
        method: "like" as const,
      };
    });
  } catch {
    return [];
  }
}

// ─── Strategy 3: Embedding search ──────────────────────────────────────────

async function embeddingSearch(
  db: ReturnType<typeof getDatabase> extends Promise<infer T> ? T : never,
  query: string,
  limit: number,
  feedId?: string
): Promise<SearchResult[]> {
  try {
    const queryEmbedding = await embedText(query);

    const conditions = [sql`${articles.content} IS NOT NULL`];
    if (feedId) {
      conditions.push(eq(articles.feedId, feedId));
    }

    const candidates = await db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        content: articles.content,
        summary: articles.summary,
        publishedAt: articles.publishedAt,
        feedId: articles.feedId,
      })
      .from(articles)
      .where(and(...conditions))
      .orderBy(desc(articles.publishedAt))
      .limit(200)
      .all();

    if (candidates.length === 0) return [];

    const texts = candidates.map(
      (a: any) => `${a.title}. ${a.summary || ""}`.substring(0, 500)
    );
    const embeddings = await embedBatch(texts);

    const scored = candidates.map((article: any, i: number) => ({
      article,
      score: cosineSimilarity(queryEmbedding, embeddings[i]),
    }));

    // Filter out low-relevance results
    return scored
      .filter(({ score }: { score: number }) => score > 0.3)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, limit)
      .map(({ article, score }: { article: any; score: number }) => ({
        articleId: article.id,
        title: article.title,
        url: article.url,
        snippet: extractSnippet(
          article.summary || stripHtml(article.content || ""),
          query
        ),
        score,
        publishedAt: new Date(article.publishedAt),
        feedId: article.feedId,
        method: "embedding" as const,
      }));
  } catch {
    return [];
  }
}

// ─── Reciprocal Rank Fusion ─────────────────────────────────────────────────

interface RankedResults {
  results: SearchResult[];
  weight: number;
}

/**
 * Merge multiple result sets using Reciprocal Rank Fusion.
 * Each result set contributes a score based on its rank position,
 * weighted by the strategy's confidence level.
 */
function reciprocalRankFusion(...sets: RankedResults[]): SearchResult[] {
  const K = 60; // Standard RRF constant
  const scores = new Map<string, { total: number; best: SearchResult }>();

  for (const { results, weight } of sets) {
    results.forEach((result, rank) => {
      const existing = scores.get(result.articleId);
      const rrfScore = weight / (K + rank + 1);

      if (existing) {
        existing.total += rrfScore;
        // Keep the result from the highest-weighted source
        if (rrfScore > existing.best.score) {
          existing.best = { ...result, method: "hybrid" as const };
        }
      } else {
        scores.set(result.articleId, {
          total: rrfScore,
          best: result,
        });
      }
    });
  }

  return [...scores.values()]
    .sort((a, b) => b.total - a.total)
    .map(({ best, total }) => ({
      ...best,
      score: total,
      method: "hybrid" as const,
    }));
}

// ─── Snippet extraction ────────────────────────────────────────────────────

/**
 * Extract a relevant snippet around the first keyword match,
 * highlighting matching terms with **bold**.
 */
function extractSnippet(text: string, query: string, maxLen = 300): string {
  if (!text) return "";

  const plain = stripHtml(text);
  const keywords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  // Find the first keyword occurrence
  const lower = plain.toLowerCase();
  let start = 0;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw);
    if (idx !== -1) {
      start = Math.max(0, idx - 60);
      break;
    }
  }

  let snippet = plain.substring(start, start + maxLen);
  if (start > 0) snippet = "..." + snippet;
  if (start + maxLen < plain.length) snippet = snippet + "...";

  // Bold matching keywords
  for (const kw of keywords) {
    const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    snippet = snippet.replace(re, "**$1**");
  }

  return snippet;
}

function countKeywordMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Build a context string from search results for the LLM prompt.
 */
export function buildContext(results: SearchResult[]): string {
  if (results.length === 0) {
    return "search_found_no_results";
  }

  return results
    .map(
      (r, i) =>
        `[${i + 1}] "${r.title}" (${r.feedTitle ? `${r.feedTitle} · ` : ""}${r.publishedAt.toLocaleDateString()})\n${r.snippet}\nURL: ${r.url}`
    )
    .join("\n\n");
}