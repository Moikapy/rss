"use client";

import { useEffect, useState, useCallback } from "react";
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from "@/components/ui/resizable-panel";
import { Sidebar } from "@/components/layout/sidebar";
import { ArticleList } from "@/components/article/article-list";
import { ArticleReader } from "@/components/article/article-reader";
import { TopBar } from "@/components/layout/top-bar";
import { StatusBar } from "@/components/layout/status-bar";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat/chat-panel";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocalArticleState } from "@/hooks/use-local-article-state";

const STORAGE_KEY = "0xrss-layout";

type LayoutMap = { [id: string]: number };
type MobileView = "list" | "reader";

function getSavedLayout(): LayoutMap | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_LAYOUT: LayoutMap = {
  sidebar: 20,
  "article-list": 35,
  "article-reader": 45,
};

const CHAT_LAYOUT: LayoutMap = {
  sidebar: 18,
  "article-list": 30,
  "article-reader": 34,
  chat: 18,
};

export default function DashboardPage() {
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "bookmarked" | "read-later">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [layout, setLayout] = useState<LayoutMap | undefined>(undefined);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [articleVersion, setArticleVersion] = useState(0);
  const [articles, setArticles] = useState<any[]>([]);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { authenticated, loading: authLoading } = useAuth();
  const articleState = useLocalArticleState();

  const { refreshing, lastRefresh, totalNewArticles, refreshAll } = useAutoRefresh(5 * 60 * 1000);

  // Detect mobile
  useEffect(() => {
    function checkMobile() {
      setIsMobile(window.innerWidth < 768);
    }
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Refresh article list when new articles come in
  useEffect(() => {
    if (totalNewArticles > 0) {
      setArticleVersion((v) => v + 1);
    }
  }, [totalNewArticles]);

  useEffect(() => {
    setLayout(getSavedLayout());
  }, []);

  function handleLayoutChange(newLayout: LayoutMap) {
    setLayout(newLayout);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLayout));
    } catch {
      // ignore
    }
  }

  // On mobile, selecting an article switches to reader view
  function handleSelectArticle(id: string) {
    setSelectedArticleId(id);
    if (isMobile) {
      setMobileView("reader");
    }
  }

  // On mobile, selecting a feed closes sidebar
  function handleSelectFeed(id: string) {
    setSelectedFeedId(id);
    setSelectedFolderId(null);
    setSelectedTagId(null);
    if (isMobile) {
      setSidebarOpen(false);
      setMobileView("list");
    }
  }

  function handleSelectFolder(id: string) {
    setSelectedFolderId(id);
    setSelectedFeedId(null);
    setSelectedTagId(null);
    if (isMobile) {
      setSidebarOpen(false);
      setMobileView("list");
    }
  }

  function handleSelectTag(id: string) {
    setSelectedTagId(id);
    setSelectedFeedId(null);
    setSelectedFolderId(null);
    if (isMobile) {
      setSidebarOpen(false);
      setMobileView("list");
    }
  }

  const navigateNext = useCallback(() => {
    if (!articles.length) return;
    const idx = articles.findIndex((a: any) => a.id === selectedArticleId);
    const next = idx < articles.length - 1 ? idx + 1 : 0;
    setSelectedArticleId(articles[next].id);
  }, [articles, selectedArticleId]);

  const navigatePrev = useCallback(() => {
    if (!articles.length) return;
    const idx = articles.findIndex((a: any) => a.id === selectedArticleId);
    const prev = idx > 0 ? idx - 1 : articles.length - 1;
    setSelectedArticleId(articles[prev].id);
  }, [articles, selectedArticleId]);

  useKeyboardShortcuts({
    onToggleSidebar: () => {
      if (isMobile) {
        setSidebarOpen((v) => !v);
      } else {
        setSidebarVisible((v) => !v);
      }
    },
    onNavigateNext: navigateNext,
    onNavigatePrev: navigatePrev,
    onRefresh: refreshAll,
  });

  const activeLayout = layout ?? (chatOpen ? CHAT_LAYOUT : DEFAULT_LAYOUT);

  // ========== MOBILE LAYOUT ==========
  if (isMobile) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onToggleSidebar={() => setSidebarOpen(true)}
          onToggleChat={() => setChatOpen((v) => !v)}
          chatOpen={chatOpen}
        />

        {/* Mobile: slide-out sidebar */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-0">
            <Sidebar
              selectedFeedId={selectedFeedId}
              selectedFolderId={selectedFolderId}
              selectedTagId={selectedTagId}
              filter={filter}
              onSelectFeed={handleSelectFeed}
              onSelectFolder={handleSelectFolder}
              onSelectTag={handleSelectTag}
              onFilterChange={setFilter}
              isAuthenticated={authenticated}
            />
          </SheetContent>
        </Sheet>

        {/* Mobile: single panel view */}
        <div className="flex-1 overflow-hidden">
          {mobileView === "list" ? (
            <ArticleList
              feedId={selectedFeedId}
              folderId={selectedFolderId}
              tagId={selectedTagId}
              filter={filter}
              searchQuery={searchQuery}
              selectedArticleId={selectedArticleId}
              onSelectArticle={handleSelectArticle}
              version={articleVersion}
              onArticlesLoaded={setArticles}
              articleState={articleState}
              onMarkRead={articleState.markRead}
            />
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex items-center border-b px-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMobileView("list")}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ArticleReader articleId={selectedArticleId} articleState={articleState} authenticated={authenticated} />
              </div>
            </div>
          )}
        </div>

        <StatusBar refreshing={refreshing} lastRefresh={lastRefresh} onRefresh={refreshAll} />

        {/* Mobile chat sheet */}
        <Sheet open={chatOpen && isMobile} onOpenChange={setChatOpen}>
          <SheetContent side="bottom" className="h-[70vh] p-0">
            <ChatPanel feedId={selectedFeedId} articleId={selectedArticleId} onClose={() => setChatOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  // ========== DESKTOP LAYOUT ==========
  return (
    <div className="flex h-screen flex-col bg-background">
      <TopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onToggleChat={() => setChatOpen((v) => !v)}
        chatOpen={chatOpen}
      />
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          orientation="horizontal"
          defaultLayout={activeLayout}
          onLayoutChanged={handleLayoutChange}
        >
          {sidebarVisible && (
            <>
              <ResizablePanel
                id="sidebar"
                defaultSize="20%"
                minSize="10%"
                maxSize="30%"
                collapsible
              >
                <Sidebar
                  selectedFeedId={selectedFeedId}
                  selectedFolderId={selectedFolderId}
                  selectedTagId={selectedTagId}
                  filter={filter}
                  onSelectFeed={handleSelectFeed}
                  onSelectFolder={handleSelectFolder}
                  onSelectTag={handleSelectTag}
                  onFilterChange={setFilter}
                  isAuthenticated={authenticated}
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
            </>
          )}
          <ResizablePanel
            id="article-list"
            defaultSize="35%"
            minSize="15%"
            maxSize="60%"
          >
            <ArticleList
              feedId={selectedFeedId}
              folderId={selectedFolderId}
              tagId={selectedTagId}
              filter={filter}
              searchQuery={searchQuery}
              selectedArticleId={selectedArticleId}
              onSelectArticle={handleSelectArticle}
              version={articleVersion}
              onArticlesLoaded={setArticles}
              articleState={articleState}
              onMarkRead={articleState.markRead}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="article-reader"
            defaultSize={chatOpen ? "34%" : "45%"}
            minSize="20%"
          >
            <ArticleReader articleId={selectedArticleId} articleState={articleState} authenticated={authenticated} />
          </ResizablePanel>
          {chatOpen && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="chat"
                defaultSize="18%"
                minSize="15%"
                maxSize="40%"
              >
                <ChatPanel feedId={selectedFeedId} articleId={selectedArticleId} onClose={() => setChatOpen(false)} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
      <StatusBar refreshing={refreshing} lastRefresh={lastRefresh} onRefresh={refreshAll} />
    </div>
  );
}