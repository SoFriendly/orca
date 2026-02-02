import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Text, View } from "react-native";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import WebView, { WebViewMessageEvent } from "react-native-webview";
import { useTheme } from "~/components/ThemeProvider";

// Terminal themes matching desktop app themes
const TERMINAL_THEMES = {
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

type ThemeName = keyof typeof TERMINAL_THEMES;

interface AssistantTerminalWebViewProps {
  terminalId: string;
  output: string[];
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

export interface AssistantTerminalWebViewRef {
  dismissKeyboard: () => void;
  focusKeyboard: () => void;
}

const buildHtml = (css: string, xtermJs: string, fitJs: string, theme: typeof TERMINAL_THEMES.dark, fontBase64?: string) => `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      ${fontBase64 ? `
      @font-face {
        font-family: 'JetBrainsMono NF';
        src: url(data:font/truetype;base64,${fontBase64}) format('truetype');
        font-weight: normal;
        font-style: normal;
      }
      ` : ''}
      ${css}
      html, body { height: 100%; margin: 0; background: ${theme.background}; }
      #terminal { height: 100%; width: 100%; }
      .xterm-helper-textarea {
        caret-color: transparent !important;
        color: transparent !important;
        opacity: 0 !important;
      }
    </style>
  </head>
  <body>
    <div id="terminal"></div>
    <script>${xtermJs}</script>
    <script>${fitJs}</script>
    <script>
      function post(message) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      }

      post({ type: "log", message: "WebView script start" });

      window.onerror = function(message, source, lineno, colno) {
        post({
          type: "error",
          message: String(message || "Unknown error"),
          source: String(source || ""),
          line: lineno || 0,
          column: colno || 0
        });
      };
      window.onunhandledrejection = function(event) {
        post({
          type: "error",
          message: String(event && event.reason ? event.reason : "Unhandled rejection")
        });
      };

      if (!window.Terminal) {
        post({ type: "error", message: "Terminal constructor missing" });
      }

      // Terminal theme from app settings
      const termTheme = ${JSON.stringify(theme)};

      const term = new Terminal({
        // Performance optimizations from desktop
        cursorBlink: false, // Disable cursor blink to reduce repaints
        cursorStyle: "bar",
        scrollback: 5000, // Limit scrollback buffer for better performance
        fastScrollModifier: "alt",
        fastScrollSensitivity: 5,
        smoothScrollDuration: 0, // Disable smooth scrolling for responsiveness
        // Font configuration - JetBrains Mono Nerd Font embedded as base64 for mobile
        fontFamily: '"JetBrainsMono NF", "SF Mono", "Menlo", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        theme: termTheme,
      });
      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById("terminal"));
      fitAddon.fit();
      term.focus();

      // Enable autocorrect on the hidden textarea
      const textarea = document.querySelector('.xterm-helper-textarea');
      if (textarea) {
        textarea.setAttribute('autocorrect', 'on');
        textarea.setAttribute('autocapitalize', 'sentences');
        textarea.setAttribute('spellcheck', 'true');
      }

      term.onData((data) => post({ type: "input", data }));

      function sendSize() {
        post({ type: "resize", cols: term.cols, rows: term.rows });
      }

      sendSize();

      function handleMessage(event) {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === "output") {
          term.write(message.data || "");
        } else if (message.type === "fit") {
          fitAddon.fit();
          sendSize();
        } else if (message.type === "blur") {
          term.blur();
          document.activeElement?.blur();
        } else if (message.type === "focus") {
          term.focus();
        } else if (message.type === "setTheme") {
          term.options.theme = message.theme;
        }
      }

      document.addEventListener("message", handleMessage);
      window.addEventListener("message", handleMessage);
      window.addEventListener("resize", () => {
        fitAddon.fit();
        sendSize();
      });

      post({ type: "ready" });
    </script>
  </body>
</html>`;

const AssistantTerminalWebView = forwardRef<AssistantTerminalWebViewRef, AssistantTerminalWebViewProps>(({
  terminalId,
  output,
  onInput,
  onResize,
}, ref) => {
  const webViewRef = useRef<WebView>(null);
  const { theme: appTheme } = useTheme();

  // Get the terminal theme based on app theme
  const getTerminalTheme = () => {
    // Handle custom theme by falling back to dark
    const name = (appTheme === "custom" ? "dark" : appTheme) as ThemeName;
    return TERMINAL_THEMES[name] || TERMINAL_THEMES.dark;
  };

  useImperativeHandle(ref, () => ({
    dismissKeyboard: () => {
      webViewRef.current?.postMessage(JSON.stringify({ type: "blur" }));
    },
    focusKeyboard: () => {
      webViewRef.current?.postMessage(JSON.stringify({ type: "focus" }));
    },
  }));
  const [isReady, setIsReady] = useState(false);
  const [isError, setIsError] = useState(false);
  const [logLine, setLogLine] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string>("Loading terminal assets...");
  const lastIndexRef = useRef(0);

  const [html, setHtml] = useState<string | null>(null);
  const terminalTheme = getTerminalTheme();

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (isReady && webViewRef.current) {
      const theme = getTerminalTheme();
      webViewRef.current.postMessage(JSON.stringify({ type: "setTheme", theme }));
    }
  }, [appTheme, isReady]);

  useEffect(() => {
    let isMounted = true;
    const loadAssets = async () => {
      try {
        const xtermJsAsset = Asset.fromModule(require("../assets/xterm/xterm.js.txt"));
        const xtermCssAsset = Asset.fromModule(require("../assets/xterm/xterm.css.txt"));
        const fitJsAsset = Asset.fromModule(require("../assets/xterm/addon-fit.js.txt"));
        const fontAsset = Asset.fromModule(require("../assets/fonts/JetBrainsMonoNerdFont-Regular.ttf"));

        await Promise.all([
          xtermJsAsset.downloadAsync(),
          xtermCssAsset.downloadAsync(),
          fitJsAsset.downloadAsync(),
          fontAsset.downloadAsync(),
        ]);

        const [xtermJs, xtermCss, fitJs, fontBase64] = await Promise.all([
          FileSystem.readAsStringAsync(xtermJsAsset.localUri || xtermJsAsset.uri),
          FileSystem.readAsStringAsync(xtermCssAsset.localUri || xtermCssAsset.uri),
          FileSystem.readAsStringAsync(fitJsAsset.localUri || fitJsAsset.uri),
          FileSystem.readAsStringAsync(fontAsset.localUri || fontAsset.uri, { encoding: FileSystem.EncodingType.Base64 }),
        ]);

        const escapeScript = (value: string) => value.replace(/<\/script>/g, "<\\/script>");
        const theme = getTerminalTheme();
        const htmlContent = buildHtml(xtermCss, escapeScript(xtermJs), escapeScript(fitJs), theme, fontBase64);

        if (isMounted) {
          console.log("[AssistantTerminalWebView] Assets loaded", {
            xtermJs: xtermJs.length,
            xtermCss: xtermCss.length,
            fitJs: fitJs.length,
            fontBase64: fontBase64.length,
          });
          setHtml(htmlContent);
          setStatusLine("Initializing terminal...");
        }
      } catch (err) {
        console.warn("[AssistantTerminalWebView] Asset load error:", err);
        if (isMounted) {
          setIsError(true);
          setLogLine("Failed to load terminal assets");
          setStatusLine("Failed to load terminal assets");
        }
      }
    };
    loadAssets();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    lastIndexRef.current = 0;
  }, [terminalId]);

  const flushOutput = useCallback(() => {
    if (!isReady || !webViewRef.current) return;
    const startIndex = lastIndexRef.current;
    if (startIndex >= output.length) return;
    const chunk = output.slice(startIndex).join("");
    lastIndexRef.current = output.length;
    webViewRef.current.postMessage(
      JSON.stringify({ type: "output", data: chunk })
    );
  }, [isReady, output]);

  useEffect(() => {
    flushOutput();
  }, [flushOutput]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message.type === "ready") {
          setIsReady(true);
          setIsError(false);
          setLogLine(null);
          setStatusLine("Terminal ready");
          webViewRef.current?.postMessage(
            JSON.stringify({ type: "fit" })
          );
          return;
        }
        if (message.type === "log") {
          console.log("[AssistantTerminalWebView]", message.message);
          setLogLine(String(message.message || ""));
          setStatusLine(String(message.message || "Loading terminal..."));
          return;
        }
        if (message.type === "error") {
          console.warn("[AssistantTerminalWebView] WebView error:", message);
          setIsError(true);
          setLogLine(message.message || "Terminal error");
          return;
        }
        if (message.type === "input") {
          onInput(message.data || "");
        }
        if (message.type === "resize") {
          const cols = Number(message.cols || 0);
          const rows = Number(message.rows || 0);
          if (cols > 0 && rows > 0) {
            onResize(cols, rows);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    },
    [onInput, onResize]
  );

  return (
    <View style={{ flex: 1, backgroundColor: terminalTheme.background }}>
      {!isReady && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: terminalTheme.background,
            padding: 16,
          }}
        >
          <Text style={{ color: terminalTheme.foreground, textAlign: "center", opacity: 0.7 }}>
            {isError
              ? `Terminal failed to load${logLine ? `: ${logLine}` : ""}`
              : statusLine}
          </Text>
        </View>
      )}
      {html && (
        <WebView
          ref={webViewRef}
          originWhitelist={["*"]}
          source={{ html }}
          onMessage={handleMessage}
          onLoadEnd={() => {
            setStatusLine("WebView loaded, waiting for script...");
            webViewRef.current?.postMessage(JSON.stringify({ type: "fit" }));
          }}
          injectedJavaScript={`window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: "log", message: "Injected JS ran" })); true;`}
          onError={(event) => {
            console.warn("[AssistantTerminalWebView] WebView load error:", event.nativeEvent);
            setIsError(true);
            setStatusLine("WebView load error");
          }}
          onHttpError={(event) => {
            console.warn("[AssistantTerminalWebView] WebView HTTP error:", event.nativeEvent);
            setIsError(true);
            setStatusLine("WebView HTTP error");
          }}
          javaScriptEnabled
          domStorageEnabled
          bounces={false}
          allowsInlineMediaPlayback
          keyboardDisplayRequiresUserAction={true}
          hideKeyboardAccessoryView={true}
          style={{ backgroundColor: terminalTheme.background }}
        />
      )}
    </View>
  );
});

export default AssistantTerminalWebView;
