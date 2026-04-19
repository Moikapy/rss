import { Hono } from "hono";
import type { Bindings, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { createOllamaClient, type OllamaConfig } from "../lib/ollama";
import { RSS_TOOLS, executeTool } from "../lib/tools";
import { createDb } from "../db/client";

export const userRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All user routes require authentication
userRoutes.use("/api/user/*", authMiddleware);
userRoutes.use("/api/chat/*", authMiddleware);

// User/chat responses must not be cached — recreate Response to ensure headers persist
userRoutes.use("/api/user/*", async (c, next) => {
  await next();
  const headers = new Headers(c.res.headers);
  headers.set("Cache-Control", "no-store, no-transform");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Authorization, Origin, Cookie");
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
});
userRoutes.use("/api/chat/*", async (c, next) => {
  await next();
  const headers = new Headers(c.res.headers);
  headers.set("Cache-Control", "no-store, no-transform");
  headers.set("Pragma", "no-cache");
  headers.set("Vary", "Authorization, Origin, Cookie");
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
});

// ─── User settings ────────────────────────────────────────────────────────
userRoutes.get("/api/user/settings", async (c) => {
  const userId = c.get("userId");

  const raw = await c.env.CACHE.get(`settings:${userId}`, "json");
  const config = typeof raw === "string" ? JSON.parse(raw) : raw || {};

  return c.json({
    ollamaApiKey: config.apiKey ? `***${config.apiKey.slice(-4)}` : null, // masked
    ollamaModel: config.chatModel || "glm-5.1:cloud",
    theme: config.theme || "system",
  });
});

userRoutes.post("/api/user/settings", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  // Get existing settings
  const raw = await c.env.CACHE.get(`settings:${userId}`, "json");
  const existing = typeof raw === "string" ? JSON.parse(raw) : raw || {};

  const updated = {
    ...existing,
    ...(body.ollamaApiKey && { apiKey: body.ollamaApiKey }),
    ...(body.ollamaModel && { chatModel: body.ollamaModel }),
    ...(body.theme && { theme: body.theme }),
  };

  await c.env.CACHE.put(`settings:${userId}`, JSON.stringify(updated));
  return c.json({ success: true });
});

// ─── Account export ───────────────────────────────────────────────────────
userRoutes.get("/api/user/export", async (c) => {
  const userId = c.get("userId");

  // Get all user data from KV
  const settings = await c.env.CACHE.get(`settings:${userId}`, "json");
  const userData = await c.env.CACHE.get(`user:${userId}`, "json");

  const exportPayload = {
    version: 1,
    userId,
    userData,
    settings: settings ? (typeof settings === "string" ? JSON.parse(settings) : settings) : {},
    exportedAt: new Date().toISOString(),
  };

  // TODO: Encrypt with AES-256-GCM using user's passphrase
  // For MVP: base64 encode (encryption coming in next PR)
  const encoded = btoa(JSON.stringify(exportPayload));

  return c.json({ data: encoded, version: 1 });
});

// ─── Account import ───────────────────────────────────────────────────────
userRoutes.post("/api/user/import", async (c) => {
  const { data } = await c.req.json();
  if (!data) return c.json({ error: "Import data required" }, 400);

  try {
    // TODO: Decrypt with AES-256-GCM
    const decoded = JSON.parse(atob(data));

    if (decoded.version !== 1) {
      return c.json({ error: "Unsupported export version" }, 400);
    }

    const userId = c.get("userId");

    // Restore settings
    if (decoded.settings) {
      await c.env.CACHE.put(`settings:${userId}`, JSON.stringify(decoded.settings));
    }

    return c.json({ success: true, restored: { settings: !!decoded.settings } });
  } catch {
    return c.json({ error: "Failed to decrypt import data" }, 400);
  }
});

