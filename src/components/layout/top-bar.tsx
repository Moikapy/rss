"use client";

import { Search, Settings, User, LogOut, PanelLeft, Moon, Sun, Menu, MessageSquare, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/providers/theme-toggle";
import { useAuth } from "@/components/providers/auth-provider";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onToggleSidebar?: () => void;
  onToggleChat?: () => void;
  chatOpen?: boolean;
}

export function TopBar({ searchQuery, onSearchChange, onToggleSidebar, onToggleChat, chatOpen }: TopBarProps) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const { authenticated, loading, login, logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.refresh();
  }

  async function handleLogin() {
    router.push("/login");
  }

  return (
    <header className="flex h-12 items-center gap-2 border-b px-2 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onToggleSidebar}
        title="Toggle sidebar (⌘\\)"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-2 font-semibold shrink-0">
        <span className="text-lg">0x</span>
        <span className="hidden sm:inline">RSS</span>
      </div>

      {/* Desktop search: always visible */}
      <div className="hidden sm:flex flex-1 max-w-md mx-auto">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search articles..."
            className="pl-8 h-9"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Mobile search: toggle */}
      {searchOpen && (
        <div className="flex-1 sm:hidden">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search..."
              className="pl-8 h-9"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
              onBlur={() => { if (!searchQuery) setSearchOpen(false); }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 ml-auto">
        {/* Mobile search toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 sm:hidden shrink-0"
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <Search className="h-4 w-4" />
        </Button>

        <div className="hidden sm:block">
          <ThemeToggle />
        </div>

        {authenticated && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => router.push("/settings")}
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
        {onToggleChat && (
          <Button
            variant={chatOpen ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onToggleChat}
            title="AI Chat"
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        )}
        {authenticated ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <User className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-sm"
            onClick={handleLogin}
          >
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Log in</span>
          </Button>
        )}
      </div>
    </header>
  );
}