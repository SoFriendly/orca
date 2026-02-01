import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Alert,
  TextInput,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  FileText,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  WifiOff,
} from "lucide-react-native";
import { useConnectionStore } from "~/stores/connectionStore";
import { useGitStore } from "~/stores/gitStore";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Separator,
  SectionHeader,
  FileStatusDot,
} from "~/components/ui";
import { useTheme } from "~/components/ThemeProvider";
import { formatTimestamp, truncate } from "~/lib/utils";

export default function GitTabPage() {
  const router = useRouter();
  const { colors } = useTheme();
  const { status, activeProject } = useConnectionStore();
  const {
    status: gitStatus,
    diffs,
    branches,
    history,
    loading,
    error,
    refresh,
    commit,
    stageFile,
    unstageFile,
    discardFile,
    checkoutBranch,
    createBranch,
    pull,
    push,
    generateCommitMessage,
  } = useGitStore();

  const [activeTab, setActiveTab] = useState("changes");
  const [commitSubject, setCommitSubject] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const lastDiffsHash = useRef<string>("");
  const hasGeneratedInitialMessage = useRef(false);

  const isConnected = status === "connected";
  const projectPath = activeProject?.path || "";

  useEffect(() => {
    if (projectPath && isConnected) {
      refresh(projectPath);
    }
  }, [projectPath, isConnected]);

  // Auto-refresh every 5 seconds when connected
  useEffect(() => {
    if (!projectPath || !isConnected) return;

    const interval = setInterval(() => {
      refresh(projectPath);
    }, 5000);

    return () => clearInterval(interval);
  }, [projectPath, isConnected]);

  const onRefresh = useCallback(async () => {
    if (!projectPath || !isConnected) return;
    setRefreshing(true);
    await refresh(projectPath);
    setRefreshing(false);
  }, [projectPath, isConnected]);

  const handleGenerateMessage = async () => {
    console.log("[Git] handleGenerateMessage called, diffs:", diffs.length, "gitStatus:", gitStatus);

    // Give immediate haptic feedback so user knows button was pressed
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Use diffs if available, otherwise create fallback
    if (diffs.length === 0) {
      // Fallback: just list the files
      const allFiles = [...(gitStatus?.staged || []), ...(gitStatus?.unstaged || []), ...(gitStatus?.untracked || [])];
      console.log("[Git] No diffs, allFiles:", allFiles.length);
      if (allFiles.length > 0) {
        const fileNames = allFiles.map(f => f.split('/').pop()).slice(0, 3).join(', ');
        setCommitSubject(`Update ${fileNames}${allFiles.length > 3 ? '...' : ''}`);
      } else {
        Alert.alert("No Changes", "No changes detected. Make sure you're connected to your desktop and have uncommitted changes.");
      }
      return;
    }

    setIsGenerating(true);
    console.log("[Git] Calling generateCommitMessage with", diffs.length, "diffs");
    try {
      const { subject, description } = await generateCommitMessage(diffs);
      console.log("[Git] Got response:", subject);
      setCommitSubject(subject);
      setCommitDescription(description);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error("[Git] Failed to generate commit message:", err);
      Alert.alert("AI Error", err instanceof Error ? err.message : "Failed to generate commit message");
      // Fallback to simple message
      const fileNames = diffs.map(d => d.path.split('/').pop()).join(', ');
      setCommitSubject(`Update ${fileNames}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-generate commit message when diffs change
  useEffect(() => {
    const runAutoGenerate = async () => {
      const diffsHash = JSON.stringify(diffs.map(d => d.path + d.status).sort());

      if (diffs.length === 0) {
        // Only clear if there are truly no changes at all
        const hasAnyChanges = (gitStatus?.staged?.length || 0) + (gitStatus?.unstaged?.length || 0) + (gitStatus?.untracked?.length || 0) > 0;
        if (!hasAnyChanges) {
          setCommitSubject("");
          setCommitDescription("");
          hasGeneratedInitialMessage.current = false;
        }
        lastDiffsHash.current = "";
      } else if (diffsHash !== lastDiffsHash.current) {
        const previousHash = lastDiffsHash.current;
        lastDiffsHash.current = diffsHash;

        // Auto-generate on first load
        if (!previousHash || !hasGeneratedInitialMessage.current) {
          hasGeneratedInitialMessage.current = true;
          setIsGenerating(true);
          try {
            const { subject, description } = await generateCommitMessage(diffs);
            setCommitSubject(subject);
            setCommitDescription(description);
          } catch (err) {
            console.error("Failed to generate commit message:", err);
            const fileNames = diffs.map(d => d.path.split('/').pop()).join(', ');
            setCommitSubject(`Update ${fileNames}`);
          } finally {
            setIsGenerating(false);
          }
        }
      }
    };

    runAutoGenerate();
  }, [diffs, gitStatus, generateCommitMessage]);

  const handleCommit = async () => {
    if (!commitSubject?.trim()) {
      Alert.alert("Error", "Please enter a commit message");
      return;
    }

    const fullMessage = commitDescription.trim()
      ? `${commitSubject}\n\n${commitDescription}`
      : commitSubject;

    try {
      await commit(projectPath, fullMessage);
      setCommitSubject("");
      setCommitDescription("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Changes committed successfully");
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to commit"
      );
    }
  };

  const handlePull = async () => {
    try {
      await pull(projectPath);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to pull");
    }
  };

  const handlePush = async () => {
    try {
      await push(projectPath);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to push");
    }
  };

  const handleStageFile = async (filePath: string) => {
    await stageFile(projectPath, filePath);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleUnstageFile = async (filePath: string) => {
    await unstageFile(projectPath, filePath);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDiscardFile = (filePath: string) => {
    Alert.alert(
      "Discard Changes",
      `Are you sure you want to discard changes to ${filePath}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: async () => {
            await discardFile(projectPath, filePath);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  const showFileContextMenu = (filePath: string, canDiscard: boolean = true) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const buttons: Array<{ text: string; style?: "cancel" | "destructive" | "default"; onPress?: () => void }> = [
      {
        text: "Copy Path",
        onPress: async () => {
          await Clipboard.setStringAsync(filePath);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ];
    if (canDiscard) {
      buttons.push({
        text: "Discard",
        style: "destructive",
        onPress: () => handleDiscardFile(filePath),
      });
    }
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(filePath, undefined, buttons);
  };

  const handleCheckoutBranch = async (branch: string) => {
    try {
      await checkoutBranch(projectPath, branch);
      setShowBranchPicker(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to checkout branch"
      );
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;

    try {
      await createBranch(projectPath, newBranchName);
      setNewBranchName("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to create branch"
      );
    }
  };

  const toggleFileExpanded = (filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  // Get diff for a file
  const getDiffForFile = (filePath: string) => {
    return diffs.find((d) => d.path === filePath);
  };

  // Normalize git status to one of: added, modified, deleted
  const normalizeStatus = (status: string | undefined): "added" | "modified" | "deleted" => {
    if (status === "added") return "added";
    if (status === "deleted") return "deleted";
    return "modified"; // renamed, modified, or unknown -> modified
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
          Connect to your desktop to view git status
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

  const stagedFiles = gitStatus?.staged || [];
  const unstagedFiles = gitStatus?.unstaged || [];
  const untrackedFiles = gitStatus?.untracked || [];
  const currentBranch = branches.find((b) => b.isHead);

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
      {/* Branch Header */}
      <Card className="mb-4">
        <CardContent className="flex-row items-center justify-between py-3">
          <Pressable
            className="flex-row items-center flex-1 mr-2"
            onPress={() => setShowBranchPicker(!showBranchPicker)}
          >
            <GitBranch size={16} color={colors.ai} />
            <Text
              className="text-foreground font-medium ml-2 flex-1"
              numberOfLines={1}
            >
              {gitStatus?.branch || "main"}
            </Text>
            <ChevronDown size={14} color={colors.mutedForeground} />
          </Pressable>

          <View className="flex-row gap-2">
            {gitStatus && gitStatus.behind > 0 && (
              <Badge variant="outline">
                <ArrowDown size={12} color={colors.foreground} />
                <Text className="text-foreground ml-1">{gitStatus.behind}</Text>
              </Badge>
            )}
            {gitStatus && gitStatus.ahead > 0 && (
              <Badge variant="outline">
                <ArrowUp size={12} color={colors.foreground} />
                <Text className="text-foreground ml-1">{gitStatus.ahead}</Text>
              </Badge>
            )}
          </View>

          <View className="flex-row gap-2">
            <Button
              variant="outline"
              size="icon"
              onPress={handlePull}
              disabled={loading}
            >
              <ArrowDown size={16} color={colors.foreground} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onPress={handlePush}
              disabled={loading}
            >
              <ArrowUp size={16} color={colors.foreground} />
            </Button>
          </View>
        </CardContent>
      </Card>

      {/* Branch Picker */}
      {showBranchPicker && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Switch Branch</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollView className="max-h-48">
              {branches
                .filter((b) => !b.isRemote)
                .map((branch) => (
                  <Button
                    key={branch.name}
                    variant={branch.isHead ? "secondary" : "ghost"}
                    className="justify-start mb-1"
                    onPress={() => handleCheckoutBranch(branch.name)}
                  >
                    <GitBranch size={14} color={branch.isHead ? colors.ai : colors.mutedForeground} />
                    <Text
                      className={`ml-2 ${
                        branch.isHead ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {branch.name}
                    </Text>
                    {branch.isHead && <Check size={14} color={colors.success} />}
                  </Button>
                ))}
            </ScrollView>
            <Separator className="my-3" />
            <View className="flex-row gap-2">
              <TextInput
                className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-foreground"
                placeholder="New branch name"
                placeholderTextColor={colors.mutedForeground}
                value={newBranchName}
                onChangeText={setNewBranchName}
              />
              <Button
                size="sm"
                onPress={handleCreateBranch}
                disabled={!newBranchName.trim()}
              >
                <Plus size={16} color="#000" />
              </Button>
            </View>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Changes Tab */}
        <TabsContent value="changes">
          {/* Staged Files */}
          {stagedFiles.length > 0 && (
            <View className="mb-4">
              <SectionHeader>Staged Changes ({stagedFiles.length})</SectionHeader>
              <Card>
                <CardContent className="p-0">
                  {stagedFiles.map((file, index) => {
                    const diff = getDiffForFile(file);
                    const isExpanded = expandedFiles.has(file);
                    const fileStatus = normalizeStatus(diff?.status);

                    return (
                      <View key={file}>
                        <Pressable
                          className={`flex-row items-center gap-3 px-4 py-3 ${
                            index < stagedFiles.length - 1 ? "border-b border-border" : ""
                          }`}
                          onPress={() => toggleFileExpanded(file)}
                          onLongPress={() => showFileContextMenu(file, false)}
                        >
                          <ChevronRight
                            size={16}
                            color={colors.mutedForeground}
                            style={{
                              transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
                            }}
                          />
                          <FileStatusDot status={fileStatus} />
                          <Text
                            className="text-foreground font-mono text-sm flex-1"
                            numberOfLines={1}
                          >
                            {file}
                          </Text>
                        </Pressable>

                        {/* Diff view */}
                        {isExpanded && (
                          <View className="mx-4 mb-3 p-3 rounded" style={{ backgroundColor: '#0d0d0d' }}>
                            {diff && diff.hunks && diff.hunks.length > 0 ? (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View>
                                  {diff.hunks.map((hunk, hunkIndex) => (
                                    <View key={hunkIndex}>
                                      {(hunk.lines || []).filter(l => l != null).map((line, lineIndex) => (
                                          <Text
                                            key={lineIndex}
                                            className="font-mono text-xs leading-relaxed"
                                            style={{
                                              color: line.type === 'addition' ? colors.success
                                                : line.type === 'deletion' ? colors.destructive
                                                : colors.foreground
                                            }}
                                          >
                                            {line.content}
                                          </Text>
                                      ))}
                                    </View>
                                  ))}
                                </View>
                              </ScrollView>
                            ) : (
                              <Text className="text-muted-foreground font-mono text-xs">
                                No diff available
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </CardContent>
              </Card>
            </View>
          )}

          {/* Unstaged Changes (Modified + Untracked) */}
          {(unstagedFiles.length > 0 || untrackedFiles.length > 0) && (
            <View className="mb-4">
              <SectionHeader>Unstaged Changes ({unstagedFiles.length + untrackedFiles.length})</SectionHeader>
              <Card>
                <CardContent className="p-0">
                  {/* Modified files */}
                  {unstagedFiles.map((file, index) => {
                    const diff = getDiffForFile(file);
                    const isExpanded = expandedFiles.has(file);
                    const isLast = index === unstagedFiles.length - 1 && untrackedFiles.length === 0;
                    const fileStatus = normalizeStatus(diff?.status);

                    return (
                      <View key={file}>
                        <Pressable
                          className={`flex-row items-center gap-3 px-4 py-3 ${
                            !isLast ? "border-b border-border" : ""
                          }`}
                          onPress={() => toggleFileExpanded(file)}
                          onLongPress={() => showFileContextMenu(file, true)}
                        >
                          <ChevronRight
                            size={16}
                            color={colors.mutedForeground}
                            style={{
                              transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
                            }}
                          />
                          <FileStatusDot status={fileStatus} />
                          <Text
                            className="text-foreground font-mono text-sm flex-1"
                            numberOfLines={1}
                          >
                            {file}
                          </Text>
                        </Pressable>

                        {/* Diff view */}
                        {isExpanded && (
                          <View className="mx-4 mb-3 p-3 rounded" style={{ backgroundColor: '#0d0d0d' }}>
                            {diff && diff.hunks && diff.hunks.length > 0 ? (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View>
                                  {diff.hunks.map((hunk, hunkIndex) => (
                                    <View key={hunkIndex}>
                                      {(hunk.lines || []).filter(l => l != null).map((line, lineIndex) => (
                                          <Text
                                            key={lineIndex}
                                            className="font-mono text-xs leading-relaxed"
                                            style={{
                                              color: line.type === 'addition' ? colors.success
                                                : line.type === 'deletion' ? colors.destructive
                                                : colors.foreground
                                            }}
                                          >
                                            {line.content}
                                          </Text>
                                      ))}
                                    </View>
                                  ))}
                                </View>
                              </ScrollView>
                            ) : (
                              <Text className="text-muted-foreground font-mono text-xs">
                                No diff available
                              </Text>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {/* Untracked files */}
                  {untrackedFiles.map((file, index) => {
                    const isExpanded = expandedFiles.has(file);
                    const isLast = index === untrackedFiles.length - 1;

                    return (
                      <Pressable
                        key={file}
                        className={`flex-row items-center gap-3 px-4 py-3 ${
                          !isLast ? "border-b border-border" : ""
                        }`}
                        onPress={() => toggleFileExpanded(file)}
                        onLongPress={() => showFileContextMenu(file, true)}
                      >
                        <ChevronRight
                          size={16}
                          color={colors.mutedForeground}
                          style={{
                            transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
                          }}
                        />
                        <FileStatusDot status="added" />
                        <Text
                          className="text-foreground font-mono text-sm flex-1"
                          numberOfLines={1}
                        >
                          {file}
                        </Text>
                      </Pressable>
                    );
                  })}
                </CardContent>
              </Card>
            </View>
          )}

          {/* Empty State */}
          {stagedFiles.length === 0 &&
            unstagedFiles.length === 0 &&
            untrackedFiles.length === 0 && (
              <Card>
                <CardContent className="items-center py-8">
                  <Check size={48} color={colors.success} />
                  <Text className="text-foreground font-medium mt-4">
                    Working tree clean
                  </Text>
                  <Text className="text-muted-foreground text-center mt-2">
                    No uncommitted changes
                  </Text>
                </CardContent>
              </Card>
            )}

          {/* Commit Section */}
          {(stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0) && (
            <View className="mt-4">
              <View className="flex-row items-center justify-between mb-2">
                <SectionHeader className="mb-0">Commit</SectionHeader>
                <Pressable
                  className="flex-row items-center gap-1 px-2 py-1 rounded-md bg-muted"
                  onPress={handleGenerateMessage}
                  disabled={isGenerating}
                >
                  <Sparkles size={12} color={isGenerating ? colors.mutedForeground : colors.ai} />
                  <Text className="text-xs text-muted-foreground">
                    {isGenerating ? "Generating..." : "AI"}
                  </Text>
                </Pressable>
              </View>
              <Card>
                <CardContent className="p-3 gap-3">
                  <TextInput
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground text-sm"
                    placeholder="Summary (required)"
                    placeholderTextColor={colors.mutedForeground}
                    value={commitSubject}
                    onChangeText={setCommitSubject}
                    editable={!isGenerating}
                  />
                  <TextInput
                    className="min-h-16 w-full rounded-md border border-input bg-background p-3 text-foreground text-sm"
                    placeholder="Description (optional)"
                    placeholderTextColor={colors.mutedForeground}
                    value={commitDescription}
                    onChangeText={setCommitDescription}
                    multiline
                    textAlignVertical="top"
                    editable={!isGenerating}
                  />
                  <Button
                    onPress={handleCommit}
                    loading={loading}
                    disabled={!commitSubject?.trim() || diffs.length === 0}
                  >
                    {loading ? "Committing..." : `Commit to ${currentBranch?.name || "main"}`}
                  </Button>
                </CardContent>
              </Card>
            </View>
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          {history.length === 0 ? (
            <View className="items-center py-8">
              <GitCommit size={32} color={colors.mutedForeground} />
              <Text className="text-muted-foreground mt-4 text-sm">
                No commit history
              </Text>
            </View>
          ) : (
            <Card>
              <CardContent className="p-0">
                {history.map((historyCommit, index) => (
                  <View
                    key={historyCommit.id}
                    className={`flex-row items-start gap-3 px-3 py-3 ${
                      index < history.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <GitCommit size={14} color={colors.ai} className="mt-0.5" />
                    <View className="flex-1">
                      <Text className="text-foreground text-sm font-medium">
                        {truncate(historyCommit.message.split("\n")[0], 50)}
                      </Text>
                      <View className="flex-row items-center mt-1 flex-wrap gap-1">
                        <Text className="text-muted-foreground text-xs font-mono">
                          {historyCommit.shortId}
                        </Text>
                        <Text className="text-muted-foreground text-xs">•</Text>
                        <Text className="text-muted-foreground text-xs">
                          {historyCommit.author}
                        </Text>
                        <Text className="text-muted-foreground text-xs">•</Text>
                        <Text className="text-muted-foreground text-xs">
                          {formatTimestamp(historyCommit.timestamp)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Error Display */}
      {error && (
        <Card className="mt-4 border-destructive">
          <CardContent className="flex-row items-center">
            <X size={16} color={colors.destructive} />
            <Text className="text-destructive ml-2">{error}</Text>
          </CardContent>
        </Card>
      )}
    </ScrollView>
  );
}
