import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Pressable,
  Alert,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import {
  Bot,
  Plus,
  X,
  Terminal as TerminalIcon,
  WifiOff,
  ChevronDown,
  ChevronUp,
  Check,
  Keyboard as KeyboardIcon,
  ClipboardPaste,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from "lucide-react-native";
import { useConnectionStore } from "~/stores/connectionStore";
import { useTerminalStore } from "~/stores/terminalStore";
import { useTheme } from "~/components/ThemeProvider";
import { Button } from "~/components/ui";
import AssistantTerminalWebView, { AssistantTerminalWebViewRef } from "~/components/AssistantTerminalWebView";

interface AssistantTab {
  id: string;
  name: string;
  command: string;
  terminalId: string | null;
}

interface AssistantOption {
  id: string;
  name: string;
  command: string;
}

const ASSISTANT_OPTIONS: AssistantOption[] = [
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "aider", name: "Aider", command: "aider" },
  { id: "gemini", name: "Gemini CLI", command: "gemini" },
  { id: "codex", name: "OpenAI Codex", command: "codex" },
  { id: "opencode", name: "OpenCode", command: "opencode" },
  { id: "shell", name: "Shell", command: "" },
];

export default function AssistantTabPage() {
  console.log("[Assistant] Component rendering");
  const router = useRouter();
  const { colors } = useTheme();
  const { status, activeProject, invoke } = useConnectionStore();
  console.log("[Assistant] Status:", status, "activeProject:", activeProject?.name);
  const {
    spawnTerminal,
    killTerminal,
    sendInput,
    getOutput,
    resizeTerminal,
  } = useTerminalStore();

  const [tabs, setTabs] = useState<AssistantTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [installedCommands, setInstalledCommands] = useState<string[]>([]);
  const [isCheckingInstalled, setIsCheckingInstalled] = useState(true);
  const [hasAutoLaunched, setHasAutoLaunched] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const terminalRef = useRef<AssistantTerminalWebViewRef>(null);


  const isConnected = status === "connected";
  const projectPath = activeProject?.path || "";
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const output = activeTab?.terminalId ? getOutput(activeTab.terminalId) : [];

  // Check installed assistants
  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    const checkInstalled = async () => {
      console.log("[Assistant] checkInstalled called, isConnected:", isConnected);
      if (!isConnected) {
        console.log("[Assistant] Not connected, skipping check");
        if (mounted) setIsCheckingInstalled(false);
        return;
      }

      if (mounted) setIsCheckingInstalled(true);

      // Safety timeout - if the command takes too long, use fallback
      timeoutId = setTimeout(() => {
        if (mounted) {
          console.log("[Assistant] Check timed out, using fallback");
          setInstalledCommands(["claude", "aider", "gemini", "codex", "opencode"]);
          setIsCheckingInstalled(false);
        }
      }, 10000);

      console.log("[Assistant] Calling check_installed_assistants...");
      try {
        const installed = await invoke<string[]>("check_installed_assistants");
        console.log("[Assistant] Installed commands:", installed);
        if (mounted) setInstalledCommands(installed);
      } catch (err) {
        console.error("[Assistant] Failed to check installed assistants:", err);
        // Default to allowing all if check fails
        console.log("[Assistant] Using fallback assistant list");
        if (mounted) setInstalledCommands(["claude", "aider", "gemini", "codex", "opencode"]);
      } finally {
        console.log("[Assistant] Check complete, setting isCheckingInstalled to false");
        clearTimeout(timeoutId);
        if (mounted) setIsCheckingInstalled(false);
      }
    };
    checkInstalled();

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [isConnected, invoke]);

  // Auto-launch default assistant (claude) when first opening
  useEffect(() => {
    console.log("[Assistant] Auto-launch check:", {
      projectPath: !!projectPath,
      isConnected,
      hasAutoLaunched,
      installedCommandsLength: installedCommands.length,
      isCheckingInstalled,
    });

    if (projectPath && isConnected && !hasAutoLaunched && installedCommands.length > 0) {
      // Default to claude if installed, otherwise first installed
      const defaultCommand = installedCommands.includes("claude")
        ? "claude"
        : installedCommands[0] || "";

      console.log("[Assistant] Auto-launching:", defaultCommand);

      if (defaultCommand) {
        const option = ASSISTANT_OPTIONS.find((o) => o.command === defaultCommand);
        if (option) {
          handleAddTab(option);
          setHasAutoLaunched(true);
        }
      }
    }
  }, [projectPath, isConnected, hasAutoLaunched, installedCommands]);


  const handleAddTab = async (option: AssistantOption) => {
    if (!projectPath) return;

    const tabId = `${option.id}-${Date.now()}`;
    const newTab: AssistantTab = {
      id: tabId,
      name: option.name,
      command: option.command,
      terminalId: null,
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(tabId);
    setShowDropdown(false);

    try {
      // Pass "assistant" type to distinguish from shell terminals
      const terminalId = await spawnTerminal(projectPath, option.command || undefined, "assistant");
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, terminalId } : t))
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.error("[Assistant] Failed to spawn terminal:", err);
      Alert.alert("Error", "Failed to launch assistant");
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
    }
  };

  const handleCloseTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.terminalId) {
      await killTerminal(tab.terminalId);
    }

    setTabs((prev) => prev.filter((t) => t.id !== tabId));

    if (activeTabId === tabId) {
      const remaining = tabs.filter((t) => t.id !== tabId);
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleTerminalInput = useCallback(
    (data: string) => {
      if (!activeTab?.terminalId) return;
      sendInput(activeTab.terminalId, data);
    },
    [activeTab, sendInput]
  );

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      if (!activeTab?.terminalId) return;
      resizeTerminal(activeTab.terminalId, cols, rows).catch(() => {});
    },
    [activeTab, resizeTerminal]
  );

  const handleEsc = useCallback(() => {
    if (!activeTab?.terminalId) return;
    sendInput(activeTab.terminalId, "\x1b");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTab, sendInput]);

  const handleCtrlC = useCallback(() => {
    if (!activeTab?.terminalId) return;
    sendInput(activeTab.terminalId, "\x03");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [activeTab, sendInput]);

  const handleArrowUp = useCallback(() => {
    if (!activeTab?.terminalId) return;
    sendInput(activeTab.terminalId, "\x1b[A");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTab, sendInput]);

  const handleArrowDown = useCallback(() => {
    if (!activeTab?.terminalId) return;
    sendInput(activeTab.terminalId, "\x1b[B");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTab, sendInput]);

  const handleArrowLeft = useCallback(() => {
    if (!activeTab?.terminalId) return;
    sendInput(activeTab.terminalId, "\x1b[D");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTab, sendInput]);

  const handleArrowRight = useCallback(() => {
    if (!activeTab?.terminalId) return;
    sendInput(activeTab.terminalId, "\x1b[C");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTab, sendInput]);

  const handlePaste = useCallback(async () => {
    if (!activeTab?.terminalId) return;
    const text = await Clipboard.getStringAsync();
    if (text) {
      sendInput(activeTab.terminalId, text);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [activeTab, sendInput]);

  const handleNewLine = useCallback(() => {
    if (!activeTab?.terminalId) return;
    sendInput(activeTab.terminalId, "\n");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTab, sendInput]);

  // Not connected state
  if (!isConnected) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <WifiOff size={48} color={colors.mutedForeground} />
        <Text className="text-foreground font-medium mt-4 text-lg">
          Not Connected
        </Text>
        <Text className="text-muted-foreground text-center mt-2">
          Connect to your desktop to use coding assistants
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
          No project selected. Select a project from the home screen.
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
      {/* Tab Bar */}
      <View className="flex-row items-center border-b border-border p-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-1"
        >
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              className={`flex-row items-center mr-2 px-3 py-1.5 rounded-md ${
                tab.id === activeTabId ? "bg-secondary" : "bg-transparent"
              }`}
              onPress={() => setActiveTabId(tab.id)}
            >
              <Bot
                size={14}
                color={tab.id === activeTabId ? colors.foreground : colors.mutedForeground}
              />
              <Text
                className={`ml-2 text-sm ${
                  tab.id === activeTabId
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
                numberOfLines={1}
              >
                {tab.name}
              </Text>
              <Pressable
                className="ml-2 p-1"
                onPress={() => handleCloseTab(tab.id)}
              >
                <X size={12} color={colors.mutedForeground} />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>

        {/* Add Tab Dropdown */}
        <View>
          <Button
            variant="ghost"
            size="icon"
            onPress={() => setShowDropdown(!showDropdown)}
          >
            <Plus size={18} color={colors.foreground} />
          </Button>

          {showDropdown && (
            <View
              className="absolute right-0 top-10 bg-card border border-border rounded-lg shadow-lg z-50"
              style={{ minWidth: 180 }}
            >
              {ASSISTANT_OPTIONS.map((option) => {
                const isInstalled =
                  option.command === "" || installedCommands.includes(option.command);

                return (
                  <Pressable
                    key={option.id}
                    className="flex-row items-center justify-between px-4 py-3 border-b border-border"
                    onPress={() => isInstalled && handleAddTab(option)}
                    disabled={!isInstalled}
                  >
                    <View className="flex-row items-center">
                      {option.command === "" ? (
                        <TerminalIcon size={16} color={colors.success} />
                      ) : (
                        <Bot size={16} color={isInstalled ? colors.info : colors.mutedForeground} />
                      )}
                      <Text
                        className={`ml-2 ${
                          isInstalled ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {option.name}
                      </Text>
                    </View>
                    {isInstalled && <Check size={14} color={colors.success} />}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </View>

      {/* Terminal Output or Empty State */}
      {tabs.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Bot size={48} color={colors.mutedForeground} />
          <Text className="text-foreground font-medium mt-4">
            {isCheckingInstalled ? "Loading..." : "No assistants running"}
          </Text>
          <Text className="text-muted-foreground text-center mt-2 px-8">
            {isCheckingInstalled
              ? "Checking installed coding assistants..."
              : "Tap + to launch a coding assistant like Claude Code or Aider"}
          </Text>
        </View>
      ) : (
        <>
          {activeTab?.terminalId ? (
            <AssistantTerminalWebView
              ref={terminalRef}
              key={activeTab.terminalId}
              terminalId={activeTab.terminalId}
              output={output}
              onInput={handleTerminalInput}
              onResize={handleTerminalResize}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Bot size={32} color={colors.muted} />
              <Text style={{ color: colors.mutedForeground }} className="mt-4">
                {activeTab?.name} starting...
              </Text>
            </View>
          )}

          {/* Quick Actions */}
          <View className="flex-row items-center border-t border-border bg-card pl-1 pr-2 py-1">
            <Button
              variant="ghost"
              size="sm"
              onPress={handleCtrlC}
              className="mr-2"
            >
              <Text style={{ color: colors.primary, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "bold" }} className="text-base">^C</Text>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleEsc}
              className="mr-2"
            >
              <Text style={{ color: colors.primary, fontWeight: "bold" }} className="text-base">ESC</Text>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleNewLine}
              className="mr-2"
            >
              <CornerDownLeft size={20} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handlePaste}
              className="mr-2"
            >
              <ClipboardPaste size={16} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowUp}
              className="mr-2"
            >
              <ArrowUp size={20} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowDown}
              className="mr-2"
            >
              <ArrowDown size={20} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowLeft}
              className="mr-2"
            >
              <ArrowLeft size={20} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowRight}
              className="mr-2"
            >
              <ArrowRight size={20} color={colors.primary} />
            </Button>
            <View className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                if (isKeyboardVisible) {
                  terminalRef.current?.dismissKeyboard();
                  setIsKeyboardVisible(false);
                } else {
                  terminalRef.current?.focusKeyboard();
                  setIsKeyboardVisible(true);
                }
              }}
              className="flex-row items-center"
            >
              <KeyboardIcon size={18} color={colors.primary} />
              {isKeyboardVisible ? (
                <ChevronDown size={14} color={colors.primary} style={{ marginLeft: 4 }} />
              ) : (
                <ChevronUp size={14} color={colors.primary} style={{ marginLeft: 4 }} />
              )}
            </Button>
          </View>

        </>
      )}
    </KeyboardAvoidingView>
  );
}
