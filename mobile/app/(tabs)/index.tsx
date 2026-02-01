import { useEffect, useState, useCallback } from "react";
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
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  FileText,
  RotateCcw,
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
  const [commitMessage, setCommitMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

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
    if (diffs.length === 0) {
      Alert.alert("No Changes", "Stage some changes first to generate a message");
      return;
    }

    setIsGenerating(true);
    try {
      const message = await generateCommitMessage(diffs);
      setCommitMessage(message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        "Error",
        err instanceof Error ? err.message : "Failed to generate message"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) {
      Alert.alert("Error", "Please enter a commit message");
      return;
    }

    try {
      await commit(projectPath, commitMessage);
      setCommitMessage("");
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
          <Button
            variant="ghost"
            className="flex-row items-center flex-1 mr-2"
            onPress={() => setShowBranchPicker(!showBranchPicker)}
          >
            <GitBranch size={18} color="#a78bfa" />
            <Text
              className="text-foreground font-medium ml-2 flex-1"
              numberOfLines={1}
            >
              {gitStatus?.branch || "main"}
            </Text>
            <ChevronDown size={16} color={colors.mutedForeground} />
          </Button>

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
                    <GitBranch size={14} color={branch.isHead ? "#a78bfa" : colors.mutedForeground} />
                    <Text
                      className={`ml-2 ${
                        branch.isHead ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {branch.name}
                    </Text>
                    {branch.isHead && <Check size={14} color="#22c55e" />}
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
            <Card className="mb-4">
              <CardHeader>
                <View className="flex-row items-center">
                  <Check size={16} color="#22c55e" />
                  <CardTitle className="ml-2">
                    Staged ({stagedFiles.length})
                  </CardTitle>
                </View>
              </CardHeader>
              <CardContent>
                {stagedFiles.map((file) => {
                  const diff = getDiffForFile(file);
                  const isExpanded = expandedFiles.has(file);

                  return (
                    <View key={file} className="border-b border-border">
                      <Pressable
                        className="flex-row items-center justify-between py-3"
                        onPress={() => toggleFileExpanded(file)}
                      >
                        <View className="flex-row items-center flex-1">
                          <ChevronRight
                            size={14}
                            color={colors.mutedForeground}
                            style={{
                              transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
                            }}
                          />
                          <FileText size={14} color="#22c55e" className="ml-2" />
                          <Text
                            className="text-foreground ml-2 flex-1"
                            numberOfLines={1}
                          >
                            {file}
                          </Text>
                        </View>
                        <Button
                          variant="ghost"
                          size="icon"
                          onPress={() => handleUnstageFile(file)}
                        >
                          <Minus size={14} color="#ef4444" />
                        </Button>
                      </Pressable>

                      {/* Diff view */}
                      {isExpanded && diff && (
                        <View className="bg-secondary/50 p-2 mb-2 rounded-md">
                          <ScrollView horizontal>
                            <Text className="text-foreground font-mono text-xs">
                              {diff.diff || "No diff available"}
                            </Text>
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Unstaged Files */}
          {unstagedFiles.length > 0 && (
            <Card className="mb-4">
              <CardHeader>
                <View className="flex-row items-center">
                  <FileText size={16} color="#eab308" />
                  <CardTitle className="ml-2">
                    Modified ({unstagedFiles.length})
                  </CardTitle>
                </View>
              </CardHeader>
              <CardContent>
                {unstagedFiles.map((file) => {
                  const diff = getDiffForFile(file);
                  const isExpanded = expandedFiles.has(file);

                  return (
                    <View key={file} className="border-b border-border">
                      <Pressable
                        className="flex-row items-center justify-between py-3"
                        onPress={() => toggleFileExpanded(file)}
                      >
                        <View className="flex-row items-center flex-1">
                          <ChevronRight
                            size={14}
                            color={colors.mutedForeground}
                            style={{
                              transform: [{ rotate: isExpanded ? "90deg" : "0deg" }],
                            }}
                          />
                          <FileText size={14} color="#eab308" className="ml-2" />
                          <Text
                            className="text-foreground ml-2 flex-1"
                            numberOfLines={1}
                          >
                            {file}
                          </Text>
                        </View>
                        <View className="flex-row">
                          <Button
                            variant="ghost"
                            size="icon"
                            onPress={() => handleStageFile(file)}
                          >
                            <Plus size={14} color="#22c55e" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onPress={() => handleDiscardFile(file)}
                          >
                            <RotateCcw size={14} color="#ef4444" />
                          </Button>
                        </View>
                      </Pressable>

                      {/* Diff view */}
                      {isExpanded && diff && (
                        <View className="bg-secondary/50 p-2 mb-2 rounded-md">
                          <ScrollView horizontal>
                            <Text className="text-foreground font-mono text-xs">
                              {diff.diff || "No diff available"}
                            </Text>
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Untracked Files */}
          {untrackedFiles.length > 0 && (
            <Card className="mb-4">
              <CardHeader>
                <View className="flex-row items-center">
                  <Plus size={16} color="#60a5fa" />
                  <CardTitle className="ml-2">
                    Untracked ({untrackedFiles.length})
                  </CardTitle>
                </View>
              </CardHeader>
              <CardContent>
                {untrackedFiles.map((file) => (
                  <View
                    key={file}
                    className="flex-row items-center justify-between py-3 border-b border-border"
                  >
                    <View className="flex-row items-center flex-1">
                      <FileText size={14} color="#60a5fa" />
                      <Text
                        className="text-foreground ml-2 flex-1"
                        numberOfLines={1}
                      >
                        {file}
                      </Text>
                    </View>
                    <Button
                      variant="ghost"
                      size="icon"
                      onPress={() => handleStageFile(file)}
                    >
                      <Plus size={14} color="#22c55e" />
                    </Button>
                  </View>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {stagedFiles.length === 0 &&
            unstagedFiles.length === 0 &&
            untrackedFiles.length === 0 && (
              <Card>
                <CardContent className="items-center py-8">
                  <Check size={48} color="#22c55e" />
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
          {(stagedFiles.length > 0 || unstagedFiles.length > 0) && (
            <Card className="mt-4">
              <CardHeader>
                <View className="flex-row items-center justify-between">
                  <CardTitle>Commit</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={handleGenerateMessage}
                    loading={isGenerating}
                    icon={<Sparkles size={14} color="#a78bfa" />}
                  >
                    <Text className="text-foreground">AI Message</Text>
                  </Button>
                </View>
              </CardHeader>
              <CardContent>
                <TextInput
                  className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-foreground"
                  placeholder="Commit message..."
                  placeholderTextColor={colors.mutedForeground}
                  value={commitMessage}
                  onChangeText={setCommitMessage}
                  multiline
                  textAlignVertical="top"
                />
              </CardContent>
              <CardFooter>
                <Button
                  onPress={handleCommit}
                  loading={loading}
                  disabled={!commitMessage.trim() || stagedFiles.length === 0}
                  icon={<GitCommit size={16} color="#000" />}
                >
                  Commit Changes
                </Button>
              </CardFooter>
            </Card>
          )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              {history.length === 0 ? (
                <View className="items-center py-8">
                  <GitCommit size={32} color={colors.mutedForeground} />
                  <Text className="text-muted-foreground mt-4">
                    No commit history
                  </Text>
                </View>
              ) : (
                history.map((historyCommit, index) => (
                  <View
                    key={historyCommit.id}
                    className={`p-4 ${
                      index < history.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <View className="flex-row items-start">
                      <GitCommit size={16} color="#a78bfa" className="mt-1" />
                      <View className="ml-3 flex-1">
                        <Text className="text-foreground font-medium">
                          {truncate(historyCommit.message.split("\n")[0], 50)}
                        </Text>
                        <View className="flex-row items-center mt-1 flex-wrap">
                          <Text className="text-muted-foreground text-xs">
                            {historyCommit.shortId}
                          </Text>
                          <Text className="text-muted-foreground text-xs mx-2">
                            •
                          </Text>
                          <Text className="text-muted-foreground text-xs">
                            {historyCommit.author}
                          </Text>
                          <Text className="text-muted-foreground text-xs mx-2">
                            •
                          </Text>
                          <Text className="text-muted-foreground text-xs">
                            {formatTimestamp(historyCommit.timestamp)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Error Display */}
      {error && (
        <Card className="mt-4 border-destructive">
          <CardContent className="flex-row items-center">
            <X size={16} color="#ef4444" />
            <Text className="text-destructive ml-2">{error}</Text>
          </CardContent>
        </Card>
      )}
    </ScrollView>
  );
}
