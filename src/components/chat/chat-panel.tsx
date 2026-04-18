"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageSquare,
  Send,
  X,
  Loader2,
  AlertCircle,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
  Brain,
  Wrench,
  Search,
  BookOpen,
  Newspaper,
  List,
  BarChart3,
  Maximize2,
  Minimize2,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; args?: Record<string, unknown>; result?: string }>;
}

/** Maps tool names to human-readable labels + icons */
const TOOL_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  read_article: { label: "Reading article", icon: <BookOpen className="h-3 w-3" /> },
  search_articles: { label: "Searching articles", icon: <Search className="h-3 w-3" /> },
  list_feeds: { label: "Loading feeds", icon: <Newspaper className="h-3 w-3" /> },
  list_recent_articles: { label: "Fetching recent articles", icon: <List className="h-3 w-3" /> },
  get_unread_counts: { label: "Counting unread", icon: <BarChart3 className="h-3 w-3" /> },
  web_search: { label: "Searching the web", icon: <Globe className="h-3 w-3" /> },
};

type AgentStatus =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "tool"; tool: string; args?: Record<string, unknown> }
  | { type: "responding" }
  | { type: "error"; message: string };

interface ChatPanelProps {
  feedId?: string | null;
  articleId?: string | null;
  onClose?: () => void;
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="mb-2"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground select-none">
        <Brain className="h-3 w-3" />
        <span className="font-medium">Thinking</span>
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      </summary>
      <div className="mt-1.5 rounded-md border bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {thinking}
      </div>
    </details>
  );
}

function ToolCallIndicator({ calls }: { calls: Message["toolCalls"] }) {
  if (!calls || calls.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {calls.map((tc, i) => {
        const info = TOOL_LABELS[tc.name] || { label: tc.name.replace(/_/g, " "), icon: <Wrench className="h-2.5 w-2.5" /> };
        return (
          <span key={i} className="inline-flex items-center gap-1 rounded-md border bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {info.icon}
            {info.label}
          </span>
        );
      })}
    </div>
  );
}

