import { NextResponse } from "next/server";
import { checkOllamaHealth } from "@/lib/ai/ollama";

export async function GET() {
  const health = await checkOllamaHealth();
  return NextResponse.json(health);
}