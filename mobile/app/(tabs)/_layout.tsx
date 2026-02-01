import { Tabs, router } from "expo-router";
import { GitBranch, Terminal, Bot, Home, Settings } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "~/components/ThemeProvider";
import { useConnectionStore } from "~/stores/connectionStore";
import { View, Text, Pressable } from "react-native";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { status } = useConnectionStore();
  const insets = useSafeAreaInsets();

  const isConnected = status === "connected";

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
        headerLeft: () => (
          <Pressable
            onPress={() => router.replace("/")}
            className="p-2 ml-2"
          >
            <Home size={22} color={colors.foreground} />
          </Pressable>
        ),
        headerRight: () => (
          <Pressable
            onPress={() => router.push("/settings")}
            className="p-2 mr-2"
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
          headerRight: () => (
            <View className="flex-row items-center">
              {!isConnected && (
                <View className="flex-row items-center mr-2">
                  <View className="w-2 h-2 rounded-full bg-destructive mr-2" />
                  <Text className="text-destructive text-xs">Offline</Text>
                </View>
              )}
              <Pressable
                onPress={() => router.push("/settings")}
                className="p-2 mr-2"
              >
                <Settings size={22} color={colors.foreground} />
              </Pressable>
            </View>
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
