import { describe, it, expect } from "vitest";
import {
  decodeHTMLEntities,
  stripHtmlTags,
  sanitizeHtml,
  parseJsonFeed,
  parseXmlFeed,
  extractText,
  extractAttr,
  extractAlternateLink,
  parseDate,
} from "../feed-processor";

// ─── decodeHTMLEntities ─────────────────────────────────────────────────────

describe("decodeHTMLEntities", () => {
  it("decodes named HTML entities", () => {
    expect(decodeHTMLEntities("&amp;")).toBe("&");
    expect(decodeHTMLEntities("&lt;")).toBe("<");
    expect(decodeHTMLEntities("&gt;")).toBe(">");
    expect(decodeHTMLEntities("&quot;")).toBe('"');
    expect(decodeHTMLEntities("&apos;")).toBe("'");
  });

  it("decodes decimal numeric entities", () => {
    expect(decodeHTMLEntities("&#8217;")).toBe("\u2019"); // right single quote
    expect(decodeHTMLEntities("&#8216;")).toBe("\u2018"); // left single quote
    expect(decodeHTMLEntities("&#039;")).toBe("'");
    expect(decodeHTMLEntities("&#160;")).toBe("\u00A0"); // non-breaking space
    expect(decodeHTMLEntities("&#8211;")).toBe("\u2013"); // en dash
    expect(decodeHTMLEntities("&#8212;")).toBe("\u2014"); // em dash
  });

  it("decodes hex numeric entities", () => {
    expect(decodeHTMLEntities("&#x2019;")).toBe("\u2019");
    expect(decodeHTMLEntities("&#x2018;")).toBe("\u2018");
    expect(decodeHTMLEntities("&#x00A0;")).toBe("\u00A0");
  });

  it("handles nested entities (&amp;apos; → ')", () => {
    // &amp; gets decoded FIRST (to &), then &apos; gets decoded (to ')
    expect(decodeHTMLEntities("&amp;apos;")).toBe("'");
  });

  it("handles multiple entities in one string", () => {
    expect(decodeHTMLEntities("Canada&#8217;s Best")).toBe("Canada\u2019s Best");
    expect(decodeHTMLEntities("The &amp; Company&#039;s")).toBe("The & Company's");
  });

  it("returns clean strings with no entities unchanged", () => {
    expect(decodeHTMLEntities("Hello World")).toBe("Hello World");
    expect(decodeHTMLEntities("")).toBe("");
  });
});

// ─── stripHtmlTags ──────────────────────────────────────────────────────────

describe("stripHtmlTags", () => {
  it("strips basic HTML tags", () => {
    expect(stripHtmlTags("<p>Hello</p>")).toBe("Hello");
    expect(stripHtmlTags("<em>emphasis</em>")).toBe("emphasis");
    expect(stripHtmlTags("<b>bold</b>")).toBe("bold");
  });

  it("strips tags with attributes", () => {
    expect(stripHtmlTags('<a href="https://example.com">link</a>')).toBe("link");
    expect(stripHtmlTags('<div class="foo">content</div>')).toBe("content");
  });

  it("strips self-closing tags", () => {
    expect(stripHtmlTags("before<br/>after")).toBe("beforeafter");
    expect(stripHtmlTags("text<img src='x.png'>more")).toBe("textmore");
  });

  it("strips nested tags", () => {
    expect(stripHtmlTags("<p><strong>Bold <em>and italic</em></strong></p>")).toBe("Bold and italic");
  });

  it("handles title with HTML feed content", () => {
    expect(stripHtmlTags("<p>Anthropic are the only major AI lab</p>")).toBe(
      "Anthropic are the only major AI lab"
    );
  });

  it("returns empty string for tags-only content", () => {
    expect(stripHtmlTags("<br/>")).toBe("");
  });

  it("trims whitespace", () => {
    expect(stripHtmlTags("  hello  ")).toBe("hello");
  });

  it("handles plain text without tags", () => {
    expect(stripHtmlTags("No tags here")).toBe("No tags here");
  });
});

// ─── sanitizeHtml ──────────────────────────────────────────────────────────

