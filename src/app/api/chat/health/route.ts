import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/ai/ollama";

export const runtime = "nodejs";

export async function GET() {
  const health = await checkOllamaHealth();
  return NextResponse.json(health);
}