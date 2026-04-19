/**
 * Ollama client that works with:
 * 1. Ollama Cloud (default, no tunnel needed)
 * 2. User's own Ollama instance (via custom host URL)
 * 3. Any OpenAI-compatible API (OpenAI, Groq, Together, etc.)
 */

export interface OllamaConfig {
  /** Full URL to Ollama host, e.g. "https://ollama.com" or "http://localhost:11434" (via tunnel) */
  host: string;
  /** Bearer token for cloud (OLLAMA_API_KEY) — optional for local instances */
  apiKey?: string;
  /** Model to use for chat */
  chatModel: string;
  /** Model to use for embeddings */
  embedModel?: string;
}

export function createOllamaClient(config: OllamaConfig) {
  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const baseUrl = config.host.replace(/\/+$/, ""); // strip trailing slash

  return {
    config,

    async chat(request: {
      model?: string;
      messages: Array<{ role: string; content: string }>;
      stream?: boolean;
      tools?: unknown[];
    }) {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          model: request.model || config.chatModel,
          messages: request.messages,
          stream: request.stream ?? false,
          ...(request.tools ? { tools: request.tools } : {}),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama chat error ${response.status}: ${text}`);
      }

      if (request.stream) {
        return response;
      }

      return response.json();
    },

    async embed(input: string | string[]) {
      const texts = Array.isArray(input) ? input : [input];
      const response = await fetch(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          model: config.embedModel || "nomic-embed-text",
          input: texts,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Ollama embed error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as { embeddings: number[][] };
      return Array.isArray(input) ? data.embeddings : data.embeddings[0];
    },

    async health() {
      try {
        const response = await fetch(`${baseUrl}/api/tags`, { headers });
        if (!response.ok) return { ok: false, models: [], error: `HTTP ${response.status}` };
        const data = (await response.json()) as { models: Array<{ name: string }> };
        return { ok: true, models: data.models.map((m) => m.name) };
      } catch (err: any) {
        return { ok: false, models: [], error: err.message || "Cannot connect" };
      }
    },
  };
}

export type OllamaClient = ReturnType<typeof createOllamaClient>;