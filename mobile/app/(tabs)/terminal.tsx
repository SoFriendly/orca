import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Plus, X, Terminal as TerminalIcon, Send, WifiOff, Sparkles, Wand2 } from "lucide-react-native";
import { useConnectionStore } from "~/stores/connectionStore";
import { useTerminalStore } from "~/stores/terminalStore";
import { useTheme } from "~/components/ThemeProvider";
import { Button, Card, CardContent } from "~/components/ui";
import type { ProjectContext } from "~/types";

export default function TerminalTabPage() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status, activeProject } = useConnectionStore();
  const {
    terminals,
    activeTerminalId,
    spawnTerminal,
    killTerminal,
    setActiveTerminal,
    sendInput,
    getOutput,
  } = useTerminalStore();

  const [input, setInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollViewRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  // Smart Shell / NLT state
  const [showNLT, setShowNLT] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [generatedCommand, setGeneratedCommand] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectContext, setProjectContext] = useState<ProjectContext | null>(null);

  const isConnected = status === "connected";
  const projectPath = activeProject?.path || "";
  const { invoke } = useConnectionStore();

  // Filter to only show shell terminals (not assistant terminals)
  const shellTerminals = terminals.filter((t) => t.type === "shell");
  const activeTerminal = shellTerminals.find((t) => t.id === activeTerminalId);
  const output = activeTerminalId ? getOutput(activeTerminalId) : [];

  // Spawn initial terminal if none exists
  useEffect(() => {
    if (projectPath && isConnected && terminals.length === 0) {
      spawnTerminal(projectPath);
    }
  }, [projectPath, isConnected]);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [output]);

  const handleNewTerminal = async () => {
    if (!projectPath) return;
    await spawnTerminal(projectPath);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleCloseTerminal = async (terminalId: string) => {
    await killTerminal(terminalId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSend = useCallback(() => {
    if (!activeTerminalId || !input.trim()) return;

    // Add to history
    if (input.trim()) {
      setCommandHistory((prev) => [...prev.slice(-50), input]);
      setHistoryIndex(-1);
    }

    // Use bracketed paste mode escape sequences so TUIs recognize this as input
    // \x1b[200~ = start paste, \x1b[201~ = end paste, \r = Enter
    const bracketedInput = `\x1b[200~${input}\x1b[201~\r`;
    sendInput(activeTerminalId, bracketedInput);
    setInput("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTerminalId, input, sendInput]);

  const handleHistoryUp = useCallback(() => {
    if (commandHistory.length === 0) return;

    const newIndex =
      historyIndex === -1
        ? commandHistory.length - 1
        : Math.max(0, historyIndex - 1);

    setHistoryIndex(newIndex);
    setInput(commandHistory[newIndex]);
  }, [commandHistory, historyIndex]);

  const handleHistoryDown = useCallback(() => {
    if (historyIndex === -1) return;

    const newIndex = historyIndex + 1;
    if (newIndex >= commandHistory.length) {
      setHistoryIndex(-1);
      setInput("");
    } else {
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex]);
    }
  }, [commandHistory, historyIndex]);

  const handleCtrlC = useCallback(() => {
    if (!activeTerminalId) return;
    sendInput(activeTerminalId, "\x03");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [activeTerminalId, sendInput]);

  const handleTab = useCallback(() => {
    if (!activeTerminalId) return;
    sendInput(activeTerminalId, "\t");
  }, [activeTerminalId, sendInput]);

  // Load project context for Smart Shell
  useEffect(() => {
    const loadContext = async () => {
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
    };
    loadContext();
  }, [projectPath, isConnected, invoke]);

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

  const handleRunGeneratedCommand = async () => {
    if (!generatedCommand || !activeTerminalId) return;

    // Use bracketed paste mode for generated commands too
    const bracketedInput = `\x1b[200~${generatedCommand}\x1b[201~\r`;
    sendInput(activeTerminalId, bracketedInput);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAiInput("");
    setGeneratedCommand(null);
    setShowNLT(false);
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
          Connect to your desktop to use the terminal
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
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      {/* Terminal Tabs */}
      <View className="flex-row items-center border-b border-border p-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-1"
        >
          {shellTerminals.map((terminal) => (
            <Pressable
              key={terminal.id}
              className={`flex-row items-center mr-2 px-3 py-1.5 rounded-md ${
                terminal.id === activeTerminalId
                  ? "bg-secondary"
                  : "bg-transparent"
              }`}
              onPress={() => setActiveTerminal(terminal.id)}
            >
              <TerminalIcon
                size={14}
                color={terminal.id === activeTerminalId ? "#22c55e" : colors.mutedForeground}
              />
              <Text
                className={`ml-2 text-sm ${
                  terminal.id === activeTerminalId
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {terminal.title}
              </Text>
              <Pressable
                className="ml-2 p-1"
                onPress={() => handleCloseTerminal(terminal.id)}
              >
                <X size={12} color={colors.mutedForeground} />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
        <Button variant="ghost" size="icon" onPress={handleNewTerminal}>
          <Plus size={18} color={colors.foreground} />
        </Button>
      </View>

      {/* Terminal Output */}
      <ScrollView
        ref={scrollViewRef}
        className="flex-1"
        style={{ backgroundColor: "#000" }}
        contentContainerStyle={{ padding: 8, paddingBottom: 16 }}
      >
        {output.length === 0 ? (
          <View className="items-center justify-center py-8">
            <TerminalIcon size={32} color="#333" />
            <Text style={{ color: "#666" }} className="mt-4">
              Terminal ready
            </Text>
            <Text style={{ color: "#444" }} className="text-sm mt-1">
              {activeTerminal?.cwd}
            </Text>
          </View>
        ) : (
          output.map((line, index) => (
            <Text
              key={index}
              style={{ color: "#4ade80", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
              className="text-sm leading-5"
              selectable
            >
              {line}
            </Text>
          ))
        )}
      </ScrollView>

      {/* Smart Shell / NLT */}
      {showNLT && (
        <View className="border-t border-border bg-card p-3">
          <View className="flex-row items-center mb-2">
            <Wand2 size={16} color="#a78bfa" />
            <Text className="text-foreground font-medium ml-2 text-sm">
              Natural Language Terminal
            </Text>
          </View>
          <TextInput
            className="min-h-16 w-full rounded-md border border-input bg-background p-3 text-foreground text-sm"
            placeholder="Describe what you want to do..."
            placeholderTextColor={colors.mutedForeground}
            value={aiInput}
            onChangeText={setAiInput}
            multiline
            textAlignVertical="top"
          />
          {generatedCommand && (
            <View className="mt-2 p-2 rounded-md bg-secondary">
              <Text className="text-muted-foreground text-xs">Command:</Text>
              <Text className="text-foreground font-mono text-sm">
                $ {generatedCommand}
              </Text>
            </View>
          )}
          <View className="flex-row gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              onPress={handleGenerateCommand}
              loading={isGenerating}
              disabled={!aiInput.trim()}
              className="flex-1"
            >
              <Sparkles size={14} color="#a78bfa" />
              <Text className="ml-1 text-foreground">Generate</Text>
            </Button>
            {generatedCommand && (
              <Button
                size="sm"
                onPress={handleRunGeneratedCommand}
                className="flex-1"
              >
                <Text className="text-black">Run</Text>
              </Button>
            )}
          </View>
        </View>
      )}

      {/* Quick Actions */}
      <View className="flex-row items-center border-t border-border bg-card px-2 py-1">
        <Button
          variant={showNLT ? "secondary" : "ghost"}
          size="sm"
          onPress={() => setShowNLT(!showNLT)}
          className="mr-1"
        >
          <Sparkles size={14} color={showNLT ? "#a78bfa" : colors.mutedForeground} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleCtrlC}
          className="mr-1"
        >
          <Text className="text-destructive text-xs font-mono">^C</Text>
        </Button>
        <Button variant="ghost" size="sm" onPress={handleTab} className="mr-1">
          <Text className="text-muted-foreground text-xs font-mono">TAB</Text>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleHistoryUp}
          className="mr-1"
        >
          <Text className="text-muted-foreground text-xs font-mono">↑</Text>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleHistoryDown}
          className="mr-1"
        >
          <Text className="text-muted-foreground text-xs font-mono">↓</Text>
        </Button>
        <View className="flex-1" />
        <Text className="text-muted-foreground text-xs mr-2">
          {shellTerminals.length} terminal{shellTerminals.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Input */}
      <View className="flex-row items-center border-t border-border bg-card p-2">
        <Text style={{ color: "#4ade80", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }} className="mr-2">
          $
        </Text>
        <TextInput
          ref={inputRef}
          className="flex-1 h-10 text-foreground"
          style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
          value={input}
          onChangeText={setInput}
          placeholder="Enter command..."
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <Button
          variant="ghost"
          size="icon"
          onPress={handleSend}
          disabled={!input.trim()}
        >
          <Send size={18} color={input.trim() ? "#22c55e" : colors.mutedForeground} />
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
