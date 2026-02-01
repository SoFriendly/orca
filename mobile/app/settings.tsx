import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Alert,
  Pressable,
  Modal,
  Switch,
} from "react-native";
import { Stack } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import {
  Wifi,
  WifiOff,
  QrCode,
  Check,
  X,
  Trash2,
  Monitor,
  Moon,
  Sun,
  Sparkles,
} from "lucide-react-native";
import { useConnectionStore, LinkedPortal } from "~/stores/connectionStore";
import { useThemeStore, ThemeOption } from "~/stores/themeStore";
import { useTheme } from "~/components/ThemeProvider";
import { Button, Separator } from "~/components/ui";

export default function SettingsPage() {
  const { colors } = useTheme();
  const {
    status,
    error,
    linkedPortals,
    activePortalId,
    desktopDeviceName,
    pairFromQR,
    selectPortal,
    removePortal,
    disconnect,
  } = useConnectionStore();

  const { theme, setTheme, syncWithDesktop, setSyncWithDesktop } = useThemeStore();

  const [permission, requestPermission] = useCameraPermissions();
  const [showScanner, setShowScanner] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const isConnected = status === "connected";

  const handleScanQR = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert(
          "Permission Required",
          "Camera access is needed to scan QR codes"
        );
        return;
      }
    }
    setShowScanner(true);
    setIsScanning(false);
  };

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (isScanning) return;
    setIsScanning(true);

    try {
      await pairFromQR(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowScanner(false);
      Alert.alert("Success", "Connected to desktop!");
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Connection Failed",
        err instanceof Error ? err.message : "Failed to connect"
      );
      setIsScanning(false);
    }
  };

  const handleSelectPortal = async (portal: LinkedPortal) => {
    if (portal.id === activePortalId && isConnected) return;

    try {
      await selectPortal(portal.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(
        "Connection Failed",
        err instanceof Error ? err.message : "Failed to connect"
      );
    }
  };

  const handleRemovePortal = (portal: LinkedPortal) => {
    Alert.alert(
      "Remove Desktop",
      `Are you sure you want to remove "${portal.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            removePortal(portal.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "Are you sure you want to disconnect?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () => {
          disconnect();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  };

  const handleThemeChange = (newTheme: ThemeOption) => {
    setTheme(newTheme);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  const themes: { id: ThemeOption; name: string; icon: typeof Sun }[] = [
    { id: "dark", name: "Chell Dark", icon: Moon },
    { id: "tokyo", name: "Tokyo Night", icon: Sparkles },
    { id: "light", name: "Light", icon: Sun },
  ];

  return (
    <>
      <Stack.Screen
        options={{
          title: "Settings",
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 24 }}
      >
        {/* Connection Section */}
        <View className="mb-8">
          <Text className="text-lg font-semibold text-foreground mb-1">
            Connection
          </Text>
          <Text className="text-sm text-muted-foreground mb-6">
            Manage your desktop connection.
          </Text>

          {/* Connection Status */}
          <View
            className={`flex-row items-center justify-between p-4 rounded-xl mb-4 ${
              isConnected ? "bg-primary/10" : "bg-muted"
            }`}
          >
            <View className="flex-row items-center">
              {isConnected ? (
                <Wifi size={20} color={colors.primary} />
              ) : (
                <WifiOff size={20} color={colors.mutedForeground} />
              )}
              <View className="ml-3">
                <Text
                  className={`font-medium ${
                    isConnected ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {isConnected ? "Connected" : "Not Connected"}
                </Text>
                {isConnected && desktopDeviceName && (
                  <Text className="text-muted-foreground text-xs">
                    {desktopDeviceName}
                  </Text>
                )}
              </View>
            </View>
            {isConnected && (
              <Pressable
                onPress={handleDisconnect}
                className="px-3 py-1.5 rounded-lg bg-destructive/10"
              >
                <Text className="text-destructive text-sm font-medium">
                  Disconnect
                </Text>
              </Pressable>
            )}
          </View>

          {error && (
            <View className="flex-row items-center p-3 rounded-lg bg-destructive/10 mb-4">
              <X size={16} color={colors.destructive} />
              <Text className="text-destructive ml-2 text-sm">{error}</Text>
            </View>
          )}

          {/* Add Desktop Button */}
          <Button
            onPress={handleScanQR}
            variant="outline"
            icon={<QrCode size={18} color={colors.foreground} />}
          >
            Scan QR to Add Desktop
          </Button>
        </View>

        <Separator className="mb-8" />

        {/* Linked Desktops */}
        {linkedPortals.length > 0 && (
          <View className="mb-8">
            <Text className="text-lg font-semibold text-foreground mb-1">
              Linked Desktops
            </Text>
            <Text className="text-sm text-muted-foreground mb-6">
              Switch between your paired desktop computers.
            </Text>

            <View className="gap-3">
              {linkedPortals.map((portal) => {
                const isActive = portal.id === activePortalId && isConnected;
                return (
                  <Pressable
                    key={portal.id}
                    className={`flex-row items-center justify-between p-4 rounded-xl border ${
                      isActive ? "border-primary bg-primary/5" : "border-border bg-card"
                    }`}
                    onPress={() => handleSelectPortal(portal)}
                  >
                    <View className="flex-row items-center flex-1">
                      <View
                        className={`w-10 h-10 rounded-lg items-center justify-center ${
                          portal.isOnline ? "bg-green-500/10" : "bg-muted"
                        }`}
                      >
                        <Monitor
                          size={20}
                          color={portal.isOnline ? "#22c55e" : colors.mutedForeground}
                        />
                      </View>
                      <View className="ml-3 flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-foreground font-medium">
                            {portal.name}
                          </Text>
                          {isActive && (
                            <View className="bg-primary/20 px-1.5 py-0.5 rounded">
                              <Text className="text-primary text-[10px] font-medium">
                                ACTIVE
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text className="text-muted-foreground text-xs">
                          {portal.isOnline ? "Online" : "Offline"} • {formatDate(portal.lastSeen)}
                        </Text>
                      </View>
                    </View>
                    <Pressable
                      className="p-2"
                      onPress={() => handleRemovePortal(portal)}
                    >
                      <Trash2 size={18} color={colors.destructive} />
                    </Pressable>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {linkedPortals.length > 0 && <Separator className="mb-8" />}

        {/* Appearance Section */}
        <View className="mb-8">
          <Text className="text-lg font-semibold text-foreground mb-1">
            Appearance
          </Text>
          <Text className="text-sm text-muted-foreground mb-6">
            Customize the look and feel of the app.
          </Text>

          {/* Theme Options */}
          <View className="gap-3 mb-6">
            {themes.map((t) => {
              const Icon = t.icon;
              const isActive = theme === t.id;

              return (
                <Pressable
                  key={t.id}
                  className={`flex-row items-center justify-between p-4 rounded-xl border ${
                    isActive ? "border-primary bg-primary/5" : "border-border bg-card"
                  }`}
                  onPress={() => handleThemeChange(t.id)}
                >
                  <View className="flex-row items-center">
                    <Icon
                      size={20}
                      color={isActive ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      className={`ml-3 font-medium ${
                        isActive ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {t.name}
                    </Text>
                  </View>
                  {isActive && <Check size={20} color={colors.primary} />}
                </Pressable>
              );
            })}
          </View>

          {/* Sync with Desktop */}
          <View className="flex-row items-center justify-between p-4 rounded-xl border border-border bg-card">
            <View className="flex-1 mr-4">
              <Text className="text-foreground font-medium">
                Sync with Desktop
              </Text>
              <Text className="text-muted-foreground text-xs mt-0.5">
                Automatically match desktop theme
              </Text>
            </View>
            <Switch
              value={syncWithDesktop}
              onValueChange={(value) => {
                setSyncWithDesktop(value);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              trackColor={{ false: colors.muted, true: colors.primary }}
              thumbColor={colors.background}
            />
          </View>
        </View>

        <Separator className="mb-8" />

        {/* About Section */}
        <View>
          <Text className="text-lg font-semibold text-foreground mb-1">
            About
          </Text>
          <Text className="text-sm text-muted-foreground mb-6">
            Think in changes, not commands.
          </Text>

          <View className="gap-4">
            <View className="flex-row justify-between py-2">
              <Text className="text-muted-foreground text-sm">App</Text>
              <Text className="text-foreground text-sm">Chell Portal</Text>
            </View>
            <View className="flex-row justify-between py-2">
              <Text className="text-muted-foreground text-sm">Version</Text>
              <Text className="text-foreground text-sm font-mono">1.0.0</Text>
            </View>
            <View className="flex-row justify-between py-2">
              <Text className="text-muted-foreground text-sm">License</Text>
              <Text className="text-foreground text-sm">MIT</Text>
            </View>
          </View>

          <View className="mt-6 p-4 rounded-xl bg-muted/50">
            <Text className="text-xs text-muted-foreground">
              Chell brings git, a terminal, and AI coding into one place.
              Visually track what your agent changes in real-time and commit
              often with confidence.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* QR Scanner Modal */}
      <Modal
        visible={showScanner}
        animationType="slide"
        onRequestClose={() => setShowScanner(false)}
      >
        <View className="flex-1 bg-black">
          <CameraView
            className="flex-1"
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ["qr"],
            }}
            onBarcodeScanned={isScanning ? undefined : handleBarCodeScanned}
          />

          {/* Scanner overlay */}
          <View className="absolute inset-0 items-center justify-center">
            <View className="w-64 h-64 border-2 border-white rounded-2xl" />
            <Text className="text-white text-center mt-8 px-8">
              Point your camera at the QR code in Chell Desktop settings
            </Text>
          </View>

          {/* Close button */}
          <View className="absolute top-16 left-4">
            <Pressable
              className="w-10 h-10 rounded-full bg-black/50 items-center justify-center"
              onPress={() => setShowScanner(false)}
            >
              <X size={24} color="#fff" />
            </Pressable>
          </View>

          {/* Scanning indicator */}
          {isScanning && (
            <View className="absolute inset-0 items-center justify-center bg-black/50">
              <Text className="text-white text-lg">Connecting...</Text>
            </View>
          )}
        </View>
      </Modal>
    </>
  );
}
