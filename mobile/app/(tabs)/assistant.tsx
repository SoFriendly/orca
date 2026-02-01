import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Alert,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Bot,
  Sparkles,
  Play,
  Terminal,
  Check,
  X,
  Wand2,
  WifiOff,
} from "lucide-react-native";
import { useConnectionStore } from "~/stores/connectionStore";
import { useTerminalStore } from "~/stores/terminalStore";
import { useTheme } from "~/components/ThemeProvider";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
} from "~/components/ui";
import type { ProjectContext } from "~/types";

interface Assistant {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  description?: string;
  icon?: string;
}

const KNOWN_ASSISTANTS: Omit<Assistant, "installed">[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    description: "Anthropic's AI coding assistant"
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    description: "AI pair programming in your terminal"
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    description: "Open-source AI code assistant"
  },
];

export default function AssistantTabPage() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status, activeProject, invoke } = useConnectionStore();
  const { spawnTerminal } = useTerminalStore();

  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);
  const [aiInput, setAiInput] = useState("");
  const [generatedCommand, setGeneratedCommand] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isConnected = status === "connected";
  const projectPath = activeProject?.path || "";

  const loadAssistants = useCallback(async () => {
    if (!isConnected) return;

    try {
      // Returns array of installed command names like ["claude", "aider"]
      const installedCommands = await invoke<string[]>(
        "check_installed_assistants"
      );

      const assistantList: Assistant[] = KNOWN_ASSISTANTS.map((a) => ({
        ...a,
        installed: installedCommands.includes(a.command),
      }));

      // Always add shell
      assistantList.push({
        id: "shell",
        name: "Shell",
        command: "",
        installed: true,
        description: "Open a new terminal shell",
      });

      setAssistants(assistantList);
    } catch (err) {
      console.error("Failed to check assistants:", err);
    }
  }, [invoke, isConnected]);

  const loadProjectContext = useCallback(async () => {
    if (!projectPath || !isConnected) return;

    try {
      const context = await invoke<ProjectContext>("scan_project_context", {
        cwd: projectPath,
        forceRefresh: false,
      });
      setProjectContext(context);
    } catch (err) {
      console.error("Failed to scan project context:", err);
    }
  }, [invoke, projectPath, isConnected]);

  useEffect(() => {
    const load = async () => {
      if (!isConnected) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      await Promise.all([loadAssistants(), loadProjectContext()]);
      setIsLoading(false);
    };
    load();
  }, [loadAssistants, loadProjectContext, isConnected]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAssistants(), loadProjectContext()]);
    setRefreshing(false);
  }, [loadAssistants, loadProjectContext]);

  const handleLaunchAssistant = async (assistant: Assistant) => {
    if (!projectPath) return;

    try {
      await spawnTerminal(projectPath, assistant.command || undefined);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigate to terminal tab to see the output
      router.push("/(tabs)/terminal");
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to launch assistant"
      );
    }
  };

  const handleGenerateCommand = async () => {
    if (!aiInput.trim()) return;

    setIsGenerating(true);
    setGeneratedCommand(null);

    try {
      const result = await invoke<{ command: string }>("ai_shell_command", {
        description: aiInput,
        projectContext,
      });

      setGeneratedCommand(result.command);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to generate command"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRunCommand = async () => {
    if (!generatedCommand || !projectPath) return;

    try {
      await spawnTerminal(projectPath, generatedCommand);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setAiInput("");
      setGeneratedCommand(null);
      // Navigate to terminal to see the result
      router.push("/(tabs)/terminal");
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to run command"
      );
    }
  };

  // Not connected state
  if (!isConnected) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <WifiOff size={48} color={colors.mutedForeground} />
        <Text className="text-foreground font-medium mt-4 text-lg">
          Not Connected
        </Text>
        <Text className="text-muted-foreground text-center mt-2">
          Connect to your desktop to use AI assistants
        </Text>
        <Button className="mt-6" onPress={() => router.push("/connect")}>
          Connect to Desktop
        </Button>
      </View>
    );
  }

  // No project selected
  if (!activeProject) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <Text className="text-muted-foreground text-center">
          No project selected. Please select a project on your desktop.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.foreground}
        />
      }
    >
      {/* Smart Shell / NLT */}
      <Card className="mb-4">
        <CardHeader>
          <View className="flex-row items-center">
            <Wand2 size={18} color="#a78bfa" />
            <CardTitle className="ml-2">Smart Shell</CardTitle>
          </View>
          <CardDescription>
            Describe what you want to do in natural language
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TextInput
            className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-foreground"
            placeholder="e.g., 'run tests for the auth module'"
            placeholderTextColor={colors.mutedForeground}
            value={aiInput}
            onChangeText={setAiInput}
            multiline
            textAlignVertical="top"
          />

          {generatedCommand && (
            <View className="mt-4 p-3 rounded-md bg-secondary">
              <Text className="text-muted-foreground text-xs mb-1">
                Generated command:
              </Text>
              <Text className="text-foreground font-mono">
                $ {generatedCommand}
              </Text>
            </View>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            variant="outline"
            onPress={handleGenerateCommand}
            loading={isGenerating}
            disabled={!aiInput.trim()}
            icon={<Sparkles size={16} color="#a78bfa" />}
            className="flex-1"
          >
            Generate
          </Button>
          {generatedCommand && (
            <Button
              onPress={handleRunCommand}
              icon={<Play size={16} color="#000" />}
              className="flex-1"
            >
              Run
            </Button>
          )}
        </CardFooter>
      </Card>

      {/* Project Context */}
      {projectContext && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Project Context</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="flex-row flex-wrap gap-2">
              {projectContext.projectType && (
                <Badge variant="secondary">{projectContext.projectType}</Badge>
              )}
              {projectContext.packageManager && (
                <Badge variant="outline">{projectContext.packageManager}</Badge>
              )}
              {projectContext.hasDocker && <Badge variant="outline">Docker</Badge>}
              {projectContext.hasMakefile && (
                <Badge variant="outline">Makefile</Badge>
              )}
            </View>

            {projectContext.scripts && projectContext.scripts.length > 0 && (
              <View className="mt-4">
                <Text className="text-muted-foreground text-sm mb-2">
                  Available scripts:
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {projectContext.scripts.slice(0, 8).map((script) => (
                    <Badge key={script} variant="outline">
                      {script}
                    </Badge>
                  ))}
                  {projectContext.scripts.length > 8 && (
                    <Badge variant="secondary">
                      +{projectContext.scripts.length - 8} more
                    </Badge>
                  )}
                </View>
              </View>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Assistants */}
      <Card>
        <CardHeader>
          <View className="flex-row items-center">
            <Bot size={18} color="#60a5fa" />
            <CardTitle className="ml-2">AI Assistants</CardTitle>
          </View>
          <CardDescription>
            Launch coding assistants in the terminal
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <View className="items-center py-8">
              <Text className="text-muted-foreground">
                Loading assistants...
              </Text>
            </View>
          ) : (
            <View className="gap-3">
              {assistants.map((assistant) => (
                <View
                  key={assistant.id}
                  className="flex-row items-center justify-between p-3 rounded-md border border-border"
                >
                  <View className="flex-row items-center flex-1">
                    {assistant.id === "shell" ? (
                      <Terminal size={20} color="#22c55e" />
                    ) : (
                      <Bot size={20} color="#60a5fa" />
                    )}
                    <View className="ml-3 flex-1">
                      <Text className="text-foreground font-medium">
                        {assistant.name}
                      </Text>
                      {assistant.description && (
                        <Text className="text-muted-foreground text-xs">
                          {assistant.description}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2">
                    {assistant.installed ? (
                      <Badge variant="success">
                        <Check size={10} color="#fff" />
                        <Text className="text-white ml-1 text-xs">
                          Ready
                        </Text>
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <X size={10} color={colors.mutedForeground} />
                        <Text className="text-muted-foreground ml-1 text-xs">
                          Not found
                        </Text>
                      </Badge>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onPress={() => handleLaunchAssistant(assistant)}
                      disabled={!assistant.installed}
                      icon={<Play size={14} color="#22c55e" />}
                    >
                      Launch
                    </Button>
                  </View>
                </View>
              ))}
            </View>
          )}
        </CardContent>
      </Card>
    </ScrollView>
  );
}
