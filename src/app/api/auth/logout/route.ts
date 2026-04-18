import { NextResponse } from "next/server";
import { clearTokenCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ success: true });
  return clearTokenCookie(response);
}