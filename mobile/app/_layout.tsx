import "../global.css";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { useConnectionStore } from "~/stores/connectionStore";
import type { WSMessage, TerminalOutputMessage } from "~/types";
import { useTerminalStore } from "~/stores/terminalStore";
import { getWebSocket } from "~/lib/websocket";

export default function RootLayout() {
  const { status, connect, wsUrl } = useConnectionStore();
  const { appendOutput } = useTerminalStore();

  // Auto-connect on app start if URL is configured
  useEffect(() => {
    if (wsUrl && status === "disconnected") {
      connect();
    }
  }, [wsUrl]);

  // Listen for terminal output messages
  useEffect(() => {
    if (status !== "connected") return;

    try {
      const ws = getWebSocket();
      const unsubscribe = ws.onMessage((message: WSMessage) => {
        if (message.type === "terminal_output") {
          const termMsg = message as TerminalOutputMessage;
          appendOutput(termMsg.terminalId, termMsg.data);
        }
      });

      return unsubscribe;
    } catch {
      // WebSocket not initialized yet
    }
  }, [status]);

  return (
    <View className="flex-1 bg-background">
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: "#121212",
          },
          headerTintColor: "#e5e5e5",
          headerTitleStyle: {
            fontWeight: "600",
          },
          contentStyle: {
            backgroundColor: "#121212",
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "Chell Portal",
          }}
        />
        <Stack.Screen
          name="connect"
          options={{
            title: "Connect",
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="project"
          options={{
            title: "Project",
          }}
        />
      </Stack>
    </View>
  );
}
