import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { getEnvString } from "@/lib/env";

const JWT_SECRET_KEY = "JWT_SECRET";
const COOKIE_NAME = "0xrss-token";
const TOKEN_EXPIRY = "7d";

function getSecret(): Uint8Array {
  const secret = getEnvString(JWT_SECRET_KEY);
  return new TextEncoder().encode(secret);
}

export async function signToken(userId: string): Promise<string> {
  const secret = getSecret();
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<{ sub: string } | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);
    return { sub: payload.sub as string };
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request: Request): string | undefined {
  // Read from Cookie header (works in both middleware and API routes)
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.split(";").find((c) => c.trim().startsWith(`${COOKIE_NAME}=`));
  return match?.split("=")[1];
}

/** Set auth cookie on a NextResponse — works in API routes */
export function setTokenCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: getEnvString("NODE_ENV", "development") === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return response;
}

/** Clear auth cookie on a NextResponse — works in API routes */
export function clearTokenCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: getEnvString("NODE_ENV", "development") === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export { COOKIE_NAME };