function StatusIndicator({ status }: { status: AgentStatus }) {
  if (status.type === "idle") return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground border-b bg-muted/30 animate-fade-in">
      <Loader2 className="h-3 w-3 animate-spin" />
      {status.type === "thinking" && "Thinking..."}
      {status.type === "responding" && "Writing response..."}
      {status.type === "error" && `Error: ${status.message}`}
      {status.type === "tool" && (() => {
        const info = TOOL_LABELS[status.tool] || { label: status.tool.replace(/_/g, " "), icon: <Wrench className="h-3 w-3" /> };
        return (
          <span className="flex items-center gap-1">
            {info.icon}
            {info.label}...
          </span>
        );
      })()}
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const hasThinking = message.thinking && message.thinking.trim().length > 0;
  const hasContent = message.content && message.content.trim().length > 0;

  if (!hasContent && !hasThinking) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Thinking...
      </span>
    );
  }

  return (
    <>
      {hasThinking && <ThinkingBlock thinking={message.thinking!} />}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallIndicator calls={message.toolCalls} />
      )}
      {hasContent && (
        <div className="article-content prose-sm max-w-none text-sm leading-relaxed
          [&_a]:text-primary [&_a]:underline [&_a:hover]:text-primary/80
          [&_code]:font-mono [&_code]:text-xs [&_code]:text-muted-foreground
          [&_pre]:bg-background [&_pre]:border [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto
          [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2
          [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5
          [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
          [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1
          [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1
          [&_li]:my-0.5
          [&_p]:my-1.5
          [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground
          [&_strong]:font-semibold
          [&_hr]:border-border [&_hr]:my-3
        ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
      )}
    </>
  );
}

export function ChatPanel({ feedId, articleId, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ type: "idle" });
  const [fullscreen, setFullscreen] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<
    "disconnected" | "connecting" | "ok" | "error"
  >("disconnected");
  const [errorMsg, setErrorMsg] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function connectToOllama() {
    setOllamaStatus("connecting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/chat/health");
      const data = (await res.json()) as { ok: boolean; models: string[]; error?: string };
      if (data.ok) {
        setOllamaStatus("ok");
        setAvailableModels(data.models);
        const chatModels = data.models.filter(
          (m) =>
            !m.includes("embed") &&
            !m.includes("mxbai") &&
            !m.includes("nomic") &&
            !m.includes("all-minilm")
        );
        if (chatModels.length > 0) {
          setSelectedModel(chatModels[0]);
        } else if (data.models.length > 0) {
          setSelectedModel(data.models[0]);
        }
      } else {
        setOllamaStatus("error");
        setErrorMsg(data.error || "Ollama not reachable");
      }
    } catch {
      setOllamaStatus("error");
      setErrorMsg("Cannot connect to Ollama. Make sure it's running on localhost:11434");
    }
  }

  // Auto-scroll to bottom when messages or status change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, agentStatus]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setAgentStatus({ type: "thinking" });
    setErrorMsg("");

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    const allMessages = [...messages, userMessage];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          messages: allMessages,
          feedId: feedId || undefined,
          model: selectedModel || undefined,
          articleId: articleId || undefined,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error || "Chat request failed");
      }

      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let assistantContent = "";
        let assistantThinking = "";
        const assistantToolCalls: Message["toolCalls"] = [];
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", thinking: "", toolCalls: [] },
        ]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6)) as {
                content?: string;
                thinking?: string;
                error?: string;
                done?: boolean;
                tool_call?: string;
                tool_args?: Record<string, unknown>;
                tool_result?: string;
                status?: string;
              };
              if (data.error) {
                setErrorMsg(data.error);
                setAgentStatus({ type: "error", message: data.error });
                break;
              }
              if (data.done) {
                setAgentStatus({ type: "idle" });
                break;
              }
              if (data.thinking) {
                assistantThinking += data.thinking;
                setAgentStatus({ type: "thinking" });
              }
              if (data.tool_call) {
                assistantToolCalls.push({
                  name: data.tool_call,
                  args: data.tool_args,
                });
                setAgentStatus({ type: "tool", tool: data.tool_call, args: data.tool_args });
              }
              if (data.content) {
                assistantContent += data.content;
                setAgentStatus({ type: "responding" });
              }
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantContent,
                  thinking: assistantThinking || undefined,
                  toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : undefined,
                };
                return updated;
              });
            } catch {
              // skip malformed chunks
            }
          }
        }
      } else {
        const data = (await res.json()) as {
          error?: string;
          content?: string;
          thinking?: string;
        };
        if (data.error) throw new Error(data.error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.content || "",
            thinking: data.thinking || undefined,
          },
        ]);
        setAgentStatus({ type: "idle" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get response";
      setErrorMsg(msg);
      setAgentStatus({ type: "error", message: msg });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, messages, feedId, selectedModel]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestions = [
    "Summarize my recent articles",
    "What are the main topics in my feeds?",
    "Find articles about AI",
    "What's trending in tech?",
  ];

  const chatModels = availableModels.filter(
    (m) =>
      !m.includes("embed") &&
      !m.includes("mxbai") &&
      !m.includes("nomic") &&
      !m.includes("all-minilm")
  );

  return (
    <div className={fullscreen ? "fullscreen-overlay" : "flex h-full flex-col"}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Chat</h2>
          {ollamaStatus === "ok" && (
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          )}
          {ollamaStatus === "error" && (
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          )}
          {ollamaStatus === "connecting" && (
            <Loader2 className="h-1.5 w-1.5 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setFullscreen(!fullscreen)}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Model selector */}
      {ollamaStatus === "ok" && chatModels.length > 0 && (
        <div className="relative border-b px-4 py-2">
          <button
            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            className="flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          >
            <span className="truncate">{selectedModel || "Select model"}</span>
            <ChevronDown className="h-3 w-3 shrink-0 ml-1" />
          </button>
          {modelDropdownOpen && (
            <div className="absolute left-4 right-4 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
              {chatModels.map((model) => (
                <button
                  key={model}
                  onClick={() => {
                    setSelectedModel(model);
                    setModelDropdownOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center px-3 py-2 text-xs hover:bg-muted",
                    model === selectedModel && "font-medium text-primary"
                  )}
                >
                  {model}
                </button>
              ))}
              {availableModels.length > chatModels.length && (
                <>
                  <div className="px-3 py-1 text-[10px] text-muted-foreground">
                    Embedding models
                  </div>
                  {availableModels
                    .filter((m) => !chatModels.includes(m))
                    .map((model) => (
                      <button
                        key={model}
                        onClick={() => {
                          setSelectedModel(model);
                          setModelDropdownOpen(false);
                        }}
                        className="flex w-full items-center px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
                      >
                        {model}
                      </button>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Agent status bar */}
      {loading && <StatusIndicator status={agentStatus} />}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Chat with your feeds</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ask questions, get summaries, or explore your articles
                </p>
              </div>
              {ollamaStatus === "disconnected" && (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <Button
                    onClick={connectToOllama}
                    variant="outline"
                    className="gap-2"
                  >
                    <Bot className="h-4 w-4" />
                    Connect to Ollama
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Make sure Ollama is running locally
                  </p>
                </div>
              )}
              {ollamaStatus === "connecting" && (
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting...
                </div>
              )}
              {ollamaStatus === "error" && (
                <div className="mt-2 flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                  <Button
                    onClick={connectToOllama}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    Retry connection
                  </Button>
                </div>
              )}
              {ollamaStatus === "ok" && (
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setInput(s);
                        inputRef.current?.focus();
                      }}
                      className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2.5",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "rounded-lg px-3 py-2",
                  msg.role === "user"
                    ? "max-w-[85%] bg-primary text-primary-foreground text-sm"
                    : "max-w-[90%] bg-muted text-foreground"
                )}
              >
                {msg.role === "assistant" ? (
                  <AssistantMessage message={msg} />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
              {msg.role === "user" && (
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary mt-0.5">
                  <User className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}

          {errorMsg && !loading && messages.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {errorMsg}
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              ollamaStatus === "disconnected"
                ? "Connect to Ollama to start chatting..."
                : ollamaStatus === "connecting"
                ? "Connecting to Ollama..."
                : ollamaStatus === "error"
                ? "Ollama not connected..."
                : !selectedModel
                ? "Select a model first..."
                : "Ask about your feeds... (Shift+Enter for new lines)"
            }
            disabled={loading || ollamaStatus !== "ok" || !selectedModel}
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-5 ring-offset-background placeholder:text-muted-foreground placeholder:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[36px] max-h-[120px]"
          />
          <Button
            size="icon"
            onClick={sendMessage}
            disabled={loading || !input.trim() || ollamaStatus !== "ok" || !selectedModel}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}