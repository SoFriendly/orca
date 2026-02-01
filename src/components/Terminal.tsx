import { useEffect, useRef, useState } from "react";
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
import { useSettingsStore } from "@/stores/settingsStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  id?: string;  // Optional - if not provided, Terminal will spawn its own
  command?: string;  // Command to run (empty for default shell)
  cwd: string;
  onTerminalReady?: (terminalId: string) => void;  // Called when terminal is spawned
  visible?: boolean;  // Trigger resize when visibility changes
  autoFocusOnWindowFocus?: boolean;  // Auto-focus when app window gains focus
}

// Terminal themes matching app themes
const TERMINAL_THEMES: Record<string, ITheme> = {
  dark: {
    background: "#0d0d0d",
    foreground: "#e0e0e0",
    cursor: "#FF6B00",
    cursorAccent: "#0d0d0d",
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
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#7aa2f7",
    cursorAccent: "#1a1b26",
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
    background: "#fafafa",
    foreground: "#383a42",
    cursor: "#526eff",
    cursorAccent: "#fafafa",
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

export default function Terminal({ id, command = "", cwd, onTerminalReady, visible = true, autoFocusOnWindowFocus = false }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isContainerReady, setIsContainerReady] = useState(false);
  const [terminalId, setTerminalId] = useState<string | null>(id || null);
  const [initialDimensions, setInitialDimensions] = useState<{ cols: number; rows: number } | null>(null);
  const theme = useSettingsStore((state) => state.theme);
  const hasSpawnedRef = useRef(false);


  // Phase 1: Wait for container to have stable dimensions
  // This is critical - ResizablePanelGroup takes time to calculate final layout
  useEffect(() => {
    if (!containerRef.current) return;

    let lastWidth = 0;
    let lastHeight = 0;
    let stableCount = 0;
    let checkCount = 0;
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const checkStability = () => {
      if (!containerRef.current) return;
      checkCount++;

      const width = containerRef.current.offsetWidth;
      const height = containerRef.current.offsetHeight;

      if (width > 0 && height > 0) {
        if (width === lastWidth && height === lastHeight) {
          stableCount++;
          // Require dimensions to be stable for 8 consecutive checks (400ms)
          // This gives ResizablePanelGroup plenty of time to finish layout
          if (stableCount >= 8) {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            setIsContainerReady(true);
            return;
          }
        } else {
          stableCount = 0;
          lastWidth = width;
          lastHeight = height;
        }
      }

      // Safety: stop checking after 60 attempts (3 seconds) to prevent infinite loop
      if (checkCount < 60) {
        stabilityTimer = setTimeout(checkStability, 50);
      }
    };

    // Start checking after significant delay to let ResizablePanelGroup fully settle
    stabilityTimer = setTimeout(checkStability, 200);

    // Fallback: force ready after 2 seconds even if not stable
    fallbackTimer = setTimeout(() => {
      if (!isContainerReady && containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = containerRef.current.offsetHeight;
        if (width > 0 && height > 0) {
          setIsContainerReady(true);
        }
      }
    }, 2000);

    return () => {
      if (stabilityTimer) clearTimeout(stabilityTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, []);

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = TERMINAL_THEMES[theme] || TERMINAL_THEMES.dark;
    }
  }, [theme]);

  // Phase 2: Create xterm and calculate dimensions (but don't connect to PTY yet)
  useEffect(() => {
    if (!containerRef.current || !isContainerReady || terminalRef.current) return;

    const terminal = new XTerm({
      theme: TERMINAL_THEMES[theme] || TERMINAL_THEMES.dark,
      fontFamily: '"MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "JetBrains Mono", "Fira Code", "SF Mono", "Menlo", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    // Custom link handler that requires Ctrl/Cmd+Click to open URLs
    const webLinksAddon = new WebLinksAddon((event: MouseEvent, uri: string) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
      if (modifierPressed) {
        openUrl(uri).catch(console.error);
      }
    });
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.unicode.activeVersion = "11";

    terminal.open(containerRef.current);

    // Custom link provider for file paths (Cmd/Ctrl+Click to reveal in Finder/Explorer)
    terminal.registerLinkProvider({
      provideLinks: (lineNumber: number, callback) => {
        const line = terminal.buffer.active.getLine(lineNumber);
        if (!line) {
          callback(undefined);
          return;
        }
        const lineText = line.translateToString();
        const links: Array<{
          range: { start: { x: number; y: number }; end: { x: number; y: number } };
          text: string;
          activate: (event: MouseEvent, text: string) => void;
        }> = [];

        // Match file paths: absolute paths, relative paths, and paths with line numbers
        // Examples: /Users/foo/bar.ts, ./src/index.js, src/file.ts:42:10
        const pathRegex = /(?:^|[\s'"({\[])((\.{0,2}\/)?[\w./-]+\.\w+)(?::(\d+)(?::(\d+))?)?/g;
        let match;

        while ((match = pathRegex.exec(lineText)) !== null) {
          const fullMatch = match[0];
          const filePath = match[1];
          const startOffset = match.index + (fullMatch.length - fullMatch.trimStart().length);
          const matchLength = fullMatch.trimStart().length;

          // Skip URLs (already handled by WebLinksAddon)
          if (filePath.includes('://')) continue;

          // Skip very short matches that are likely false positives
          if (filePath.length < 3) continue;

          links.push({
            range: {
              start: { x: startOffset + 1, y: lineNumber },
              end: { x: startOffset + matchLength + 1, y: lineNumber },
            },
            text: filePath,
            activate: (event: MouseEvent, text: string) => {
              const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
              const modifierPressed = isMac ? event.metaKey : event.ctrlKey;
              if (modifierPressed) {
                // Resolve relative paths against cwd
                const fullPath = text.startsWith('/') ? text : `${cwd}/${text}`;
                invoke('reveal_in_file_manager', { path: fullPath }).catch(console.error);
              }
            },
          });
        }

        callback(links.length > 0 ? links : undefined);
      },
    });

    // Block DEC mode 1004 (focus reporting) to prevent Claude Code from
    // switching to dashboard view when terminal loses focus.
    // See: https://github.com/anthropics/claude-code/issues/22086
    terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
      // Check if mode 1004 is in the params
      for (let i = 0; i < params.length; i++) {
        const param = params[i];
        if (param === 1004 || (Array.isArray(param) && param.includes(1004))) {
          return true; // Block mode 1004, don't let terminal enable focus reporting
        }
      }
      return false; // Let default handler process other modes
    });

    // Use WebGL for GPU-accelerated rendering, fall back to Canvas
    try {
      terminal.loadAddon(new WebglAddon());
    } catch (e) {
      console.warn("WebGL addon failed, falling back to Canvas:", e);
      try {
        terminal.loadAddon(new CanvasAddon());
      } catch (e2) {
        console.warn("Canvas addon also failed, using DOM renderer:", e2);
      }
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle keyboard shortcuts for copy/paste and macOS shortcuts
    terminal.attachCustomKeyEventHandler((event) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

      if (event.type === 'keydown') {
        // Handle Ctrl+C on Windows/Linux - copy if text selected, otherwise send SIGINT
        if (!isMac && event.ctrlKey && event.key === 'c') {
          const selection = terminal.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection);
            return false; // Prevent sending SIGINT when copying
          }
          // No selection, let terminal handle Ctrl+C (SIGINT)
          return true;
        }

        // Handle Ctrl+V on Windows/Linux for paste
        if (!isMac && event.ctrlKey && event.key === 'v') {
          return true; // Let browser handle paste
        }

        if (isMac) {
          // Cmd+Backspace: Delete line (send Ctrl+U)
          if (event.metaKey && event.key === 'Backspace') {
            terminal.input('\x15'); // Ctrl+U
            return false;
          }
          // Cmd+Left: Beginning of line (send Ctrl+A)
          if (event.metaKey && event.key === 'ArrowLeft') {
            terminal.input('\x01'); // Ctrl+A
            return false;
          }
          // Cmd+Right: End of line (send Ctrl+E)
          if (event.metaKey && event.key === 'ArrowRight') {
            terminal.input('\x05'); // Ctrl+E
            return false;
          }
          // Option+Backspace: Delete word (send Ctrl+W)
          if (event.altKey && event.key === 'Backspace') {
            terminal.input('\x17'); // Ctrl+W
            return false;
          }
          // Option+Left: Move word left (send ESC+b)
          if (event.altKey && event.key === 'ArrowLeft') {
            terminal.input('\x1bb'); // ESC+b
            return false;
          }
          // Option+Right: Move word right (send ESC+f)
          if (event.altKey && event.key === 'ArrowRight') {
            terminal.input('\x1bf'); // ESC+f
            return false;
          }
          // Cmd+K: Clear screen
          if (event.metaKey && event.key === 'k') {
            terminal.clear();
            return false;
          }
          // Allow Cmd+C, Cmd+V for copy/paste (let browser handle)
          if (event.metaKey && (event.key === 'c' || event.key === 'v')) {
            return true;
          }
        }
      }

      return true;
    });

    // Do initial fit to calculate dimensions
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          const { cols, rows } = terminal;
          setInitialDimensions({ cols, rows });
        } catch {
          // Fallback dimensions
          setInitialDimensions({ cols: 80, rows: 24 });
        }
      });
    });

    return () => {
      try {
        terminal.dispose();
      } catch (e) {
        console.error("Error disposing terminal:", e);
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isContainerReady, theme]);

  // Phase 3: Spawn PTY with correct dimensions (only if not provided externally)
  useEffect(() => {
    if (!initialDimensions || hasSpawnedRef.current) return;
    if (id) {
      // Terminal ID was provided externally, use it
      setTerminalId(id);
      return;
    }

    invoke("debug_log", { message: `[Terminal] Spawning new terminal with dims ${initialDimensions.cols}x${initialDimensions.rows}` });
    hasSpawnedRef.current = true;
    let isMounted = true;
    let retryCount = 0;
    const maxRetries = 3;

    const spawnTerminal = async () => {
      try {
        await invoke("debug_log", { message: `Terminal spawning with command: "${command}" (attempt ${retryCount + 1})` });
        const newId = await invoke<string>("spawn_terminal", {
          shell: command,
          cwd,
          cols: initialDimensions.cols,
          rows: initialDimensions.rows,
        });
        if (isMounted) {
          setTerminalId(newId);
          onTerminalReady?.(newId);
        }
      } catch (error) {
        console.error(`Failed to spawn terminal (attempt ${retryCount + 1}):`, error);
        retryCount++;
        if (isMounted && retryCount < maxRetries) {
          // Retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
          console.log(`[Terminal] Retrying in ${delay}ms...`);
          setTimeout(spawnTerminal, delay);
        }
      }
    };

    spawnTerminal();

    return () => {
      isMounted = false;
    };
  }, [initialDimensions, id, command, cwd, onTerminalReady]);

  // Phase 4: Connect to PTY and handle ongoing resize
  useEffect(() => {
    if (!terminalId || !terminalRef.current || !fitAddonRef.current) return;

    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    // Safe fit function that checks if terminal is ready
    const safeFit = (source?: string) => {
      try {
        if (containerRef.current && containerRef.current.offsetWidth > 0 && containerRef.current.offsetHeight > 0) {
          fitAddon.fit();
          const { cols, rows } = terminal;
          console.log(`[Terminal] safeFit(${source || 'unknown'}): ${cols}x${rows}, container: ${containerRef.current.offsetWidth}x${containerRef.current.offsetHeight}`);
          invoke("resize_terminal", { id: terminalId, cols, rows }).catch(console.error);
          return true;
        }
      } catch (e) {
        // Ignore fit errors
      }
      return false;
    };

    // Handle terminal input
    const dataDisposable = terminal.onData((data) => {
      invoke("write_terminal", { id: terminalId, data }).catch(console.error);
    });

    // Handle paste events
    const handlePaste = async (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text');
      if (text) {
        invoke("write_terminal", { id: terminalId, data: text }).catch(console.error);
      }
    };
    containerRef.current?.addEventListener('paste', handlePaste);

    // Handle terminal resize
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      invoke("resize_terminal", { id: terminalId, cols, rows }).catch(console.error);
    });

    // Listen for terminal output from backend
    const unlisten = listen<number[]>(`terminal-output-${terminalId}`, (event) => {
      terminal.write(new Uint8Array(event.payload));
    });

    // Handle window resize
    const handleResize = () => {
      safeFit("window-resize");
    };
    window.addEventListener("resize", handleResize);

    // Use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          safeFit("resize-observer");
        }
      }
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Also handle visibility changes (for tabbed terminals)
    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setTimeout(() => safeFit("intersection"), 10);
        }
      }
    });
    if (containerRef.current) {
      intersectionObserver.observe(containerRef.current);
    }

    // CRITICAL: Do delayed resizes after terminal connects to ensure
    // Claude Code gets SIGWINCH and redraws with correct dimensions.
    // The layout may still be settling when we first connect.
    const resizeTimers = [100, 300, 500, 1000].map(delay =>
      setTimeout(() => safeFit(`delayed-${delay}ms`), delay)
    );

    const container = containerRef.current;
    return () => {
      try {
        resizeTimers.forEach(timer => clearTimeout(timer));
        dataDisposable.dispose();
        resizeDisposable.dispose();
        unlisten.then((fn) => fn()).catch(() => {});
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        container?.removeEventListener('paste', handlePaste);
      } catch (e) {
        console.error("Error cleaning up terminal:", e);
      }
    };
  }, [terminalId]);

  // Resize and focus when visibility changes
  useEffect(() => {
    if (visible && terminalRef.current && fitAddonRef.current && terminalId) {
      // Focus immediately when becoming visible
      terminalRef.current.focus();

      // Delay resize to allow CSS transition to complete
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          const terminal = terminalRef.current;
          if (terminal) {
            const { cols, rows } = terminal;
            console.log(`[Terminal] visibility fit: ${cols}x${rows}, container: ${containerRef.current?.offsetWidth}x${containerRef.current?.offsetHeight}`);
            invoke("resize_terminal", { id: terminalId, cols, rows }).catch(console.error);
          }
        } catch (e) {
          // Ignore fit errors
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [visible, terminalId]);

  // Focus terminal when window gains focus (so user can type immediately after switching to app)
  useEffect(() => {
    if (!autoFocusOnWindowFocus || !visible || !terminalRef.current) return;

    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && terminalRef.current) {
        terminalRef.current.focus();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [visible, autoFocusOnWindowFocus]);

  // Focus terminal on click
  const handleClick = () => {
    terminalRef.current?.focus();
  };

  // Get background color from current theme
  const bgColor = TERMINAL_THEMES[theme]?.background || TERMINAL_THEMES.dark.background;

  return (
    <div
      className="h-full w-full p-1"
      style={{ backgroundColor: bgColor }}
      onClick={handleClick}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
      />
    </div>
  );
}
