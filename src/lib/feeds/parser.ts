/**
 * Lightweight RSS/Atom/JSON Feed parser.
 * Edge-compatible — no Node.js XML parsing libraries.
 */

export interface ParsedFeed {
  title: string;
  siteUrl: string | null;
  description: string | null;
  items: ParsedArticle[];
}

export interface ParsedArticle {
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: Date;
}

export async function fetchAndParseFeed(feedUrl: string): Promise<ParsedFeed> {
  const response = await fetch(feedUrl, {
    headers: {
      "User-Agent": "RSSApp/1.0 (Feed Reader)",
      Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${feedUrl}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  // JSON Feed
  if (contentType.includes("json") || text.trim().startsWith("{")) {
    return parseJsonFeed(text);
  }

  // RSS or Atom (XML)
  return parseXmlFeed(text);
}

function parseJsonFeed(text: string): ParsedFeed {
  const data = JSON.parse(text);
  return {
    title: data.title || "Untitled Feed",
    siteUrl: data.home_page_url || null,
    description: data.description || null,
    items: (data.items || []).map((item: any) => ({
      title: item.title || "Untitled",
      url: item.url || "",
      author: item.author?.name || null,
      summary: item.summary || null,
      content: item.content_html || item.content_text || null,
      publishedAt: item.date_published ? new Date(item.date_published) : new Date(),
    })),
  };
}

function parseXmlFeed(text: string): ParsedFeed {
  // Use DOMParser (available in edge runtimes via linkedom when on server,
  // or natively in browser contexts)
  // For server-side edge, we use a simple regex-based parser as fallback

  const feed: ParsedFeed = {
    title: extractText(text, "title") || "Untitled Feed",
    siteUrl: extractAlternateLink(text) || extractAttr(text, "link", "href") || extractText(text, "link") || null,
    description: extractText(text, "description") || null,
    items: [],
  };

  // Extract items (RSS <item> or Atom <entry>)
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)(?:<\/(?:item|entry)>)/gi;
  let match;

  while ((match = itemRegex.exec(text)) !== null) {
    const itemXml = match[1];

    const article: ParsedArticle = {
      title: extractText(itemXml, "title") || "Untitled",
      url:
        extractAlternateLink(itemXml) ||  // Atom <link rel="alternate">
        extractText(itemXml, "link") ||   // RSS style
        "",
      author:
        extractText(itemXml, "author > name") ||
        extractText(itemXml, "dc:creator") ||
        extractText(itemXml, "author") ||
        null,
      summary:
        extractText(itemXml, "summary") ||
        extractText(itemXml, "description") ||
        null,
      content:
        extractText(itemXml, "content:encoded") ||
        extractText(itemXml, "content") ||
        null,
      publishedAt: parseDate(
        extractText(itemXml, "published") ||
        extractText(itemXml, "updated") ||
        extractText(itemXml, "pubDate") ||
        ""
      ),
    };

    if (article.url) {
      feed.items.push(article);
    }
  }

  return feed;
}

function extractText(xml: string, tag: string): string | null {
  // Handle namespaced tags
  const escapedTag = tag.replace(":", "\\:");
  const regex = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
  const match = xml.match(regex);
  if (!match) return null;

  // Decode CDATA
  let content = match[1].trim();
  if (content.startsWith("<![CDATA[") && content.endsWith("]]>")) {
    content = content.slice(9, -3);
  }

  // Strip HTML tags for summary
  return content || null;
}

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, "i");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

/**
 * Extract the correct article URL from Atom <link rel="alternate">.
 * Falls back to first href link, then null.
 */
function extractAlternateLink(xml: string): string | null {
  // Atom: <link rel="alternate" href="..." />
  const altMatch = xml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']*)["']/i) ||
    xml.match(/<link[^>]*href=["']([^"']*)["'][^>]*rel=["']alternate["']/i);
  if (altMatch) return altMatch[1];

  // No alternate link — try first href (may not be correct but better than nothing)
  return extractAttr(xml, "link", "href");
}

function parseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? new Date() : date;
}