describe("sanitizeHtml", () => {
  it("removes script tags", () => {
    expect(sanitizeHtml('<p>Hello</p><script>alert("xss")</script>')).toBe("<p>Hello</p>");
  });

  it("removes style tags", () => {
    expect(sanitizeHtml("<p>Text</p><style>.x{}</style>")).toBe("<p>Text</p>");
  });

  it("removes event handlers", () => {
    expect(sanitizeHtml('<div onclick="alert(1)">safe</div>')).toBe("<div >safe</div>");
  });

  it("removes javascript: URLs", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">link</a>')).toBe(
      '<a href="alert(1)">link</a>'
    );
  });

  it("decodes HTML entities in content", () => {
    expect(sanitizeHtml("&amp;")).toBe("&");
  });
});

// ─── extractText ────────────────────────────────────────────────────────────

describe("extractText", () => {
  it("extracts text from simple XML tags", () => {
    expect(extractText("<title>Hello</title>", "title")).toBe("Hello");
  });

  it("returns null for missing tags", () => {
    expect(extractText("<feed><title>Hi</title></feed>", "description")).toBeNull();
  });

  it("extracts from nested XML", () => {
    expect(extractText("<item><title>Article</title></item>", "title")).toBe("Article");
  });

  it("handles CDATA sections", () => {
    expect(extractText("<title><![CDATA[Hello & World]]></title>", "title")).toBe("Hello & World");
  });

  it("handles tags with attributes", () => {
    expect(extractText('<link rel="alternate">text</link>', "link")).toBe("text");
  });

  it("handles namespaced tags (dc:creator)", () => {
    expect(extractText("<dc:creator>John</dc:creator>", "dc:creator")).toBe("John");
  });

  it("decodes HTML entities in extracted text", () => {
    expect(extractText("<title>Canada&#8217;s Best</title>", "title")).toBe("Canada\u2019s Best");
  });

  it("returns null for empty content", () => {
    expect(extractText("<title></title>", "title")).toBeNull();
  });
});

// ─── extractAttr ────────────────────────────────────────────────────────────

describe("extractAttr", () => {
  it("extracts attribute from XML tag", () => {
    expect(extractAttr('<link href="https://example.com"/>', "link", "href")).toBe(
      "https://example.com"
    );
  });

  it("returns null when attribute is missing", () => {
    expect(extractAttr("<link/>", "link", "href")).toBeNull();
  });
});

// ─── extractAlternateLink ──────────────────────────────────────────────────

describe("extractAlternateLink", () => {
  it("extracts Atom alternate link", () => {
    expect(
      extractAlternateLink('<link rel="alternate" href="https://example.com/article"/>')
    ).toBe("https://example.com/article");
  });

  it("extracts alternate link with href before rel", () => {
    expect(
      extractAlternateLink('<link href="https://example.com/article" rel="alternate"/>')
    ).toBe("https://example.com/article");
  });

  it("falls back to first href when no alternate", () => {
    expect(extractAlternateLink('<link href="https://example.com/feed" rel="self"/>')).toBe(
      "https://example.com/feed"
    );
  });

  it("returns null when no links present", () => {
    expect(extractAlternateLink("<entry><title>Hi</title></entry>")).toBeNull();
  });
});

// ─── parseDate ──────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses ISO 8601 date strings", () => {
    const d = parseDate("2026-04-19T12:00:00Z");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April = 3 (0-indexed)
    expect(d.getDate()).toBe(19);
  });

  it("parses RFC 822 date strings (RSS format)", () => {
    const d = parseDate("Sat, 19 Apr 2026 12:00:00 GMT");
    expect(d.getFullYear()).toBe(2026);
  });

  it("returns current date for empty string", () => {
    const d = parseDate("");
    expect(d.getFullYear()).toBeGreaterThanOrEqual(2026);
  });

  it("returns current date for invalid date string", () => {
    const d = parseDate("not-a-date");
    expect(d.getFullYear()).toBeGreaterThanOrEqual(2026);
  });
});

// ─── parseJsonFeed ──────────────────────────────────────────────────────────

