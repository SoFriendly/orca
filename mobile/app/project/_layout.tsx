import { Stack } from "expo-router";
import { useTheme } from "~/components/ThemeProvider";

export default function ProjectLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.foreground,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen
        name="git"
        options={{
          title: "Git Panel",
        }}
      />
      <Stack.Screen
        name="terminal"
        options={{
          title: "Terminal",
        }}
      />
      <Stack.Screen
        name="assistant"
        options={{
          title: "AI Assistant",
        }}
      />
    </Stack>
  );
}
