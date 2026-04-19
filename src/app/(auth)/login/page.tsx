"use client";
import { apiUrl, TOKEN_KEY } from "@/lib/api/client";
import { useAuth } from "@/components/providers/auth-provider";
import { isNostrAvailable } from "@/lib/auth/nostr";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const router = useRouter();
  const { login, loginNostr, register, nostrAvailable } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");

  useEffect(() => {
    checkSetupNeeded();
  }, []);

  async function checkSetupNeeded() {
    try {
      const res = await fetch(apiUrl("/api/auth/check-setup"));
      const data = (await res.json()) as { needsSetup: boolean };
      if (data.needsSetup) {
        router.replace("/setup");
      }
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        const success = await register(username, password);
        if (success) {
          router.push("/");
          router.refresh();
        } else {
          setError("Registration failed");
        }
      } else {
        const success = await login(username, password);
        if (success) {
          router.push("/");
          router.refresh();
        } else {
          setError("Invalid credentials");
        }
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleNostrLogin() {
    setError("");
    setLoading(true);
    try {
      const success = await loginNostr();
      if (success) {
        router.push("/");
        router.refresh();
      } else {
        setError("Nostr login failed");
      }
    } catch (err: any) {
      setError(err.message || "Nostr login failed");
    } finally {
      setLoading(false);
    }
  }

  // If not authenticated, anyone can browse public feeds
  function handleSkip() {
    router.push("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="text-3xl mb-2">🐲</div>
          <CardTitle className="text-2xl">0xRSS</CardTitle>
          <CardDescription>
            {mode === "login" ? "Sign in to manage feeds" : "Create an account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Nostr login button */}
          {nostrAvailable && (
            <>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={handleNostrLogin}
                disabled={loading}
              >
                <span className="text-lg">🔑</span>
                Sign in with Nostr
              </Button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
            </>
          )}

          {/* Password form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="your-username"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          {/* Toggle login/register */}
          <div className="text-center text-sm">
            {mode === "login" ? (
              <span className="text-muted-foreground">
                No account?{" "}
                <button
                  onClick={() => { setMode("register"); setError(""); }}
                  className="text-primary hover:underline"
                >
                  Create one
                </button>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Already have an account?{" "}
                <button
                  onClick={() => { setMode("login"); setError(""); }}
                  className="text-primary hover:underline"
                >
                  Sign in
                </button>
              </span>
            )}
          </div>

          {/* Skip — browse public feeds without auth */}
          <div className="text-center">
            <button
              onClick={handleSkip}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Browse feeds without signing in →
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}