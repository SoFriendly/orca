import { useState } from "react";
import { View, Text, ScrollView, Alert, Pressable, Modal } from "react-native";
import { useRouter } from "expo-router";
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
  ChevronRight,
  Camera,
} from "lucide-react-native";
import { useConnectionStore, LinkedPortal } from "~/stores/connectionStore";
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

export default function ConnectPage() {
  const router = useRouter();
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
      router.back();
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
      router.back();
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

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16 }}
    >
      {/* Connection Status */}
      <Card className="mb-4">
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <CardTitle>Connection</CardTitle>
            <Badge
              variant={
                isConnected
                  ? "success"
                  : status === "connecting" || status === "pairing"
                  ? "warning"
                  : "destructive"
              }
            >
              {status}
            </Badge>
          </View>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <View className="gap-2">
              <View className="flex-row items-center">
                <Check size={16} color={colors.success} />
                <Text className="text-foreground ml-2">
                  Connected to {desktopDeviceName || "Desktop"}
                </Text>
              </View>
            </View>
          ) : (
            <Text className="text-muted-foreground">Not connected</Text>
          )}
          {error && (
            <View className="flex-row items-center mt-2">
              <X size={16} color={colors.destructive} />
              <Text className="text-destructive ml-2">{error}</Text>
            </View>
          )}
        </CardContent>
        {isConnected && (
          <CardFooter>
            <Button variant="destructive" onPress={handleDisconnect}>
              Disconnect
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Scan QR Code */}
      <Card className="mb-4">
        <CardHeader>
          <View className="flex-row items-center">
            <QrCode size={18} color={colors.ai} />
            <CardTitle className="ml-2">Add Desktop</CardTitle>
          </View>
          <CardDescription>
            Scan the QR code shown in Orca Desktop settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onPress={handleScanQR}
            icon={<Camera size={18} color={colors.primaryForeground} />}
          >
            Scan QR Code
          </Button>
        </CardContent>
      </Card>

      {/* Linked Desktops */}
      <Card>
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Monitor size={18} color={colors.info} />
              <CardTitle className="ml-2">
                Linked Desktops ({linkedPortals.length})
              </CardTitle>
            </View>
          </View>
          <CardDescription>
            Switch between connected desktop machines
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkedPortals.length === 0 ? (
            <View className="py-8 items-center">
              <Monitor size={32} color={colors.muted} />
              <Text className="text-muted-foreground mt-4">
                No desktops linked yet
              </Text>
              <Text className="text-muted-foreground text-sm mt-1 text-center">
                Scan a QR code from Orca Desktop to get started
              </Text>
            </View>
          ) : (
            <View className="gap-2">
              {linkedPortals.map((portal) => (
                <Pressable
                  key={portal.id}
                  className={`flex-row items-center justify-between p-4 rounded-lg border ${
                    portal.id === activePortalId
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                  onPress={() => handleSelectPortal(portal)}
                >
                  <View className="flex-row items-center flex-1">
                    <View
                      className={`w-10 h-10 rounded-lg items-center justify-center ${
                        portal.isOnline ? "bg-success/10" : "bg-muted"
                      }`}
                    >
                      <Monitor
                        size={20}
                        color={portal.isOnline ? colors.success : colors.mutedForeground}
                      />
                    </View>
                    <View className="ml-3 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-foreground font-medium">
                          {portal.name}
                        </Text>
                        {portal.id === activePortalId && isConnected && (
                          <Badge variant="success">Active</Badge>
                        )}
                      </View>
                      <Text className="text-muted-foreground text-xs">
                        {portal.isOnline ? "Online" : "Offline"} • Last seen{" "}
                        {formatDate(portal.lastSeen)}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Pressable
                      className="p-2"
                      onPress={() => handleRemovePortal(portal)}
                    >
                      <Trash2 size={18} color={colors.destructive} />
                    </Pressable>
                    {(portal.id !== activePortalId || !isConnected) && (
                      <ChevronRight size={18} color={colors.mutedForeground} />
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>How to Connect</CardTitle>
        </CardHeader>
        <CardContent>
          <View className="gap-3">
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">1.</Text>
              <Text className="text-foreground flex-1">
                Open Orca on your desktop computer
              </Text>
            </View>
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">2.</Text>
              <Text className="text-foreground flex-1">
                Go to Settings → Remote Portal
              </Text>
            </View>
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">3.</Text>
              <Text className="text-foreground flex-1">
                Enable Remote Portal and note the QR code
              </Text>
            </View>
            <View className="flex-row">
              <Text className="text-primary font-bold mr-2">4.</Text>
              <Text className="text-foreground flex-1">
                Tap "Scan QR Code" above and scan it
              </Text>
            </View>
          </View>
        </CardContent>
      </Card>

      {/* QR Scanner Modal */}
      <Modal
        visible={showScanner}
        animationType="slide"
        onRequestClose={() => setShowScanner(false)}
      >
        <View className="flex-1 bg-black">
          <CameraView
            style={{ flex: 1 }}
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
              Point your camera at the QR code in Orca Desktop settings
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
    </ScrollView>
  );
}
