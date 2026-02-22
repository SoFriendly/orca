import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useSettingsStore } from "@/stores/settingsStore";
import { FilePathLinkProvider, HoveredLinkInfo } from "@/utils/terminalLinkProvider";
import { hslToHex, THEME_DEFAULTS } from "@/lib/colorUtils";
import { toast } from "sonner";
import { ExternalLink, FolderOpen, Copy, SquareTerminal } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

// Compute background colors from CSS variables to ensure they match
const THEME_BACKGROUNDS = {
  dark: hslToHex(THEME_DEFAULTS.dark.card),
  tokyo: hslToHex(THEME_DEFAULTS.tokyo.card),
  light: hslToHex(THEME_DEFAULTS.light.card),
};

interface TerminalProps {
  id?: string;
  command?: string;
  args?: string[];
  cwd: string;
  onTerminalReady?: (terminalId: string) => void;
  onCwdChange?: (newCwd: string) => void;
  visible?: boolean;
  autoFocusOnWindowFocus?: boolean;
  isAssistant?: boolean;
}

const TERMINAL_THEMES: Record<string, ITheme> = {
  dark: {
    background: THEME_BACKGROUNDS.dark,
    foreground: "#e0e0e0",
    cursor: "#FF6B00",
    cursorAccent: THEME_BACKGROUNDS.dark,
    selectionBackground: "#FF6B0040",
    black: "#000000",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#6272a4",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  tokyo: {
    background: THEME_BACKGROUNDS.tokyo,
    foreground: "#c0caf5",
    cursor: "#7aa2f7",
    cursorAccent: THEME_BACKGROUNDS.tokyo,
    selectionBackground: "#7aa2f740",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
  light: {
    background: THEME_BACKGROUNDS.light,
    foreground: "#383a42",
    cursor: "#526eff",
    cursorAccent: THEME_BACKGROUNDS.light,
    selectionBackground: "#526eff30",
    black: "#383a42",
    red: "#e45649",
    green: "#50a14f",
    yellow: "#c18401",
    blue: "#4078f2",
    magenta: "#a626a4",
    cyan: "#0184bc",
    white: "#fafafa",
    brightBlack: "#a0a1a7",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#d19a66",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
};

export default function Terminal({ id, command = "", args, cwd, onTerminalReady, onCwdChange, visible = true, autoFocusOnWindowFocus = false, isAssistant }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const linkProviderRef = useRef<FilePathLinkProvider | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const hasInitializedRef = useRef(false);
  const theme = useSettingsStore((state) => state.theme);
  const customTheme = useSettingsStore((state) => state.customTheme);
  const preferredEditor = useSettingsStore((state) => state.preferredEditor);
  const savedScrollTopRef = useRef(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    link: HoveredLinkInfo;
  } | null>(null);

  const onCwdChangeRef = useRef(onCwdChange);
  useEffect(() => { onCwdChangeRef.current = onCwdChange; }, [onCwdChange]);

  const getTerminalTheme = useCallback((): ITheme => {
    if (theme === "custom" && customTheme) {
      const baseTheme = TERMINAL_THEMES[customTheme.baseTheme] || TERMINAL_THEMES.dark;
      return { ...baseTheme, background: customTheme.colors.card, cursorAccent: customTheme.colors.card };
    }
    return TERMINAL_THEMES[theme] || TERMINAL_THEMES.dark;
  }, [theme, customTheme]);

  const extractOsc7Path = useCallback((data: string): string | null => {
    const match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/);
    if (match?.[1]) {
      try { return decodeURIComponent(match[1]); } catch { return match[1]; }
    }
    return null;
  }, []);

  // Context menu handlers
  const handleContextMenu = useCallback((e: MouseEvent) => {
    const link = linkProviderRef.current?.getHoveredLink();
    if (link) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, link });
    }
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleOpenFile = useCallback((link: HoveredLinkInfo) => {
    invoke("open_file_in_editor", {
      path: link.fullPath,
      line: link.line ?? null,
      column: link.column ?? null,
    }).catch((err) => {
      console.error("Failed to open file in editor:", err);
      invoke("reveal_in_file_manager", { path: link.fullPath }).catch(console.error);
    });
    closeContextMenu();
  }, [closeContextMenu]);

  const handleRevealInFileManager = useCallback((link: HoveredLinkInfo) => {
    invoke("reveal_in_file_manager", { path: link.fullPath }).catch(console.error);
    closeContextMenu();
  }, [closeContextMenu]);

  const handleCopyPath = useCallback((link: HoveredLinkInfo) => {
    navigator.clipboard.writeText(link.fullPath);
    toast.success("Path copied to clipboard");
    closeContextMenu();
  }, [closeContextMenu]);

  const handleOpenInEditor = useCallback((link: HoveredLinkInfo) => {
    if (!preferredEditor) {
      toast.error("No preferred editor set. Configure it in Settings.");
      closeContextMenu();
      return;
    }

    const fileName = link.fullPath.split("/").pop() || link.fullPath;
    const title = `${preferredEditor} - ${fileName}`;
    const editorCwd = link.fullPath.substring(0, link.fullPath.lastIndexOf("/"));

    try {
      const params = new URLSearchParams({
        editor: preferredEditor,
        file: link.fullPath,
        cwd: editorCwd,
        title,
      });

      const webview = new WebviewWindow(`editor-${Date.now()}`, {
        url: `/terminal?${params.toString()}`,
        title,
        width: 900,
        height: 600,
        center: true,
        titleBarStyle: "overlay",
        hiddenTitle: true,
        visible: true,
      });

      webview.once("tauri://error", (e) => {
        console.error("Failed to create editor window:", e);
        toast.error(`Failed to open ${preferredEditor}`);
      });
    } catch (err) {
      toast.error(`Failed to open ${preferredEditor}: ${err}`);
    }
    closeContextMenu();
  }, [preferredEditor, closeContextMenu]);

  // Platform-specific label
  const getRevealLabel = useCallback(() => {
    const platform = navigator.platform.toUpperCase();
    if (platform.indexOf('MAC') >= 0) return 'Reveal in Finder';
    if (platform.indexOf('WIN') >= 0) return 'Show in Explorer';
    return 'Show in File Manager';
  }, []);

  // Initialize terminal - once when first visible
  useEffect(() => {
    // Already initialized? Don't re-init
    if (hasInitializedRef.current) return;

    // Not visible yet? Wait until we become visible
    if (!visible) return;

    let cancelled = false;

    const initialize = async () => {
      const container = containerRef.current;
      if (!container || cancelled) return;

      // Wait for dimensions
      let waitCount = 0;
      while ((container.offsetWidth === 0 || container.offsetHeight === 0) && waitCount < 100 && !cancelled) {
        await new Promise(r => setTimeout(r, 50));
        waitCount++;
      }
      if (cancelled) return;

      // Create xterm
      const terminal = new XTerm({
        theme: getTerminalTheme(),
        fontFamily: '"MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "JetBrains Mono", "Fira Code", "SF Mono", "Menlo", monospace',
        fontSize: 13, lineHeight: 1.2, cursorBlink: false, cursorStyle: "bar",
        allowProposedApi: true, scrollback: 5000, fastScrollModifier: "alt",
        fastScrollSensitivity: 5, smoothScrollDuration: 0,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon((e, uri) => {
        if (navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey) openUrl(uri).catch(() => {});
      }));
      terminal.loadAddon(new Unicode11Addon());
      terminal.unicode.activeVersion = "11";
      terminal.open(container);
      const linkProvider = new FilePathLinkProvider(terminal, cwd);
      linkProviderRef.current = linkProvider;
      terminal.registerLinkProvider(linkProvider);
      terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
        for (const p of params) if (p === 1004 || (Array.isArray(p) && p.includes(1004))) return true;
        return false;
      });
      try { terminal.loadAddon(new CanvasAddon()); } catch { try { terminal.loadAddon(new WebglAddon()); } catch {} }

      // Keyboard shortcuts
      terminal.attachCustomKeyEventHandler((e) => {
        const isMac = navigator.platform.toUpperCase().includes('MAC');
        if (e.type === 'keydown') {
          if (e.shiftKey && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); terminal.input('\n'); return false; }
          if (!isMac && e.ctrlKey && e.key === 'c') { const s = terminal.getSelection(); if (s) { navigator.clipboard.writeText(s); return false; } return true; }
          if (!isMac && e.ctrlKey && e.key === 'v') return true;
          if (isMac) {
            if (e.metaKey && e.key === 'Backspace') { terminal.input('\x15'); return false; }
            if (e.metaKey && e.key === 'ArrowLeft') { terminal.input('\x01'); return false; }
            if (e.metaKey && e.key === 'ArrowRight') { terminal.input('\x05'); return false; }
            if (e.altKey && e.key === 'Backspace') { terminal.input('\x17'); return false; }
            if (e.altKey && e.key === 'ArrowLeft') { terminal.input('\x1bb'); return false; }
            if (e.altKey && e.key === 'ArrowRight') { terminal.input('\x1bf'); return false; }
            if (e.metaKey && e.key === 'k') { terminal.clear(); return false; }
            if (e.metaKey && (e.key === 'c' || e.key === 'v')) return true;
          }
        }
        return true;
      });

      if (cancelled) { terminal.dispose(); return; }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      hasInitializedRef.current = true;

      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => requestAnimationFrame(r));
      if (cancelled) { terminal.dispose(); terminalRef.current = null; fitAddonRef.current = null; return; }

      try { fitAddon.fit(); } catch {}
      const cols = terminal.cols >= 5 ? terminal.cols : 80;
      const rows = terminal.rows >= 2 ? terminal.rows : 24;

      // Spawn PTY
      let activeId: string;
      if (id) {
        activeId = id;
      } else {
        try {
          activeId = await invoke<string>("spawn_terminal", { shell: command, cwd, cols, rows, args: args || null, isAssistant: isAssistant || null });
        } catch (e) {
          console.error("[Terminal] Spawn failed:", e);
          terminal.dispose(); terminalRef.current = null; fitAddonRef.current = null;
          return;
        }
      }

      if (cancelled) {
        if (!id) invoke("kill_terminal", { id: activeId }).catch(() => {});
        terminal.dispose(); terminalRef.current = null; fitAddonRef.current = null;
        return;
      }

      setTerminalId(activeId);
      onTerminalReady?.(activeId);

      // Connect PTY output
      const unlisten = await listen<string>(`terminal-output-${activeId}`, (event) => {
        const bin = atob(event.payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (onCwdChangeRef.current) { const p = extractOsc7Path(bin); if (p) onCwdChangeRef.current(p); }
        terminal.write(bytes);
      });

      // Buffer manual input to record commands to project history
      let inputBuffer = "";
      const dataDisposable = terminal.onData((data) => {
        invoke("write_terminal", { id: activeId, data }).catch(() => {});
        if (!isAssistant) {
          if (data === "\r") {
            const cmd = inputBuffer.trim();
            if (cmd) {
              invoke("record_project_command", { command: cmd, projectPath: cwd }).catch(() => {});
            }
            inputBuffer = "";
          } else if (data === "\x7f" || data === "\b") {
            inputBuffer = inputBuffer.slice(0, -1);
          } else if (data === "\x03" || data === "\x15") {
            inputBuffer = "";
          } else if (data === "\x17") {
            // Ctrl+W: delete last word
            inputBuffer = inputBuffer.replace(/\S*\s*$/, "");
          } else if (data.length === 1 && data >= " ") {
            inputBuffer += data;
          } else if (data.length > 1 && !data.startsWith("\x1b")) {
            // Pasted text
            inputBuffer += data;
          }
        }
      });
      const resizeDisposable = terminal.onResize(({ cols, rows }) => invoke("resize_terminal", { id: activeId, cols, rows }).catch(() => {}));

      let lastCols = cols, lastRows = rows, fitTimer: ReturnType<typeof setTimeout> | null = null;
      const safeFit = () => {
        try {
          if (container.offsetWidth > 0 && container.offsetHeight > 0) {
            const vp = container.querySelector('.xterm-viewport') as HTMLElement;
            const ps = vp?.scrollTop ?? savedScrollTopRef.current;
            fitAddon.fit();
            if (vp && ps > 0) vp.scrollTop = Math.min(ps, vp.scrollHeight - vp.clientHeight);
            if (terminal.cols !== lastCols || terminal.rows !== lastRows) {
              lastCols = terminal.cols; lastRows = terminal.rows;
              invoke("resize_terminal", { id: activeId, cols: terminal.cols, rows: terminal.rows }).catch(() => {});
            }
          }
        } catch {}
      };
      const debouncedFit = () => { if (fitTimer) clearTimeout(fitTimer); fitTimer = setTimeout(safeFit, 50); };

      const ro = new ResizeObserver(() => debouncedFit());
      ro.observe(container);
      window.addEventListener("resize", debouncedFit);

      const handlePaste = (e: ClipboardEvent) => { e.preventDefault(); const t = e.clipboardData?.getData("text"); if (t) invoke("write_terminal", { id: activeId, data: t }).catch(() => {}); };
      container.addEventListener('paste', handlePaste);
      container.addEventListener('contextmenu', handleContextMenu as EventListener);

      const vp = container.querySelector('.xterm-viewport') as HTMLElement;
      const handleScroll = () => { if (vp?.scrollTop > 0) savedScrollTopRef.current = vp.scrollTop; };
      vp?.addEventListener('scroll', handleScroll, { passive: true });

      cleanupRef.current = () => {
        if (fitTimer) clearTimeout(fitTimer);
        dataDisposable.dispose(); resizeDisposable.dispose(); ro.disconnect();
        window.removeEventListener("resize", debouncedFit);
        container.removeEventListener('paste', handlePaste);
        container.removeEventListener('contextmenu', handleContextMenu as EventListener);
        vp?.removeEventListener('scroll', handleScroll);
        unlisten();
        terminal.dispose();
        if (!id) invoke("kill_terminal", { id: activeId }).catch(() => {});
      };
    };

    const timer = setTimeout(initialize, 10);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Don't cleanup here - only cancel pending init
      // Actual cleanup happens on unmount via separate effect
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]); // Only re-run when visibility changes

  // Cleanup only on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  // Theme changes
  useEffect(() => { if (terminalRef.current) terminalRef.current.options.theme = getTerminalTheme(); }, [theme, customTheme, getTerminalTheme]);

  // Focus/resize when becoming visible
  useEffect(() => {
    if (visible && terminalRef.current && fitAddonRef.current && terminalId) {
      terminalRef.current.focus();
      const t = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          if (terminalRef.current) invoke("resize_terminal", { id: terminalId, cols: terminalRef.current.cols, rows: terminalRef.current.rows }).catch(() => {});
        } catch {}
      }, 100);
      return () => clearTimeout(t);
    }
  }, [visible, terminalId]);

  // Window focus
  useEffect(() => {
    if (!autoFocusOnWindowFocus || !visible || !terminalRef.current) return;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => { if (payload && terminalRef.current) terminalRef.current.focus(); });
    return () => { unlisten.then(fn => fn()); };
  }, [visible, autoFocusOnWindowFocus]);

  const bgColor = getTerminalTheme().background;

  return (
    <>
      <div className="h-full w-full p-1" style={{ backgroundColor: bgColor, transform: "translateZ(0)" }}
        onClick={() => { closeContextMenu(); terminalRef.current?.focus(); }}
        onMouseUp={() => {
          const p = (window as any).__draggedFilePath;
          if (p && terminalId) { invoke("write_terminal", { id: terminalId, data: p + " " }); (window as any).__draggedFilePath = undefined; terminalRef.current?.focus(); }
        }}
        onDragOver={e => e.preventDefault()} onDragEnter={e => e.preventDefault()}>
        <div ref={containerRef} className="h-full w-full" style={{ transform: "translateZ(0)" }} />
      </div>

      {/* Context menu for file links */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }} />
          <div
            className="fixed z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => handleOpenFile(contextMenu.link)}
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open
            </button>
            <button
              onClick={() => handleRevealInFileManager(contextMenu.link)}
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              {getRevealLabel()}
            </button>
            {preferredEditor && (
              <button
                onClick={() => handleOpenInEditor(contextMenu.link)}
                className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              >
                <SquareTerminal className="mr-2 h-4 w-4" />
                Open in {preferredEditor}
              </button>
            )}
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              onClick={() => handleCopyPath(contextMenu.link)}
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Path
            </button>
          </div>
        </>
      )}
    </>
  );
}
