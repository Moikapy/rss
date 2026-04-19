import { Ollama } from "ollama";
import { getEnvStringOptional } from "@/lib/env";

export function getOllamaClient() {
  return new Ollama({
    host: getEnvStringOptional("OLLAMA_HOST") || "http://localhost:11434",
  });
}

/** Check if Ollama is running and list available models */
export async function checkOllamaHealth(): Promise<{
  ok: boolean;
  models: string[];
  error?: string;
}> {
  try {
    const ollama = getOllamaClient();
    const { models } = await ollama.list();
    return {
      ok: true,
      models: models.map((m) => m.name),
    };
  } catch (err: any) {
    return {
      ok: false,
      models: [],
      error: err?.message || "Cannot connect to Ollama",
    };
  }
}

/** Embed a single text string for RAG indexing */
export async function embedText(text: string): Promise<number[]> {
  const ollama = getOllamaClient();
  const embedModel = getEnvStringOptional("OLLAMA_EMBED_MODEL") || "embeddinggemma";
  const response = await ollama.embed({
    model: embedModel,
    input: text,
  });
  return response.embeddings[0];
}

/** Embed a batch of texts for RAG indexing */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const ollama = getOllamaClient();
  const embedModel = getEnvStringOptional("OLLAMA_EMBED_MODEL") || "embeddinggemma";
  const response = await ollama.embed({
    model: embedModel,
    input: texts,
  });
  return response.embeddings;
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
}