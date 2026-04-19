import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/db/get-db";
import { feeds, folders, feedTags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const db = await getDatabase();
  const allFolders = await db.select().from(folders).all();
  const allFeeds = await db.select().from(feeds).all();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<opml version="2.0">\n`;
  xml += `  <head>\n`;
  xml += `    <title>0xRSS Subscriptions</title>\n`;
  xml += `    <dateCreated>${new Date().toISOString()}</dateCreated>\n`;
  xml += `  </head>\n`;
  xml += `  <body>\n`;

  const folderMap = new Map(allFolders.map((f: typeof allFolders[number]) => [f.id, f]));
  const folderFeeds = new Map<string, typeof allFeeds>();
  const uncategorized: typeof allFeeds = [];

  for (const feed of allFeeds) {
    if (feed.folderId && folderMap.has(feed.folderId)) {
      if (!folderFeeds.has(feed.folderId)) {
        folderFeeds.set(feed.folderId, []);
      }
      folderFeeds.get(feed.folderId)!.push(feed);
    } else {
      uncategorized.push(feed);
    }
  }

  for (const folder of allFolders) {
    const folderFeedList = folderFeeds.get(folder.id) || [];
    if (folderFeedList.length === 0) continue;

    xml += `    <outline text="${escapeXml(folder.name)}" title="${escapeXml(folder.name)}">\n`;
    for (const feed of folderFeedList) {
      xml += `      <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ""} />\n`;
    }
    xml += `    </outline>\n`;
  }

  for (const feed of uncategorized) {
    xml += `    <outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"${feed.siteUrl ? ` htmlUrl="${escapeXml(feed.siteUrl)}"` : ""} />\n`;
  }

  xml += `  </body>\n`;
  xml += `</opml>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": "attachment; filename=0xrss-subscriptions.opml",
    },
  });
}

// POST /api/opml — import feeds from OPML
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const text = await file.text();
  const db = await getDatabase();

  const outlineRegex = /<outline[^>]*>/gi;
  let currentFolderId: string | null = null;
  let imported = 0;
  let skipped = 0;

  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes("<outline")) continue;

    const xmlUrlMatch = trimmed.match(/xmlUrl="([^"]*)"/i);

    if (xmlUrlMatch) {
      const url = xmlUrlMatch[1];
      const titleMatch = trimmed.match(/text="([^"]*)"/i) || trimmed.match(/title="([^"]*)"/i);
      const title = titleMatch ? titleMatch[1] : url;
      const siteUrlMatch = trimmed.match(/htmlUrl="([^"]*)"/i);
      const siteUrl = siteUrlMatch ? siteUrlMatch[1] : null;

      const existing = await db.select({ id: feeds.id }).from(feeds).where(eq(feeds.url, url)).get();
      if (existing) {
        skipped++;
        continue;
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(feeds).values({
        id,
        title,
        url,
        siteUrl: siteUrl || null,
        description: null,
        folderId: currentFolderId,
        refreshInterval: 30,
        autoRefresh: true,
        lastFetched: null,
        createdAt: now,
        updatedAt: now,
      }).run();

      imported++;
    } else {
      const textMatch = trimmed.match(/text="([^"]*)"/i);
      if (textMatch && !trimmed.endsWith("/>")) {
        const folderName = textMatch[1];
        let folder = await db.select({ id: folders.id }).from(folders).where(eq(folders.name, folderName)).get();

        if (!folder) {
          const folderId = crypto.randomUUID();
          await db.insert(folders).values({
            id: folderId,
            name: folderName,
            order: 0,
            createdAt: new Date(),
          }).run();
          currentFolderId = folderId;
        } else {
          currentFolderId = folder.id;
        }
      }
    }

    if (trimmed.includes("</outline>")) {
      currentFolderId = null;
    }
  }

  return NextResponse.json({ imported, skipped });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}