describe("parseJsonFeed", () => {
  it("parses a valid JSON Feed", () => {
    const feed = parseJsonFeed(JSON.stringify({
      title: "My Feed",
      home_page_url: "https://example.com",
      items: [
        {
          title: "First Post",
          url: "https://example.com/1",
          content_html: "<p>Hello</p>",
          date_published: "2026-04-19T00:00:00Z",
        },
      ],
    }));

    expect(feed.title).toBe("My Feed");
    expect(feed.siteUrl).toBe("https://example.com");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("First Post");
    expect(feed.items[0].url).toBe("https://example.com/1");
  });

  it("defaults missing title to Untitled Feed", () => {
    const feed = parseJsonFeed("{}");
    expect(feed.title).toBe("Untitled Feed");
  });

  it("defaults missing item title to Untitled", () => {
    const feed = parseJsonFeed(JSON.stringify({
      items: [{ url: "https://example.com/1" }],
    }));
    expect(feed.items[0].title).toBe("Untitled");
  });

  it("strips HTML and decodes entities in titles", () => {
    const feed = parseJsonFeed(JSON.stringify({
      title: "My &#8217;Feed&#8217;",
      items: [{ title: "<p>Article &#8217;Title&#8217;</p>", url: "https://example.com/1" }],
    }));
    expect(feed.title).toBe("My \u2019Feed\u2019");
    expect(feed.items[0].title).toBe("Article \u2019Title\u2019");
  });

  it("handles empty items array", () => {
    const feed = parseJsonFeed('{"title":"Empty","items":[]}');
    expect(feed.items).toHaveLength(0);
  });
});

// ─── parseXmlFeed ───────────────────────────────────────────────────────────

describe("parseXmlFeed", () => {
  const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Tech News</title>
    <link>https://example.com</link>
    <description>Latest tech news</description>
    <item>
      <title>First Article</title>
      <link>https://example.com/article-1</link>
      <description>Article summary</description>
      <pubDate>Sat, 19 Apr 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Article</title>
      <link>https://example.com/article-2</link>
      <description>Another summary</description>
    </item>
  </channel>
</rss>`;

  const atomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link rel="alternate" href="https://example.com"/>
  <entry>
    <title>Atom Entry</title>
    <link rel="alternate" href="https://example.com/entry-1"/>
    <summary>Entry summary</summary>
    <published>2026-04-19T12:00:00Z</published>
  </entry>
</feed>`;

  it("parses RSS 2.0 feed", () => {
    const feed = parseXmlFeed(rssFeed);
    expect(feed.title).toBe("Tech News");
    expect(feed.siteUrl).toBe("https://example.com");
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0].title).toBe("First Article");
    expect(feed.items[0].url).toBe("https://example.com/article-1");
  });

  it("parses Atom feed", () => {
    const feed = parseXmlFeed(atomFeed);
    expect(feed.title).toBe("Atom Feed");
    expect(feed.siteUrl).toBe("https://example.com");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("Atom Entry");
    expect(feed.items[0].url).toBe("https://example.com/entry-1");
  });

  it("skips items without URLs", () => {
    const feedNoUrl = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Test</title>
<item><title>No URL Article</title></item>
<item><title>With URL</title><link>https://example.com/x</link></item>
</channel></rss>`;
    const feed = parseXmlFeed(feedNoUrl);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("With URL");
  });

  it("defaults to Untitled Feed when no title", () => {
    const feed = parseXmlFeed('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>');
    expect(feed.title).toBe("Untitled Feed");
  });

  it("strips HTML and decodes entities in titles", () => {
    const feedWithEntities = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Tech</title>
<item><title>Canada&#8217;s Best &amp; Greatest</title><link>https://x.com/1</link></item>
</channel></rss>`;
    const feed = parseXmlFeed(feedWithEntities);
    expect(feed.items[0].title).toBe("Canada\u2019s Best & Greatest");
  });

  it("handles CDATA in title", () => {
    const feedCdata = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Tech</title>
<item><title><![CDATA[Hello & "World"]]></title><link>https://x.com/1</link></item>
</channel></rss>`;
    const feed = parseXmlFeed(feedCdata);
    expect(feed.items[0].title).toBe('Hello & "World"');
  });

  it("extracts content:encoded", () => {
    const feedContent = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Tech</title>
<item><title>Article</title><link>https://x.com/1</link>
<content:encoded><![CDATA[<p>Full content</p>]]></content:encoded>
</item></channel></rss>`;
    const feed = parseXmlFeed(feedContent);
    expect(feed.items[0].content).toBe("<p>Full content</p>");
  });
});