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
import { s } from "~/lib/scale";

interface AssistantTab {
  id: string;
  name: string;
  command: string;
  terminalId: string | null;
  source: "mobile" | "remote";
}

interface AssistantOption {
  id: string;
  name: string;
  command: string;
}

const ASSISTANT_OPTIONS: AssistantOption[] = [
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "antigravity", name: "Antigravity CLI", command: "agy" },
  { id: "codex", name: "OpenAI Codex", command: "codex" },
  { id: "opencode", name: "OpenCode", command: "opencode" },
  { id: "shell", name: "Shell", command: "" },
];

export default function AssistantTabPage() {
  console.log("[Assistant] Component rendering");
  const router = useRouter();
  const { colors } = useTheme();
  const { status, activeProject, invoke, remoteTerminals, attachTerminal, detachTerminal, hasReceivedInitialStatus, availableProjects } = useConnectionStore();
  console.log("[Assistant] Status:", status, "activeProject:", activeProject?.name);
  const {
    terminals: localTerminals,
    spawnTerminal,
    killTerminal,
    sendInput,
    getOutput,
    resizeTerminal,
  } = useTerminalStore();

  // Filter remote terminals to assistants that weren't spawned by mobile AND
  // belong to the current project — the desktop reports terminals from all
  // its open projects, and attaching to another project's assistant here
  // shows an unrelated (and desktop-width, so garbled) TUI.
  const localTerminalIds = new Set(localTerminals.map(t => t.id));
  const currentProjectPath = activeProject?.path || "";
  const remoteAssistants = remoteTerminals.filter(
    (t) =>
      t.type === "assistant" &&
      !localTerminalIds.has(t.id) &&
      !!currentProjectPath &&
      (t.cwd === currentProjectPath ||
        t.cwd?.startsWith(currentProjectPath + "/"))
  );

  const [tabs, setTabs] = useState<AssistantTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [installedCommands, setInstalledCommands] = useState<string[]>([]);
  const [isCheckingInstalled, setIsCheckingInstalled] = useState(true);
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const terminalRef = useRef<AssistantTerminalWebViewRef>(null);
  const [attachedRemoteIds, setAttachedRemoteIds] = useState<Set<string>>(new Set());
  const [dismissedRemoteIds, setDismissedRemoteIds] = useState<Set<string>>(new Set());


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
          setInstalledCommands(["claude", "agy", "codex", "opencode"]);
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
        if (mounted) setInstalledCommands(["claude", "agy", "codex", "opencode"]);
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

  // Load remote assistant sessions or auto-launch a local one
  useEffect(() => {
    console.log("[Assistant] Auto-load check:", {
      projectPath: !!projectPath,
      isConnected,
      hasAutoLoaded: hasAutoLoaded,
      installedCommandsLength: installedCommands.length,
      isCheckingInstalled,
      hasReceivedInitialStatus,
      remoteAssistantsCount: remoteAssistants.length,
      remoteTerminalsCount: remoteTerminals.length,
      remoteTerminalTypes: remoteTerminals.map(t => ({ id: t.id.slice(0, 8), title: t.title, type: t.type })),
    });

    // Wait for both: installed commands check AND initial status from desktop
    if (projectPath && isConnected && !hasAutoLoaded && !isCheckingInstalled && hasReceivedInitialStatus) {
      console.log("[Assistant] Auto-load conditions met, remoteAssistants:", remoteAssistants.length);

      // First, try to load remote assistant sessions
      if (remoteAssistants.length > 0) {
        console.log("[Assistant] Loading remote assistant sessions:", remoteAssistants.map(t => t.title));
        setHasAutoLoaded(true);

        // Create tabs for remote assistants
        const remoteTabs: AssistantTab[] = remoteAssistants.map(remote => ({
          id: `remote-${remote.id}`,
          name: remote.title,
          command: "",
          terminalId: remote.id,
          source: "remote" as const,
        }));

        setTabs(remoteTabs);

        // Attach to all remote assistants
        remoteAssistants.forEach(remote => {
          attachTerminal(remote.id);
          setAttachedRemoteIds(prev => {
            const next = new Set(Array.from(prev));
            next.add(remote.id);
            return next;
          });
        });

        // Activate the first remote tab
        if (remoteTabs.length > 0) {
          setActiveTabId(remoteTabs[0].id);
        }
      } else if (installedCommands.length > 0) {
        // No remote assistants, auto-launch a local one
        const defaultCommand = installedCommands.includes("claude")
          ? "claude"
          : installedCommands[0] || "";

        console.log("[Assistant] No remote assistants found, auto-launching local:", defaultCommand);

        if (defaultCommand) {
          const option = ASSISTANT_OPTIONS.find((o) => o.command === defaultCommand);
          if (option) {
            setHasAutoLoaded(true);
            handleAddTab(option);
          }
        }
      }
    }
  }, [projectPath, isConnected, hasAutoLoaded, installedCommands, isCheckingInstalled, hasReceivedInitialStatus, remoteAssistants.length]);

  // Cleanup: detach from all remote terminals when component unmounts
  useEffect(() => {
    return () => {
      Array.from(attachedRemoteIds).forEach(terminalId => {
        detachTerminal(terminalId);
      });
    };
  }, []);

  // Handle new remote assistants appearing after initial load
  useEffect(() => {
    if (!hasAutoLoaded || !isConnected) return;

    // Find new remote assistants that we don't have tabs for (and weren't dismissed)
    const currentTabIds = new Set(tabs.filter(t => t.source === "remote").map(t => t.terminalId));
    const newAssistants = remoteAssistants.filter(ra =>
      !currentTabIds.has(ra.id) && !dismissedRemoteIds.has(ra.id)
    );

    if (newAssistants.length > 0) {
      console.log("[Assistant] New remote assistants detected:", newAssistants.map(t => t.title));

      const newTabs: AssistantTab[] = newAssistants.map(remote => ({
        id: `remote-${remote.id}`,
        name: remote.title,
        command: "",
        terminalId: remote.id,
        source: "remote" as const,
      }));

      setTabs(prev => [...prev, ...newTabs]);

      // Attach to new remote assistants
      newAssistants.forEach(remote => {
        attachTerminal(remote.id);
        setAttachedRemoteIds(prev => {
          const next = new Set(Array.from(prev));
          next.add(remote.id);
          return next;
        });
      });
    }
  }, [remoteAssistants, isConnected, hasAutoLoaded, dismissedRemoteIds]);

  const handleAddTab = async (option: AssistantOption) => {
    if (!projectPath) return;

    const tabId = `${option.id}-${Date.now()}`;
    const newTab: AssistantTab = {
      id: tabId,
      name: option.name,
      command: option.command,
      terminalId: null,
      source: "mobile",
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
      if (tab.source === "remote") {
        // For remote tabs, just detach - don't kill the session
        detachTerminal(tab.terminalId);
        setAttachedRemoteIds(prev => {
          const next = new Set(prev);
          next.delete(tab.terminalId!);
          return next;
        });
        // Track as dismissed so it doesn't get re-added
        setDismissedRemoteIds(prev => {
          const next = new Set(Array.from(prev));
          next.add(tab.terminalId!);
          return next;
        });
      } else {
        // For local tabs, kill the terminal
        await killTerminal(tab.terminalId);
      }
    }

    setTabs((prev) => prev.filter((t) => t.id !== tabId));

    if (activeTabId === tabId) {
      const remaining = tabs.filter((t) => t.id !== tabId);
      setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const { sendTerminalInput: sendRemoteInput } = useConnectionStore();

  const handleTerminalInput = useCallback(
    (data: string) => {
      if (!activeTab?.terminalId) return;
      if (activeTab.source === "remote") {
        // For remote terminals, use the connection store
        sendRemoteInput(activeTab.terminalId, data);
      } else {
        // For local terminals, use the terminal store
        sendInput(activeTab.terminalId, data);
      }
    },
    [activeTab, sendInput, sendRemoteInput]
  );

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      if (!activeTab?.terminalId) return;
      resizeTerminal(activeTab.terminalId, cols, rows).catch(() => {});
    },
    [activeTab, resizeTerminal]
  );

  // Helper to send input to the correct terminal (local vs remote)
  const sendToTerminal = useCallback((data: string) => {
    if (!activeTab?.terminalId) return;
    if (activeTab.source === "remote") {
      sendRemoteInput(activeTab.terminalId, data);
    } else {
      sendInput(activeTab.terminalId, data);
    }
  }, [activeTab, sendInput, sendRemoteInput]);

  const handleEsc = useCallback(() => {
    sendToTerminal("\x1b");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sendToTerminal]);

  const handleCtrlC = useCallback(() => {
    sendToTerminal("\x03");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [sendToTerminal]);

  const handleArrowUp = useCallback(() => {
    sendToTerminal("\x1b[A");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sendToTerminal]);

  const handleArrowDown = useCallback(() => {
    sendToTerminal("\x1b[B");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sendToTerminal]);

  const handleArrowLeft = useCallback(() => {
    sendToTerminal("\x1b[D");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sendToTerminal]);

  const handleArrowRight = useCallback(() => {
    sendToTerminal("\x1b[C");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sendToTerminal]);

  const handlePaste = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      sendToTerminal(text);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [sendToTerminal]);

  const handleNewLine = useCallback(() => {
    sendToTerminal("\n");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [sendToTerminal]);

  // Not connected state
  if (!isConnected) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-4">
        <WifiOff size={s(48)} color={colors.mutedForeground} />
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
              {/* Assistant/Shell icon */}
              {tab.command === "" && tab.source === "mobile" ? (
                <TerminalIcon
                  size={s(14)}
                  color={tab.id === activeTabId ? colors.foreground : colors.mutedForeground}
                />
              ) : (
                <Bot
                  size={s(14)}
                  color={tab.id === activeTabId ? colors.foreground : colors.mutedForeground}
                />
              )}
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
                <X size={s(12)} color={colors.mutedForeground} />
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
            <Plus size={s(18)} color={colors.foreground} />
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
                        <TerminalIcon size={s(16)} color={colors.success} />
                      ) : (
                        <Bot size={s(16)} color={isInstalled ? colors.info : colors.mutedForeground} />
                      )}
                      <Text
                        className={`ml-2 ${
                          isInstalled ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {option.name}
                      </Text>
                    </View>
                    {isInstalled && <Check size={s(14)} color={colors.success} />}
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
          <Bot size={s(48)} color={colors.mutedForeground} />
          <Text className="text-foreground font-medium mt-4">
            {isCheckingInstalled ? "Loading..." : "No assistants running"}
          </Text>
          <Text className="text-muted-foreground text-center mt-2 px-8">
            {isCheckingInstalled
              ? "Checking installed coding assistants..."
              : "Tap + to launch a coding assistant"}
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
              <Bot size={s(32)} color={colors.muted} />
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
              <CornerDownLeft size={s(20)} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handlePaste}
              className="mr-2"
            >
              <ClipboardPaste size={s(16)} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowUp}
              className="mr-2"
            >
              <ArrowUp size={s(20)} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowDown}
              className="mr-2"
            >
              <ArrowDown size={s(20)} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowLeft}
              className="mr-2"
            >
              <ArrowLeft size={s(20)} color={colors.primary} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleArrowRight}
              className="mr-2"
            >
              <ArrowRight size={s(20)} color={colors.primary} />
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
              <KeyboardIcon size={s(18)} color={colors.primary} />
              {isKeyboardVisible ? (
                <ChevronDown size={s(14)} color={colors.primary} style={{ marginLeft: 4 }} />
              ) : (
                <ChevronUp size={s(14)} color={colors.primary} style={{ marginLeft: 4 }} />
              )}
            </Button>
          </View>

        </>
      )}
    </KeyboardAvoidingView>
  );
}
