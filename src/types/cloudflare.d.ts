/// <reference types="@cloudflare/workers-types" />

// Extend the global CloudflareEnv to include our D1 binding
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    JWT_SECRET: string;
    OLLAMA_HOST?: string;
    OLLAMA_CHAT_MODEL?: string;
    OLLAMA_EMBED_MODEL?: string;
  }
}

export {};