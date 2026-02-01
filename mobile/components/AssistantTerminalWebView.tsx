import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import WebView, { WebViewMessageEvent } from "react-native-webview";

interface AssistantTerminalWebViewProps {
  terminalId: string;
  output: string[];
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

const buildHtml = (css: string, xtermJs: string, fitJs: string) => `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      ${css}
      html, body { height: 100%; margin: 0; background: #000; }
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

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        theme: { background: "#000000", foreground: "#e6e6e6" },
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

export default function AssistantTerminalWebView({
  terminalId,
  output,
  onInput,
  onResize,
}: AssistantTerminalWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const [isReady, setIsReady] = useState(false);
  const [isError, setIsError] = useState(false);
  const [logLine, setLogLine] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState<string>("Loading terminal assets...");
  const lastIndexRef = useRef(0);

  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadAssets = async () => {
      try {
        const xtermJsAsset = Asset.fromModule(require("../assets/xterm/xterm.js.txt"));
        const xtermCssAsset = Asset.fromModule(require("../assets/xterm/xterm.css.txt"));
        const fitJsAsset = Asset.fromModule(require("../assets/xterm/addon-fit.js.txt"));

        await Promise.all([
          xtermJsAsset.downloadAsync(),
          xtermCssAsset.downloadAsync(),
          fitJsAsset.downloadAsync(),
        ]);

        const [xtermJs, xtermCss, fitJs] = await Promise.all([
          FileSystem.readAsStringAsync(xtermJsAsset.localUri || xtermJsAsset.uri),
          FileSystem.readAsStringAsync(xtermCssAsset.localUri || xtermCssAsset.uri),
          FileSystem.readAsStringAsync(fitJsAsset.localUri || fitJsAsset.uri),
        ]);

        const escapeScript = (value: string) => value.replace(/<\/script>/g, "<\\/script>");
        const htmlContent = buildHtml(xtermCss, escapeScript(xtermJs), escapeScript(fitJs));

        if (isMounted) {
          console.log("[AssistantTerminalWebView] Assets loaded", {
            xtermJs: xtermJs.length,
            xtermCss: xtermCss.length,
            fitJs: fitJs.length,
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
    <View className="flex-1 bg-black">
      {!isReady && (
        <View className="absolute inset-0 z-10 items-center justify-center bg-black/90 p-4">
          <Text style={{ color: "#9ca3af", textAlign: "center" }}>
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
          style={{ backgroundColor: "#000000" }}
        />
      )}
    </View>
  );
}
