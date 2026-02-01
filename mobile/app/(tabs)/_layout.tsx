import { Tabs } from "expo-router";
import { GitBranch, Terminal, Bot } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "~/components/ThemeProvider";
import { useConnectionStore } from "~/stores/connectionStore";
import { View, Text } from "react-native";

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
          headerRight: () =>
            !isConnected ? (
              <View className="mr-4 flex-row items-center">
                <View className="w-2 h-2 rounded-full bg-destructive mr-2" />
                <Text className="text-destructive text-xs">Offline</Text>
              </View>
            ) : null,
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: "Terminal",
          headerTitle: "Terminal",
          tabBarIcon: ({ color, size }) => (
            <Terminal size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: "Assistant",
          headerTitle: "AI Assistant",
          tabBarIcon: ({ color, size }) => <Bot size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
