/**
 * Full content extraction using @mozilla/readability + linkedom.
 * Falls back to summary if extraction fails.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export interface ExtractedContent {
  content: string | null;
  title: string | null;
  byline: string | null;
}

export async function extractContent(url: string): Promise<ExtractedContent> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "RSSApp/1.0 (Feed Reader)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { content: null, title: null, byline: null };
    }

    const html = await response.text();

    // Parse HTML with linkedom (lightweight DOM implementation)
    const { document } = parseHTML(html);

    // Use Readability to extract main content
    const reader = new Readability(document as any);
    const article = reader.parse();

    if (!article || !article.content) {
      return { content: null, title: article?.title ?? null, byline: article?.byline ?? null };
    }

    return {
      content: sanitizeHtml(article.content),
      title: article.title ?? null,
      byline: article.byline ?? null,
    };
  } catch {
    return { content: null, title: null, byline: null };
  }
}

/**
 * Basic HTML sanitization — remove scripts, styles, event handlers.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}