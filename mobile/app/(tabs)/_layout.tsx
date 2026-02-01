import { Tabs, router } from "expo-router";
import { GitBranch, Terminal, Bot, Home, Settings } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "~/components/ThemeProvider";
import { useConnectionStore } from "~/stores/connectionStore";
import { Pressable } from "react-native";

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
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
        headerLeft: () => (
          <Pressable
            onPress={() => {
              // Clear active project and go back to project list
              useConnectionStore.getState().setActiveProject(null);
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/");
              }
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
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Git",
          headerTitle: "Git Panel",
          tabBarIcon: ({ color, size }) => (
            <GitBranch size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: "Assistant",
          headerTitle: "Coding Assistants",
          tabBarIcon: ({ color, size }) => <Bot size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: "Terminal",
          headerTitle: "Smart Shell",
          tabBarIcon: ({ color, size }) => (
            <Terminal size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
