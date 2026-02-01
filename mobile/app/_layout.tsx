import "../global.css";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "~/components/ThemeProvider";
import { useConnectionStore } from "~/stores/connectionStore";
import { useThemeStore } from "~/stores/themeStore";
import type { WSMessage } from "~/types";
import { getWebSocket } from "~/lib/websocket";

function RootLayoutContent() {
  const { status, connect, wsUrl, requestStatus } = useConnectionStore();
  const { syncFromDesktop, syncWithDesktop } = useThemeStore();
  const { theme, colors } = useTheme();

  // Auto-connect on app start if URL is configured
  useEffect(() => {
    if (wsUrl && status === "disconnected") {
      connect();
    }
  }, [wsUrl]);

  // Request status (project list, theme, etc.) when connected
  useEffect(() => {
    if (status === "connected") {
      // Small delay to ensure connection is fully established
      const timer = setTimeout(() => {
        requestStatus();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Listen for messages from desktop (theme sync only - terminal output handled in connectionStore)
  useEffect(() => {
    if (status !== "connected") return;

    try {
      const ws = getWebSocket();
      const unsubscribe = ws.onMessage((message: WSMessage) => {
        // Handle theme sync from desktop
        if (message.type === "status_update" && syncWithDesktop) {
          const statusMsg = message as any;
          if (statusMsg.theme) {
            // Use syncFromDesktop to handle both regular and custom themes
            syncFromDesktop(statusMsg.theme, statusMsg.customTheme);
          }
        }
      });

      return unsubscribe;
    } catch {
      // WebSocket not initialized yet
    }
  }, [status, syncWithDesktop]);

  return (
    <>
      <StatusBar style={theme === "light" ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerTintColor: colors.foreground,
          headerTitleStyle: {
            fontWeight: "600",
          },
          headerLeftContainerStyle: {
            paddingLeft: 8,
          },
          headerRightContainerStyle: {
            paddingRight: 8,
          },
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "Chell",
            headerShown: true,
          }}
        />
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: "Settings",
          }}
        />
        <Stack.Screen
          name="connect"
          options={{
            title: "Connect",
            presentation: "modal",
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
}
