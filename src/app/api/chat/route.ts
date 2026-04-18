import { NextRequest, NextResponse } from "next/server";
import { getOllamaClient } from "@/lib/ai/ollama";
import { searchArticles, buildContext } from "@/lib/ai/rag";
import { getDb } from "@/lib/db/client";
import { articles, feeds } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { RSS_TOOLS, executeTool } from "@/lib/ai/tools";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are an AI assistant for 0xRSS, a personal RSS feed reader. You help users understand, summarize, and discuss articles from their RSS feeds.

You have access to tools that let you read articles, search through feeds, list subscriptions, and search the web. Use these tools proactively:
- When a user asks about a topic, use search_articles to find relevant articles first, then read_article for details
- When a user asks "what's new", use list_recent_articles
- When a user asks about their feeds, use list_feeds
- When an article is already open (provided as context), you can read_article with its ID for the full content
- When a user asks about something outside their feeds or current events, use web_search to find up-to-date information
- When a user asks for news about a topic, use web_search with search_news=true to get recent news articles

Rules:
- Cite article titles and URLs when referencing them
- When search returns no results, don't assume feeds are empty — just suggest different keywords
- NEVER claim feeds are unsynced or not configured
- Be concise but thorough. Format responses with markdown.
- If you don't know something, say so honestly.`;

const MAX_TOOL_ROUNDS = 5;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    messages: { role: string; content: string }[];
    feedId?: string;
    model?: string;
    articleId?: string;
  };

  const { messages, feedId, model, articleId } = body;

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json(
      { error: "messages array required" },
      { status: 400 }
    );
  }

  // Build initial context: inject the currently-open article if provided
  let articleContext = "";
  if (articleId) {
    try {
      const db = getDb();
      const row = db
        .select({
          id: articles.id,
          title: articles.title,
          url: articles.url,
          author: articles.author,
          summary: articles.summary,
          content: articles.content,
          publishedAt: articles.publishedAt,
          feedId: articles.feedId,
        })
        .from(articles)
        .where(eq(articles.id, articleId))
        .get();

      if (row) {
        const feed = db
          .select({ title: feeds.title })
          .from(feeds)
          .where(eq(feeds.id, row.feedId))
          .get();

        const plainContent = (row.content || "")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim()
          .substring(0, 6000);

        articleContext = `\n\n[CURRENTLY OPEN ARTICLE]\nTitle: ${row.title}\nURL: ${row.url}\nAuthor: ${row.author || "Unknown"}\nFeed: ${feed?.title || "Unknown"}\nPublished: ${row.publishedAt.toISOString()}\nSummary: ${row.summary || ""}\nContent: ${plainContent}\n[END ARTICLE]\n`;
      }
    } catch (err) {
      console.error("Failed to load article context:", err);
    }
  }

  // Also do initial RAG search on the user's query
  let ragContext = "";
  let ragMeta = "";
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (lastUserMessage) {
    try {
      const results = await searchArticles(lastUserMessage.content, {
        limit: 5,
        feedId,
        skipEmbeddings: true, // Skip embeddings for initial context — the model can call search_articles tool itself
      });
      if (results.length > 0) {
        ragContext = `\n\n[INITIAL SEARCH RESULTS]\n${buildContext(results)}\n[END SEARCH RESULTS]\n`;
        ragMeta = `[${results.length} initial search result(s) available]`;
      } else {
        ragMeta = "[No initial results — use search_articles tool to find relevant articles]";
      }
    } catch (err) {
      console.error("RAG search failed:", err);
      ragMeta = "[Search unavailable — use tools to explore articles]";
    }
  }

  // Build the system message with all context
  const systemContent = `${SYSTEM_PROMPT}${articleContext}${ragContext}${ragMeta ? `\n\n${ragMeta}` : ""}`;

  const ollama = getOllamaClient();
  const modelName = model || "llama3.2";
  const accept = request.headers.get("accept") || "";
  const wantsStream = accept.includes("text/event-stream");

  // Convert messages to Ollama format for the agent loop
  const ollamaMessages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: any[]; images?: any[] }> = [
    { role: "system", content: systemContent },
    ...messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  if (wantsStream) {
    return streamAgentLoop(ollama, modelName, ollamaMessages);
  }

  // Non-streaming: run the agent loop synchronously
  return runAgentLoop(ollama, modelName, ollamaMessages);
}

// ─── Streaming Agent Loop ──────────────────────────────────────────────────

function streamAgentLoop(
  ollama: ReturnType<typeof getOllamaClient>,
  model: string,
  messages: Array<{ role: string; content: string; tool_calls?: any[] }>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const response = await ollama.chat({
            model,
            messages: messages as any,
            tools: RSS_TOOLS as any,
            stream: true,
          });

          let fullContent = "";
          let fullThinking = "";
          const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
          let hasToolCall = false;

          for await (const chunk of response) {
            if (chunk.message.thinking) {
              fullThinking += chunk.message.thinking;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ thinking: chunk.message.thinking, done: false })}\n\n`
                )
              );
            }
            if (chunk.message.content) {
              fullContent += chunk.message.content;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ content: chunk.message.content, done: false })}\n\n`
                )
              );
            }
            // Check for tool calls
            if (chunk.message.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                if (tc.function?.name) {
                  hasToolCall = true;
                  toolCalls.push({
                    name: tc.function.name,
                    arguments: tc.function.arguments || {},
                  });
                  // Stream tool call notification
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        tool_call: tc.function.name,
                        tool_args: tc.function.arguments,
                        done: false,
                      })}\n\n`
                    )
                  );
                }
              }
            }
          }

          if (hasToolCall) {
            // Execute tool calls and add results to messages
            messages.push({
              role: "assistant",
              content: fullContent || "",
              tool_calls: toolCalls.map((tc) => ({
                function: { name: tc.name, arguments: tc.arguments },
              })),
            } as any);

            for (const tc of toolCalls) {
              const result = await executeTool(tc.name, tc.arguments);
              messages.push({
                role: "tool" as any,
                content: result,
              } as any);

              // Stream tool result notification
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    tool_result: tc.name,
                    done: false,
                  })}\n\n`
                )
              );
            }

            // Continue the loop — the model will see tool results and respond
            continue;
          }

          // No tool calls — we're done
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
          );
          controller.close();
          return;
        }

        // Max rounds reached
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`)
        );
        controller.close();
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: err?.message || "LLM error", done: true })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── Non-streaming Agent Loop ──────────────────────────────────────────────

async function runAgentLoop(
  ollama: ReturnType<typeof getOllamaClient>,
  model: string,
  messages: Array<{ role: string; content: string; tool_calls?: any[] }>
): Promise<NextResponse> {
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await ollama.chat({
        model,
        messages: messages as any,
        tools: RSS_TOOLS as any,
      });

      // Check if the model wants to call tools
      const toolCalls = response.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        // Add assistant message with tool calls
        messages.push({
          role: "assistant",
          content: response.message.content || "",
          tool_calls: toolCalls.map((tc: any) => ({
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        } as any);

        // Execute each tool call and add results
        for (const tc of toolCalls) {
          const result = await executeTool(tc.function.name, tc.function.arguments);
          messages.push({
            role: "tool" as any,
            content: result,
          } as any);
        }

        // Continue the loop
        continue;
      }

      // No tool calls — return the final response
      return NextResponse.json({
        content: response.message.content,
        thinking: response.message.thinking || undefined,
        model: response.model,
      });
    }

    // Max rounds reached — return last content
    return NextResponse.json({
      content: "I've reached the maximum number of tool calls. Please ask again with more specifics.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to generate response" },
      { status: 500 }
    );
  }
}