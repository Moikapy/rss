import { SignJWT, jwtVerify } from "jose";

export function createAuth(env: { JWT_SECRET: string }) {
  const secret = new TextEncoder().encode(env.JWT_SECRET);

  return {
    async signToken(userId: string, role: "admin" | "user" = "user", method: string = "unknown"): Promise<string> {
      return new SignJWT({ sub: userId, role, method })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(secret);
    },

    async verifyToken(token: string): Promise<{ sub: string; role: string; method: string } | null> {
      try {
        const { payload } = await jwtVerify(token, secret);
        return {
          sub: payload.sub as string,
          role: (payload.role as string) || "user",
          method: (payload.method as string) || "unknown",
        };
      } catch {
        return null;
      }
    },
  };
}