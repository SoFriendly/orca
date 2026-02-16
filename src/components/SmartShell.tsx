import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2, MoreHorizontal, RefreshCw, EyeOff } from "lucide-react";
import type { NltResponse, NltProgressEvent } from "@/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Terminal from "@/components/Terminal";
import CommandPreview from "@/components/CommandPreview";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";

interface ProjectContext {
  projectType: string;
  packageManager: string | null;
  scripts: string[] | null;
  hasDocker: boolean;
  hasMakefile: boolean;
  configSnippet: string | null;
  configFiles: string[];
  folderStructure: string | null;
}

interface SmartShellProps {
  cwd: string;
  terminalId?: string | null;
  onTerminalReady?: (id: string) => void;
  onCwdChange?: (newCwd: string) => void;
  visible?: boolean;
  showNlt?: boolean;
  onNltVisibilityChange?: (visible: boolean) => void;
  className?: string;
}

export default function SmartShell({
  cwd,
  terminalId,
  onTerminalReady,
  onCwdChange,
  visible = true,
  showNlt = false,
  onNltVisibilityChange,
  className,
}: SmartShellProps) {
  const [aiInput, setAiInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<NltResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [internalTerminalId, setInternalTerminalId] = useState<string | null>(terminalId || null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const currentRequestIdRef = useRef<string | null>(null);

  const placeholderSuggestions = [
    "run this project...",
    "start dev server...",
    "build for production...",
    "run tests...",
    "install dependencies...",
    "lint and fix...",
    "format code...",
    "run type check...",
  ];

  // Rotate placeholder suggestions
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % placeholderSuggestions.length);
    }, 15000);
    return () => clearInterval(interval);
  }, []);
  const { groqApiKey } = useSettingsStore();

  // Listen for NLT progress events (filtered by request ID to avoid cross-window interference)
  useEffect(() => {
    const unlisten = listen<NltProgressEvent>("nlt-progress", (event) => {
      const { request_id, status, message } = event.payload;
      // Only process events for our current request
      if (request_id !== currentRequestIdRef.current) return;

      if (status === "done" || status === "error") {
        setProgressMsg(null);
        currentRequestIdRef.current = null;
      } else {
        setProgressMsg(message);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Load project context on mount or when cwd changes
  const loadContext = useCallback(async (forceRefresh = false) => {
    try {
      const context = await invoke<ProjectContext>("scan_project_context", {
        cwd,
        forceRefresh,
      });
      setProjectContext(context);
    } catch (err) {
      console.error("Failed to scan project context:", err);
    }
  }, [cwd]);

  useEffect(() => {
    loadContext(false);
  }, [loadContext]);

  // Sync external terminal ID
  useEffect(() => {
    if (terminalId !== undefined) {
      setInternalTerminalId(terminalId);
    }
  }, [terminalId]);

  const handleTerminalReady = useCallback((id: string) => {
    setInternalTerminalId(id);
    onTerminalReady?.(id);
  }, [onTerminalReady]);

  const handleSubmit = async () => {
    if (!aiInput.trim() || isLoading) return;

    if (!groqApiKey) {
      setError("Please set your Groq API key in Settings to use AI commands.");
      return;
    }

    if (!projectContext) {
      setError("Project context not loaded yet. Please try again.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgressMsg("Analyzing your request...");

    // Generate a unique request ID to scope progress events to this request
    const requestId = crypto.randomUUID();
    currentRequestIdRef.current = requestId;

    try {
      const response = await invoke<NltResponse>("ai_shell_command", {
        request: aiInput.trim(),
        context: projectContext,
        cwd,
        apiKey: groqApiKey,
        requestId,
      });

      setPreview(response);
      setAiInput("");

      // Add to history
      setHistory((prev) => {
        const newHistory = [aiInput.trim(), ...prev.filter((h) => h !== aiInput.trim())];
        return newHistory.slice(0, 50); // Keep last 50
      });
      setHistoryIndex(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
      setProgressMsg(null);
      currentRequestIdRef.current = null;
    }
  };

  const handleExecute = async () => {
    if (!internalTerminalId || !preview) return;

    try {
      // Write command to terminal
      await invoke("write_terminal", { id: internalTerminalId, data: preview.command });
      // Send Enter to execute
      await invoke("write_terminal", { id: internalTerminalId, data: "\r" });

      // Clear state
      setPreview(null);
      setAiInput("");
      setError(null);
    } catch (err) {
      setError("Failed to execute command: " + String(err));
    }
  };

  const handleCancel = () => {
    setPreview(null);
    setError(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      if (preview) {
        handleCancel();
      } else {
        setAiInput("");
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setAiInput(history[newIndex]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setAiInput(history[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setAiInput("");
      }
    }
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* NLT Input Bar */}
      {showNlt && (
        <div className="border-b border-border px-2 py-2">
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderSuggestions[placeholderIndex]}
              disabled={isLoading}
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSubmit}
              disabled={!aiInput.trim() || isLoading}
              className="shrink-0 h-8 px-3 text-xs"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Ask NLT"
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 h-8 w-8 p-0"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => loadContext(true)}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  Re-index project
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNltVisibilityChange?.(false)}>
                  <EyeOff className="h-3.5 w-3.5 mr-2" />
                  Hide NLT Input
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Progress message */}
          {isLoading && progressMsg && (
            <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progressMsg}
            </p>
          )}

          {/* Error message */}
          {error && (
            <p className="mt-2 text-sm text-destructive">{error}</p>
          )}

          {/* Command preview */}
          {preview && (
            <CommandPreview
              command={preview.command}
              explanation={preview.explanation}
              onExecute={handleExecute}
              onCancel={handleCancel}
              className="mt-2"
            />
          )}
        </div>
      )}

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <Terminal
          id={internalTerminalId || undefined}
          command=""
          cwd={cwd}
          onTerminalReady={handleTerminalReady}
          onCwdChange={onCwdChange}
          visible={visible}
        />
      </div>
    </div>
  );
}