// ─── AI Chat ──────────────────────────────────────────────────────────────
userRoutes.post("/api/chat", async (c) => {
  const userId = c.get("userId");

  // Get user's Ollama config
  const raw = await c.env.CACHE.get(`settings:${userId}`, "json");
  const userConfig = typeof raw === "string" ? JSON.parse(raw) : raw;

  // BYOK: Users must provide their own Ollama Cloud API key
  const ollamaApiKey = userConfig?.apiKey;
  if (!ollamaApiKey) {
    return c.json({ error: "Bring your own Ollama API key. Set it in Settings → AI Chat.", needsKey: true }, 401);
  }

  const ollamaHost = "https://api.ollama.com";
  const ollamaModel = userConfig?.chatModel || "glm-5.1:cloud";

  const { messages, feedId, articleId, model: reqModel } = await c.req.json();
  const useModel = reqModel || ollamaModel;

  const ollama = createOllamaClient({
    host: ollamaHost,
    apiKey: ollamaApiKey,
    chatModel: useModel,
  });

  const db = createDb(c.env.DB);

  // Build system prompt with context
  const systemMessage = {
    role: "system" as const,
    content: `You are an AI assistant for 0xRSS, a personal RSS feed reader. You have access to the user's subscribed feeds and articles through tools. Use tools to answer questions about their feeds and articles — never say "I don't have access" when you can use a tool instead.${feedId ? `\nCurrent feed context: ${feedId}` : ""}${articleId ? `\nCurrent article context: ${articleId}` : ""}`,
  };

  const chatMessages = [systemMessage, ...messages];
  const toolCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  let thinkingContent: string | undefined;
  let finalContent = "";

  try {
    // Tool-calling loop: up to 5 rounds
    for (let round = 0; round < 5; round++) {
      const response = (await ollama.chat({
        model: useModel,
        messages: chatMessages,
        stream: false,
        tools: RSS_TOOLS,
      })) as any;

      // Capture thinking content from all rounds
      if (response.thinking) {
        thinkingContent = (thinkingContent || "") + response.thinking;
      }

      // Check if model wants to call tools
      if (response.message?.tool_calls && response.message.tool_calls.length > 0) {
        // Add assistant message with tool calls to conversation
        chatMessages.push(response.message);

        // Execute each tool call
        for (const tc of response.message.tool_calls) {
          const toolName = tc.function?.name || tc.name;
          const toolArgs = tc.function?.arguments || tc.arguments || tc.params || {};

          toolCalls.push({ name: toolName, args: toolArgs });

          const result = await executeTool(toolName, toolArgs, db);

          // Add tool result to conversation
          chatMessages.push({
            role: "tool",
            content: result,
          } as any);
        }

        // Continue the loop — model will generate a response from tool results
        continue;
      }

      // No more tool calls — extract the final response
      finalContent = response.message?.content || response.content || "";
      break;
    }

    return c.json({
      content: finalContent,
      thinking: thinkingContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: useModel,
      done: true,
    });
  } catch (err: any) {
    const message = err.message || "Chat failed";
    if (message.includes("401") || message.includes("403")) {
      return c.json({ error: "Ollama API key required. Set it in your profile settings.", needsKey: true }, 401);
    }
    return c.json({ error: message }, 500);
  }
});

// ─── Chat health ──────────────────────────────────────────────────────────
userRoutes.get("/api/chat/health", async (c) => {
  const userId = c.get("userId");

  const raw = await c.env.CACHE.get(`settings:${userId}`, "json");
  const userConfig = typeof raw === "string" ? JSON.parse(raw) : raw;
  const ollamaApiKey = userConfig?.apiKey;

  if (!ollamaApiKey) {
    return c.json({ ok: false, models: [], hasKey: false, error: "Set your Ollama API key in Settings → AI Chat" });
  }

  const ollama = createOllamaClient({
    host: "https://api.ollama.com",
    apiKey: ollamaApiKey,
    chatModel: userConfig?.chatModel || "glm-5.1:cloud",
  });

  const health = await ollama.health();
  return c.json({ ...health, hasKey: true });
});