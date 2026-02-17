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
import { useSettingsStore } from "@/stores/settingsStore";
import { FilePathLinkProvider } from "@/utils/terminalLinkProvider";
import { hslToHex, THEME_DEFAULTS } from "@/lib/colorUtils";
import "@xterm/xterm/css/xterm.css";

// Compute background colors from CSS variables to ensure they match
const THEME_BACKGROUNDS = {
  dark: hslToHex(THEME_DEFAULTS.dark.card),
  tokyo: hslToHex(THEME_DEFAULTS.tokyo.card),
  light: hslToHex(THEME_DEFAULTS.light.card),
};

interface TerminalProps {
  id?: string;  // Optional - if not provided, Terminal will spawn its own
  command?: string;  // Command to run (empty for default shell)
  args?: string[];  // Args to pass to command (handles paths with spaces)
  cwd: string;
  onTerminalReady?: (terminalId: string) => void;  // Called when terminal is spawned
  onCwdChange?: (newCwd: string) => void;  // Called when shell reports directory change via OSC 7
  visible?: boolean;  // Trigger resize when visibility changes
  autoFocusOnWindowFocus?: boolean;  // Auto-focus when app window gains focus
  isAssistant?: boolean;  // Hint for terminal type detection in backend
}

// Terminal themes matching app themes (backgrounds match --card CSS variable)
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
  const [terminalId, setTerminalId] = useState<string | null>(id || null);
  const [isInitialized, setIsInitialized] = useState(false);
  const theme = useSettingsStore((state) => state.theme);
  const customTheme = useSettingsStore((state) => state.customTheme);
  const savedScrollTopRef = useRef(0);
  const initAttemptRef = useRef(0);

  // Keep ref in sync with onCwdChange callback
  const onCwdChangeRef = useRef(onCwdChange);
  useEffect(() => {
    onCwdChangeRef.current = onCwdChange;
  }, [onCwdChange]);

  // Get the appropriate terminal theme, handling custom themes
  const getTerminalTheme = useCallback((): ITheme => {
    if (theme === "custom" && customTheme) {
      const baseTheme = TERMINAL_THEMES[customTheme.baseTheme] || TERMINAL_THEMES.dark;
      return {
        ...baseTheme,
        background: customTheme.colors.card,
        cursorAccent: customTheme.colors.card,
      };
    }
    return TERMINAL_THEMES[theme] || TERMINAL_THEMES.dark;
  }, [theme, customTheme]);

  // Extract path from OSC 7 sequence
  const extractOsc7Path = (data: string): string | null => {
    const osc7Regex = /\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/;
    const match = data.match(osc7Regex);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    return null;
  };

  // Single combined initialization effect
  // This replaces the complex 4-phase system with a simpler sequential approach
  useEffect(() => {
    if (!visible || isInitialized) return;

    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let terminal: XTerm | null = null;
    let fitAddon: FitAddon | null = null;
    let spawnedId: string | null = null;
    let unlistenFn: (() => void) | null = null;

    const initialize = async () => {
      initAttemptRef.current++;
      const attemptId = initAttemptRef.current;

      // Wait for container to have non-zero dimensions
      // Poll until dimensions are available (up to 5 seconds)
      let dims = { width: container.offsetWidth, height: container.offsetHeight };
      let waitCount = 0;
      const maxWait = 100; // 5 seconds at 50ms intervals

      while ((dims.width === 0 || dims.height === 0) && waitCount < maxWait && !cancelled) {
        await new Promise(resolve => setTimeout(resolve, 50));
        dims = { width: container.offsetWidth, height: container.offsetHeight };
        waitCount++;
      }

      if (cancelled || attemptId !== initAttemptRef.current) return;

      // If still no dimensions after waiting, use the container anyway
      // xterm will use minimum dimensions and resize later

      // Create xterm instance
      terminal = new XTerm({
        theme: getTerminalTheme(),
        fontFamily: '"MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "JetBrains Mono", "Fira Code", "SF Mono", "Menlo", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: false,
        cursorStyle: "bar",
        allowProposedApi: true,
        scrollback: 5000,
        fastScrollModifier: "alt",
        fastScrollSensitivity: 5,
        smoothScrollDuration: 0,
      });

      fitAddon = new FitAddon();
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

      // Open terminal in container
      terminal.open(container);

      // Register custom file path link provider
      const filePathLinkProvider = new FilePathLinkProvider(terminal, cwd);
      terminal.registerLinkProvider(filePathLinkProvider);

      // Block DEC mode 1004 (focus reporting)
      terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
        for (let i = 0; i < params.length; i++) {
          const param = params[i];
          if (param === 1004 || (Array.isArray(param) && param.includes(1004))) {
            return true;
          }
        }
        return false;
      });

      // Use Canvas renderer
      try {
        terminal.loadAddon(new CanvasAddon());
      } catch (e) {
        console.warn("Canvas addon failed, trying WebGL:", e);
        try {
          terminal.loadAddon(new WebglAddon());
        } catch (e2) {
          console.warn("WebGL addon also failed, using DOM renderer:", e2);
        }
      }

      // Setup keyboard shortcuts
      terminal.attachCustomKeyEventHandler((event) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

        if (event.type === 'keydown') {
          if (event.shiftKey && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            terminal!.input('\n');
            return false;
          }

          if (!isMac && event.ctrlKey && event.key === 'c') {
            const selection = terminal!.getSelection();
            if (selection) {
              navigator.clipboard.writeText(selection);
              return false;
            }
            return true;
          }

          if (!isMac && event.ctrlKey && event.key === 'v') {
            return true;
          }

          if (isMac) {
            if (event.metaKey && event.key === 'Backspace') {
              terminal!.input('\x15');
              return false;
            }
            if (event.metaKey && event.key === 'ArrowLeft') {
              terminal!.input('\x01');
              return false;
            }
            if (event.metaKey && event.key === 'ArrowRight') {
              terminal!.input('\x05');
              return false;
            }
            if (event.altKey && event.key === 'Backspace') {
              terminal!.input('\x17');
              return false;
            }
            if (event.altKey && event.key === 'ArrowLeft') {
              terminal!.input('\x1bb');
              return false;
            }
            if (event.altKey && event.key === 'ArrowRight') {
              terminal!.input('\x1bf');
              return false;
            }
            if (event.metaKey && event.key === 'k') {
              terminal!.clear();
              return false;
            }
            if (event.metaKey && (event.key === 'c' || event.key === 'v')) {
              return true;
            }
          }
        }
        return true;
      });

      if (cancelled || attemptId !== initAttemptRef.current) {
        terminal.dispose();
        return;
      }

      // Store refs
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Fit to get dimensions
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => requestAnimationFrame(resolve));

      if (cancelled || attemptId !== initAttemptRef.current) {
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        return;
      }

      try {
        fitAddon.fit();
      } catch (e) {
        console.warn("[Terminal] Initial fit failed:", e);
      }

      const cols = terminal.cols >= 5 ? terminal.cols : 80;
      const rows = terminal.rows >= 2 ? terminal.rows : 24;

      // Spawn PTY or use provided ID
      let activeTerminalId: string;
      if (id) {
        activeTerminalId = id;
      } else {
        try {
          activeTerminalId = await invoke<string>("spawn_terminal", {
            shell: command,
            cwd,
            cols,
            rows,
            args: args || null,
            isAssistant: isAssistant || null,
          });
        } catch (error) {
          console.error("[Terminal] Failed to spawn terminal:", error);
          terminal.dispose();
          terminalRef.current = null;
          fitAddonRef.current = null;
          return;
        }
      }

      if (cancelled || attemptId !== initAttemptRef.current) {
        if (!id) {
          invoke("kill_terminal", { id: activeTerminalId }).catch(() => {});
        }
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        return;
      }

      spawnedId = activeTerminalId;
      setTerminalId(activeTerminalId);
      onTerminalReady?.(activeTerminalId);

      // Connect to PTY output
      const unlisten = await listen<string>(`terminal-output-${activeTerminalId}`, (event) => {
        const binaryString = atob(event.payload);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        let i = 0;
        for (; i + 3 < len; i += 4) {
          bytes[i] = binaryString.charCodeAt(i);
          bytes[i + 1] = binaryString.charCodeAt(i + 1);
          bytes[i + 2] = binaryString.charCodeAt(i + 2);
          bytes[i + 3] = binaryString.charCodeAt(i + 3);
        }
        for (; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        if (onCwdChangeRef.current) {
          const newCwd = extractOsc7Path(binaryString);
          if (newCwd) {
            onCwdChangeRef.current(newCwd);
          }
        }

        terminal?.write(bytes);
      });
      unlistenFn = unlisten;

      // Handle terminal input
      const dataDisposable = terminal.onData((data) => {
        invoke("write_terminal", { id: activeTerminalId, data }).catch(console.error);
      });

      // Handle terminal resize events
      const resizeDisposable = terminal.onResize(({ cols, rows }) => {
        invoke("resize_terminal", { id: activeTerminalId, cols, rows }).catch(console.error);
      });

      // Setup resize observer
      let lastCols = cols;
      let lastRows = rows;
      let fitDebounceTimer: ReturnType<typeof setTimeout> | null = null;

      const safeFit = () => {
        try {
          if (container.offsetWidth > 0 && container.offsetHeight > 0 && fitAddon && terminal) {
            const viewport = container.querySelector('.xterm-viewport') as HTMLElement;
            const prevScrollTop = viewport?.scrollTop ?? savedScrollTopRef.current;

            fitAddon.fit();

            if (viewport && prevScrollTop > 0) {
              const maxScroll = viewport.scrollHeight - viewport.clientHeight;
              viewport.scrollTop = Math.min(prevScrollTop, maxScroll);
            }

            if (terminal.cols !== lastCols || terminal.rows !== lastRows) {
              lastCols = terminal.cols;
              lastRows = terminal.rows;
              invoke("resize_terminal", { id: activeTerminalId, cols: terminal.cols, rows: terminal.rows }).catch(console.error);
            }
          }
        } catch (e) {
          // Ignore fit errors
        }
      };

      const debouncedFit = () => {
        if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
        fitDebounceTimer = setTimeout(safeFit, 50);
      };

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            debouncedFit();
          }
        }
      });
      resizeObserver.observe(container);

      window.addEventListener("resize", debouncedFit);

      // Handle paste
      const handlePaste = async (e: ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text");
        if (text) {
          invoke("write_terminal", { id: activeTerminalId, data: text }).catch(console.error);
        }
      };
      container.addEventListener('paste', handlePaste);

      // Track scroll position
      const viewport = container.querySelector('.xterm-viewport') as HTMLElement;
      const handleViewportScroll = () => {
        if (viewport && viewport.scrollTop > 0) {
          savedScrollTopRef.current = viewport.scrollTop;
        }
      };
      viewport?.addEventListener('scroll', handleViewportScroll, { passive: true });

      // Mark as initialized
      setIsInitialized(true);

      // Store cleanup references in a way we can access from effect cleanup
      (container as any).__terminalCleanup = () => {
        if (fitDebounceTimer) clearTimeout(fitDebounceTimer);
        dataDisposable.dispose();
        resizeDisposable.dispose();
        resizeObserver.disconnect();
        window.removeEventListener("resize", debouncedFit);
        container.removeEventListener('paste', handlePaste);
        viewport?.removeEventListener('scroll', handleViewportScroll);
        unlistenFn?.();
        terminal?.dispose();
        if (!id && spawnedId) {
          invoke("kill_terminal", { id: spawnedId }).catch(() => {});
        }
      };
    };

    initialize();

    return () => {
      cancelled = true;
      const cleanup = (container as any).__terminalCleanup;
      if (cleanup) {
        cleanup();
        delete (container as any).__terminalCleanup;
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
      setIsInitialized(false);
      setTerminalId(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, cwd]); // Re-run when visibility or cwd changes

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getTerminalTheme();
    }
  }, [theme, customTheme, getTerminalTheme]);

  // Resize and focus when visibility changes
  useEffect(() => {
    if (visible && terminalRef.current && fitAddonRef.current && terminalId) {
      terminalRef.current.focus();
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          const terminal = terminalRef.current;
          if (terminal) {
            invoke("resize_terminal", { id: terminalId, cols: terminal.cols, rows: terminal.rows }).catch(console.error);
          }
          const viewport = containerRef.current?.querySelector('.xterm-viewport') as HTMLElement;
          if (viewport && savedScrollTopRef.current > 0) {
            const maxScroll = viewport.scrollHeight - viewport.clientHeight;
            viewport.scrollTop = Math.min(savedScrollTopRef.current, maxScroll);
          }
        } catch (e) {
          // Ignore fit errors
        }
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [visible, terminalId]);

  // Focus terminal when window gains focus
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
  const bgColor = getTerminalTheme().background;

  // Prevent drag events from causing canvas to black out
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Handle file path drops from GitPanel
  const handleMouseUp = () => {
    const draggedPath = (window as unknown as { __draggedFilePath?: string }).__draggedFilePath;
    if (draggedPath && terminalId) {
      invoke("write_terminal", { id: terminalId, data: draggedPath + " " });
      (window as unknown as { __draggedFilePath?: string }).__draggedFilePath = undefined;
      terminalRef.current?.focus();
    }
  };

  return (
    <div
      className="h-full w-full p-1"
      style={{ backgroundColor: bgColor, transform: "translateZ(0)" }}
      onClick={handleClick}
      onMouseUp={handleMouseUp}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ transform: "translateZ(0)" }}
      />
    </div>
  );
}
