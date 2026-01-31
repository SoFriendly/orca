import { Stack } from "expo-router";

export default function ProjectLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: "#121212",
        },
        headerTintColor: "#e5e5e5",
        contentStyle: {
          backgroundColor: "#121212",
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
