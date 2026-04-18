"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Upload, Download, Sun, Moon, Monitor } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  async function handleExport() {
    const res = await fetch("/api/opml");
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
      const res = await fetch("/api/opml", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { imported: number; skipped: number; error?: string };

      if (res.ok) {
        setImportStatus(`Imported ${data.imported} feeds, skipped ${data.skipped} duplicates`);
      } else {
        setImportStatus(data.error || "Import failed");
      }
    } catch {
      setImportStatus("Import failed");
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

        <Tabs defaultValue="feeds">
          <TabsList className="mb-4">
            <TabsTrigger value="feeds">Feeds & OPML</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>

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