import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Wifi,
  WifiOff,
  X,
  FolderGit2,
  Download,
  ChevronRight,
  Monitor,
  Settings,
  ArrowRight,
  Plus,
} from "lucide-react-native";
import { Stack } from "expo-router";
import {
  useConnectionStore,
  DesktopProject,
} from "~/stores/connectionStore";
import { useTheme } from "~/components/ThemeProvider";
import { Button } from "~/components/ui";
import ChellLogo from "~/components/ChellLogo";

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const {
    status,
    desktopDeviceName,
    availableProjects,
    selectProject,
    requestStatus,
    invoke,
  } = useConnectionStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [clonePath, setClonePath] = useState("");
  const [isCloning, setIsCloning] = useState(false);

  const isConnected = status === "connected";

  // Sort projects by last opened
  const sortedProjects = [...availableProjects].sort(
    (a, b) => new Date(b.lastOpened || 0).getTime() - new Date(a.lastOpened || 0).getTime()
  );

  // Request status on mount and when connected
  useEffect(() => {
    if (isConnected) {
      requestStatus();
    }
  }, [isConnected]);

  const onRefresh = useCallback(async () => {
    if (!isConnected) return;
    setRefreshing(true);
    requestStatus();
    setTimeout(() => setRefreshing(false), 500);
  }, [isConnected, requestStatus]);

  const handleSelectProject = (project: DesktopProject) => {
    selectProject(project.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/(tabs)");
  };

  const handleCloneRepo = async () => {
    if (!cloneUrl.trim()) {
      Alert.alert("Error", "Please enter a repository URL");
      return;
    }

    if (!clonePath.trim()) {
      Alert.alert("Error", "Please enter a destination path");
      return;
    }

    setIsCloning(true);

    try {
      const result = await invoke<string>("clone_repo", {
        url: cloneUrl.trim(),
        path: clonePath.trim(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCloneUrl("");
      setClonePath("");
      setShowCloneModal(false);
      requestStatus();

      Alert.alert("Success", `Repository cloned to ${result}`, [
        { text: "OK", onPress: () => router.push("/(tabs)") },
      ]);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Clone Failed",
        err instanceof Error ? err.message : "Failed to clone repository"
      );
    } finally {
      setIsCloning(false);
    }
  };

  const getRelativeTime = (date: string | undefined) => {
    if (!date) return "";
    const now = new Date();
    const then = new Date(date);
    const diff = now.getTime() - then.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: "Chell",
          headerLeft: () => (
            <Pressable
              style={{ padding: 8 }}
              onPress={() => {
                if (isConnected) {
                  Alert.alert(
                    "Disconnect",
                    `Disconnect from ${desktopDeviceName || "desktop"}?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Disconnect",
                        style: "destructive",
                        onPress: () => {
                          useConnectionStore.getState().disconnect();
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        },
                      },
                    ]
                  );
                } else {
                  router.push("/connect");
                }
              }}
            >
              {isConnected ? (
                <Wifi size={22} color="#22c55e" />
              ) : (
                <WifiOff size={22} color={colors.destructive} />
              )}
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
        }}
      />
      <View className="flex-1 bg-background">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          {/* Hero Section */}
          <View className="items-center py-8">
            <View
              className="w-16 h-16 rounded-2xl items-center justify-center mb-4"
              style={{
                backgroundColor: `${colors.primary}20`,
                borderWidth: 1,
                borderColor: `${colors.primary}40`,
              }}
            >
              <ChellLogo size={36} />
            </View>
            <Text className="text-xl font-semibold text-foreground">
              Welcome to Chell
            </Text>
            <Text className="text-sm text-muted-foreground mt-2">
              Think in changes, not commands.
            </Text>
          </View>

          {/* Not Connected State */}
          {!isConnected && (
            <View className="items-center py-8">
              <Text className="text-muted-foreground text-center mb-4">
                Connect to your desktop to access your projects.
              </Text>
              <Button onPress={() => router.push("/connect")}>
                Connect Desktop
              </Button>
            </View>
          )}

          {/* Quick Actions - only show when connected */}
          {isConnected && (
            <View className="gap-3 mb-8">
              <Pressable
                className="flex-row items-center p-4 rounded-xl border border-border bg-card"
                style={{ gap: 16 }}
                onPress={() => setShowCloneModal(true)}
              >
                <View
                  className="w-10 h-10 rounded-lg items-center justify-center"
                  style={{ backgroundColor: colors.muted }}
                >
                  <Download size={20} color={colors.mutedForeground} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground">
                    Clone repository
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Clone from GitHub, GitLab, or any URL
                  </Text>
                </View>
                <ArrowRight size={16} color={colors.mutedForeground} />
              </Pressable>

              <Pressable
                className="flex-row items-center p-4 rounded-xl border border-border bg-card"
                style={{ gap: 16 }}
                onPress={() => {
                  Alert.alert(
                    "Open Repository",
                    "Use Chell on your desktop to open a local repository, then it will appear here."
                  );
                }}
              >
                <View
                  className="w-10 h-10 rounded-lg items-center justify-center"
                  style={{ backgroundColor: colors.muted }}
                >
                  <Monitor size={20} color={colors.mutedForeground} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground">
                    Open existing repository
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Open a repo in Chell Desktop
                  </Text>
                </View>
                <ArrowRight size={16} color={colors.mutedForeground} />
              </Pressable>

              <Pressable
                className="flex-row items-center p-4 rounded-xl border border-border bg-card"
                style={{ gap: 16 }}
                onPress={() => {
                  Alert.alert(
                    "Create Repository",
                    "Use Chell on your desktop to create a new repository."
                  );
                }}
              >
                <View
                  className="w-10 h-10 rounded-lg items-center justify-center"
                  style={{ backgroundColor: colors.muted }}
                >
                  <Plus size={20} color={colors.mutedForeground} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground">
                    Create new repository
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Initialize a new git repository
                  </Text>
                </View>
                <ArrowRight size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          )}

          {/* Recent Projects */}
          {isConnected && sortedProjects.length > 0 && (
            <View>
              <Text className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-1 mb-3">
                Recent Projects
              </Text>
              <View className="gap-1">
                {sortedProjects.map((project) => (
                  <Pressable
                    key={project.id}
                    className="flex-row items-center px-3 py-3 rounded-lg"
                    style={{ gap: 12 }}
                    onPress={() => handleSelectProject(project)}
                    android_ripple={{ color: colors.muted }}
                  >
                    <FolderGit2 size={16} color={colors.primary} />
                    <View className="flex-1 min-w-0">
                      <Text
                        className="text-sm font-medium text-foreground"
                        numberOfLines={1}
                      >
                        {project.name}
                      </Text>
                      <Text
                        className="text-[11px] text-muted-foreground font-mono"
                        numberOfLines={1}
                      >
                        {project.path}
                      </Text>
                    </View>
                    <Text className="text-[11px] text-muted-foreground">
                      {getRelativeTime(project.lastOpened)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Empty state for projects */}
          {isConnected && sortedProjects.length === 0 && (
            <View className="items-center py-4">
              <Text className="text-muted-foreground text-sm text-center">
                No projects yet. Clone a repository or open one in Chell Desktop.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Clone Repository Modal */}
        <Modal
          visible={showCloneModal}
          animationType="slide"
          transparent
          onRequestClose={() => setShowCloneModal(false)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View
              className="bg-card rounded-t-3xl p-6"
              style={{ paddingBottom: 40 }}
            >
              <View className="flex-row items-center justify-between mb-6">
                <View className="flex-row items-center">
                  <Download size={20} color={colors.primary} />
                  <Text className="text-foreground text-lg font-semibold ml-2">
                    Clone Repository
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowCloneModal(false)}
                  className="p-2"
                >
                  <X size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>

              <View className="gap-4">
                <View>
                  <Text className="text-foreground font-medium mb-2">
                    Repository URL
                  </Text>
                  <TextInput
                    className="h-12 rounded-lg border border-input bg-background px-4 text-foreground"
                    placeholder="https://github.com/user/repo.git"
                    placeholderTextColor={colors.mutedForeground}
                    value={cloneUrl}
                    onChangeText={setCloneUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>

                <View>
                  <Text className="text-foreground font-medium mb-2">
                    Destination Path
                  </Text>
                  <TextInput
                    className="h-12 rounded-lg border border-input bg-background px-4 text-foreground"
                    placeholder="~/Projects/repo-name"
                    placeholderTextColor={colors.mutedForeground}
                    value={clonePath}
                    onChangeText={setClonePath}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text className="text-muted-foreground text-xs mt-1">
                    Path on your desktop where the repo will be cloned
                  </Text>
                </View>

                <View className="flex-row gap-3 mt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onPress={() => setShowCloneModal(false)}
                    disabled={isCloning}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onPress={handleCloneRepo}
                    loading={isCloning}
                    disabled={!cloneUrl.trim() || !clonePath.trim()}
                  >
                    {isCloning ? "Cloning..." : "Clone"}
                  </Button>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </>
  );
}
