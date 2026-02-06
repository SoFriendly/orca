import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Terminal from "@/components/Terminal";
import { useSettingsStore } from "@/stores/settingsStore";

export default function TerminalWindow() {
  const [searchParams] = useSearchParams();
  const cwd = searchParams.get("cwd") || "";
  const title = searchParams.get("title") || "Terminal";
  const { theme } = useSettingsStore();

  // Support both direct command and editor+file params
  const directCommand = searchParams.get("command") || "";
  const editor = searchParams.get("editor") || "";
  const file = searchParams.get("file") || "";
  const runInShell = searchParams.get("shell") === "true";

  // When shell=true, run the command through a login shell (for install commands with pipes, etc.)
  // When editor+file provided, pass file as separate arg to handle paths with spaces
  let command: string;
  let args: string[] | undefined;
  if (runInShell && directCommand) {
    // Spawn a default shell; we'll write the command once it's ready
    command = "";
    args = undefined;
  } else if (!directCommand && editor && file) {
    command = editor;
    args = [file];
  } else {
    command = directCommand || editor;
    args = undefined;
  }

  const [isReady, setIsReady] = useState(false);

  // When running in shell mode, write the install command to the terminal once it's ready
  const handleTerminalReady = (terminalId: string) => {
    if (runInShell && directCommand) {
      // Small delay to let the shell initialize
      setTimeout(() => {
        invoke("write_terminal", { id: terminalId, data: directCommand + "\n" }).catch(console.error);
      }, 500);
    }
  };

  // Terminal background colors per theme
  const terminalBgColors: Record<string, string> = {
    dark: "#0d0d0d",
    tokyo: "#1a1b26",
    light: "#fafafa",
  };
  const terminalBg = terminalBgColors[theme] || terminalBgColors.dark;

  useEffect(() => {
    // Set window title
    getCurrentWindow().setTitle(title).catch(console.error);

    // Log params for debugging
    console.log("TerminalWindow params:", { command, cwd, title });

    // Small delay to ensure window is ready
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, [title, command, cwd]);

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      style={{ backgroundColor: terminalBg }}
    >
      {/* Drag region for window */}
      <div
        data-tauri-drag-region
        className="h-8 w-full flex items-center justify-center"
        style={{ backgroundColor: terminalBg }}
      >
        <span className="text-xs text-muted-foreground pointer-events-none">
          {title}
        </span>
      </div>

      {/* Terminal */}
      <div
        className="w-full"
        style={{ height: "calc(100vh - 2rem)" }}
      >
        {isReady && cwd && (
          <Terminal
            command={command}
            args={args}
            cwd={cwd}
            visible={true}
            onTerminalReady={handleTerminalReady}
          />
        )}
        {isReady && !cwd && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Missing working directory - check console for params
          </div>
        )}
      </div>
    </div>
  );
}
