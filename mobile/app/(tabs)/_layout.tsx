import { Tabs, router } from "expo-router";
import { GitBranch, Terminal, Bot, Home, Settings, ChevronDown, ArrowUp, ArrowDown } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "~/components/ThemeProvider";
import { useConnectionStore } from "~/stores/connectionStore";
import { useGitStore } from "~/stores/gitStore";
import { Pressable, View, Text } from "react-native";

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { status: gitStatus, toggleBranchPicker } = useGitStore();

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
              // Clear active project and navigate to project list
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
          tabBarIcon: ({ color, size }) => (
            <GitBranch size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: "Assistant",
          tabBarIcon: ({ color, size }) => <Bot size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="terminal"
        options={{
          title: "Terminal",
          tabBarIcon: ({ color, size }) => (
            <Terminal size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
