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
  Check,
  X,
  Folder,
  FolderOpen,
  GitBranch,
  Download,
  ChevronRight,
  Monitor,
  Settings,
} from "lucide-react-native";
import { Stack } from "expo-router";
import {
  useConnectionStore,
  DesktopProject,
} from "~/stores/connectionStore";
import { useTheme } from "~/components/ThemeProvider";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "~/components/ui";

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const {
    status,
    desktopDeviceName,
    activeProject,
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
    // Navigate to tabs (project view)
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

      // Clear form and close modal
      setCloneUrl("");
      setClonePath("");
      setShowCloneModal(false);

      // Refresh project list then navigate
      requestStatus();

      Alert.alert("Success", `Repository cloned to ${result}`, [
        { text: "OK", onPress: () => router.push("/(tabs)") }
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

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/settings")}
              className="p-2 mr-2"
            >
              <Settings size={22} color={colors.foreground} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
    >
      {/* Connection Status Banner */}
      <Pressable
        className={`flex-row items-center justify-between p-4 rounded-xl mb-4 ${
          isConnected ? "bg-primary/10" : "bg-destructive/10"
        }`}
        onPress={() => !isConnected && router.push("/connect")}
      >
        <View className="flex-row items-center">
          {isConnected ? (
            <Wifi size={20} color={colors.primary} />
          ) : (
            <WifiOff size={20} color={colors.destructive} />
          )}
          <View className="ml-3">
            <Text
              className={`font-medium ${
                isConnected ? "text-primary" : "text-destructive"
              }`}
            >
              {isConnected ? "Connected" : "Not Connected"}
            </Text>
            {isConnected && desktopDeviceName && (
              <View className="flex-row items-center mt-0.5">
                <Monitor size={12} color={colors.mutedForeground} />
                <Text className="text-muted-foreground text-xs ml-1">
                  {desktopDeviceName}
                </Text>
              </View>
            )}
          </View>
        </View>
        {!isConnected && (
          <View className="flex-row items-center">
            <Text className="text-destructive text-sm mr-1">Connect</Text>
            <ChevronRight size={16} color={colors.destructive} />
          </View>
        )}
      </Pressable>

      {/* Not Connected State */}
      {!isConnected && (
        <Card className="mb-4">
          <CardContent className="py-8 items-center">
            <View className="w-16 h-16 rounded-full bg-muted items-center justify-center mb-4">
              <GitBranch size={32} color={colors.mutedForeground} />
            </View>
            <Text className="text-foreground text-lg font-semibold mb-2">
              Welcome to Chell
            </Text>
            <Text className="text-muted-foreground text-center mb-4">
              Connect to your desktop to access your projects and git
              repositories.
            </Text>
            <Button onPress={() => router.push("/connect")}>
              Connect Desktop
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Clone Repository - only show when connected */}
      {isConnected && (
        <Card className="mb-4">
          <CardHeader>
            <View className="flex-row items-center">
              <Download size={18} color="#60a5fa" />
              <CardTitle className="ml-2">Quick Actions</CardTitle>
            </View>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onPress={() => setShowCloneModal(true)}
              icon={<GitBranch size={18} color={colors.foreground} />}
            >
              Clone Repository
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Projects List - only show when connected */}
      {isConnected && (
        <Card className="mb-4">
          <CardHeader>
            <View className="flex-row items-center">
              <FolderOpen size={18} color="#22c55e" />
              <CardTitle className="ml-2">
                Projects{" "}
                {availableProjects.length > 0 &&
                  `(${availableProjects.length})`}
              </CardTitle>
            </View>
            <CardDescription>
              {availableProjects.length > 0
                ? "Select a project to work with"
                : "No projects found on desktop"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {availableProjects.length === 0 ? (
              <View className="py-4 items-center">
                <Text className="text-muted-foreground text-sm">
                  Clone a repository or open one in Chell Desktop
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                {availableProjects.map((project) => {
                  const isActive = project.id === activeProject?.id;

                  return (
                    <Pressable
                      key={project.id}
                      className={`flex-row items-center justify-between p-3 rounded-lg border ${
                        isActive
                          ? "border-primary bg-primary/5"
                          : "border-border"
                      }`}
                      onPress={() => handleSelectProject(project)}
                    >
                      <View className="flex-row items-center flex-1">
                        <View
                          className={`w-10 h-10 rounded-lg items-center justify-center ${
                            isActive ? "bg-primary/10" : "bg-muted"
                          }`}
                        >
                          <Folder
                            size={20}
                            color={
                              isActive ? colors.primary : colors.mutedForeground
                            }
                          />
                        </View>
                        <View className="ml-3 flex-1">
                          <Text
                            className={`font-medium ${
                              isActive
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {project.name}
                          </Text>
                          <Text
                            className="text-muted-foreground text-xs"
                            numberOfLines={1}
                          >
                            {project.path}
                          </Text>
                        </View>
                      </View>
                      {isActive && <Check size={18} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </CardContent>
        </Card>
      )}

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
                <GitBranch size={20} color="#60a5fa" />
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
                  icon={
                    isCloning ? undefined : <Download size={16} color="#000" />
                  }
                >
                  {isCloning ? "Cloning..." : "Clone"}
                </Button>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </>
  );
}
