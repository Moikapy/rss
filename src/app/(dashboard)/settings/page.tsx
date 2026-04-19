"use client";
import { apiUrl, apiFetch, apiUpload, adminUrl, userUrl, authHeaders } from "@/lib/api/client";
import { useAuth } from "@/components/providers/auth-provider";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Upload, Download, Sun, Moon, Monitor, Key, Save, Eye, EyeOff } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { authenticated } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  // Ollama settings
  const [ollamaKey, setOllamaKey] = useState("");
  const [ollamaModel, setOllamaModel] = useState("glm-5.1:cloud");
  const [customModel, setCustomModel] = useState("");
  const effectiveModel = ollamaModel === "custom" ? customModel : ollamaModel;
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Password change
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: "New passwords don't match" });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: "Password must be at least 8 characters" });
      return;
    }
    setPasswordSaving(true);
    setPasswordMsg(null);
    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPasswordMsg({ ok: true, text: "Password updated" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordMsg({ ok: false, text: err instanceof Error ? err.message : "Failed to change password" });
    } finally {
      setPasswordSaving(false);
    }
  }

  const [showKey, setShowKey] = useState(false);

  // Load settings on mount
  useEffect(() => {
    if (!authenticated) return;
    apiFetch<{ ollamaApiKey?: string; ollamaModel?: string }>(userUrl("/settings"))
      .then((data) => {
        if (data.ollamaModel) setOllamaModel(data.ollamaModel);
        // The API returns a masked key like ***1234 — don't show it
        if (data.ollamaApiKey && data.ollamaApiKey !== null) {
          setOllamaKey(""); // Clear — user types new key to change it
        }
      })
      .catch(() => {});
  }, [authenticated]);

  async function handleSaveOllama() {
    setSaving(true);
    setSaved(false);
    try {
      const body: Record<string, string> = { ollamaModel: effectiveModel };
      if (ollamaKey.trim()) {
        body.ollamaApiKey = ollamaKey.trim();
      }
      await apiFetch(userUrl("/settings"), {
        method: "POST",
        body: JSON.stringify(body),
      });
      setSaved(true);
      setOllamaKey(""); // Clear after save — the key is stored
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const res = await fetch(apiUrl(adminUrl("/opml")), {
      credentials: "include",
      ...authHeaders(),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "0xrss-subscriptions.opml";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportLoading(true);
    setImportStatus("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const data = await apiUpload<{ imported: number; skipped: number; error?: string }>(adminUrl("/opml"), formData);
      setImportStatus(`Imported ${data.imported} feeds, skipped ${data.skipped} duplicates`);
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const themeOptions = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>

        <Tabs defaultValue={authenticated ? "ai" : "feeds"}>
          <TabsList className="mb-4">
            {authenticated && <TabsTrigger value="ai">AI Chat</TabsTrigger>}
            {authenticated && <TabsTrigger value="security">Security</TabsTrigger>}
            <TabsTrigger value="feeds">Feeds & OPML</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

          {authenticated && (
            <TabsContent value="ai">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    Ollama Cloud (BYOK)
                  </CardTitle>
                  <CardDescription>
                    Bring your own Ollama Cloud API key to enable AI chat. Get one at{" "}
                    <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      ollama.com
                    </a>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ollamaKey">API Key</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="ollamaKey"
                          type={showKey ? "text" : "password"}
                          value={ollamaKey}
                          onChange={(e) => { setOllamaKey(e.target.value); setSaved(false); }}
                          placeholder={ollamaKey || "sk-..."}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave blank to keep your existing key. Enter a new key to replace it.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ollamaModel">Chat Model</Label>
                    <select
                      id="ollamaModel"
                      value={ollamaModel}
                      onChange={(e) => { setOllamaModel(e.target.value); setSaved(false); }}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="glm-5.1:cloud">GLM-5.1 Cloud</option>
                      <option value="gpt-oss:120b">GPT-OSS 120B</option>
                      <option value="llama3.3:70b">Llama 3.3 70B</option>
                      <option value="qwen2.5:72b">Qwen 2.5 72B</option>
                      <option value="deepseek-r1:14b">DeepSeek R1 14B</option>
                      <option value="gemma3:12b">Gemma 3 12B</option>
                      <option value="mistral-small:24b">Mistral Small 24B</option>
                      <option value="custom">Custom...</option>
                    </select>
                    {ollamaModel === "custom" && (
                      <Input
                        placeholder="e.g. my-model:7b"
                        value={customModel}
                        onChange={(e) => { setCustomModel(e.target.value); setSaved(false); }}
                        className="mt-2"
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      Default: GLM-5.1 Cloud. Choose any Ollama Cloud model or enter a custom one.
                    </p>
                  </div>

                  <Button onClick={handleSaveOllama} disabled={saving} className="gap-2">
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : saved ? "Saved ✓" : "Save Settings"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {authenticated && (
            <TabsContent value="security">
              <Card>
                <CardHeader>
                  <CardTitle>Change Password</CardTitle>
                  <CardDescription>Update your admin account password</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm New Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
                    />
                  </div>
                  {passwordMsg && (
                    <p className={`text-sm ${passwordMsg.ok ? "text-green-600" : "text-destructive"}`}>
                      {passwordMsg.text}
                    </p>
                  )}
                  <Button onClick={handleChangePassword} disabled={passwordSaving || !currentPassword || !newPassword}>
                    {passwordSaving ? "Updating..." : "Update Password"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          <TabsContent value="feeds">
            <Card>
              <CardHeader>
                <CardTitle>OPML Import / Export</CardTitle>
                <CardDescription>Move your feed subscriptions in and out of 0xRSS</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Button onClick={handleExport} variant="outline" className="gap-2">
                    <Download className="h-4 w-4" />
                    Export OPML
                  </Button>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".opml,.xml"
                      onChange={handleImport}
                      className="hidden"
                    />
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      variant="outline"
                      className="gap-2"
                      disabled={importLoading}
                    >
                      <Upload className="h-4 w-4" />
                      {importLoading ? "Importing..." : "Import OPML"}
                    </Button>
                  </div>
                </div>
                {importStatus && (
                  <p className="text-sm text-muted-foreground">{importStatus}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <CardTitle>Theme</CardTitle>
                <CardDescription>Choose how 0xRSS looks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  {themeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setTheme(opt.value)}
                      className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                        theme === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <opt.icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}