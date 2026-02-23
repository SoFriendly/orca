import "../global.css";
import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { Pressable, View, Text } from "react-native";
import { ChevronLeft, Home, Settings, GitBranch, ChevronDown, ArrowUp, ArrowDown } from "lucide-react-native";
import { ThemeProvider, useTheme } from "~/components/ThemeProvider";
import { useConnectionStore } from "~/stores/connectionStore";
import { useGitStore } from "~/stores/gitStore";

// Prevent splash screen from auto-hiding before fonts load
SplashScreen.preventAutoHideAsync();

function RootLayoutContent() {
  const { status, connect, wsUrl, requestStatus } = useConnectionStore();
  const { status: gitStatus, toggleBranchPicker } = useGitStore();
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

  // Theme sync is now handled inside connectionStore's setupMessageHandler

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
          headerBackTitleVisible: false,
          contentStyle: {
            backgroundColor: colors.background,
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: "Orca",
            headerShown: true,
            headerBackTitle: "",
          }}
        />
        <Stack.Screen
          name="(tabs)"
          options={{
            headerBackTitle: "",
            headerTitle: () => (
              <Pressable
                onPress={toggleBranchPicker}
                style={{ flexDirection: 'row', alignItems: 'center' }}
              >
                <GitBranch size={16} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontWeight: '600', marginLeft: 8 }} numberOfLines={1}>
                  {gitStatus?.branch || "main"}
                </Text>
                <ChevronDown size={14} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
                {gitStatus && gitStatus.behind > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8, backgroundColor: colors.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                    <ArrowDown size={10} color={colors.foreground} />
                    <Text style={{ color: colors.foreground, fontSize: 10, marginLeft: 2 }}>{gitStatus.behind}</Text>
                  </View>
                )}
                {gitStatus && gitStatus.ahead > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4, backgroundColor: colors.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                    <ArrowUp size={10} color={colors.foreground} />
                    <Text style={{ color: colors.foreground, fontSize: 10, marginLeft: 2 }}>{gitStatus.ahead}</Text>
                  </View>
                )}
              </Pressable>
            ),
            headerLeft: () => (
              <Pressable
                onPress={() => {
                  useConnectionStore.getState().setActiveProject(null);
                  router.dismissAll();
                  router.replace("/");
                }}
                style={{ padding: 8 }}
              >
                <Home size={22} color={colors.foreground} />
              </Pressable>
            ),
            headerRight: () => (
              <Pressable
                onPress={() => router.push("/settings")}
                style={{ padding: 8 }}
              >
                <Settings size={22} color={colors.foreground} />
              </Pressable>
            ),
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: "Settings",
            headerLeft: () => (
              <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
                <ChevronLeft size={24} color={colors.foreground} />
              </Pressable>
            ),
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
  const [fontsLoaded] = useFonts({
    "JetBrainsMono-NF": require("../assets/fonts/JetBrainsMonoNerdFont-Regular.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ThemeProvider>
      <RootLayoutContent />
    </ThemeProvider>
  );
}
