import { useState, useEffect, useMemo } from "react";
import {
  Smartphone,
  Wifi,
  WifiOff,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePortalStore } from "@/stores/portalStore";
import { cn } from "@/lib/utils";
import type { LinkedDevice } from "@/types";

// Simple QR Code generator using a canvas
function QRCodeDisplay({ data, size = 200 }: { data: string; size?: number }) {
  // We'll use a simple external QR code API for now
  // In production, you'd use a library like qrcode or qrcode.react
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=1a1a1a&color=ffffff`;

  return (
    <div className="flex items-center justify-center p-4 bg-white rounded-lg">
      <img
        src={qrUrl}
        alt="Pairing QR Code"
        width={size}
        height={size}
        className="rounded"
      />
    </div>
  );
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

export function RemotePortalSettings() {
  const {
    isEnabled,
    isConnected,
    relayUrl,
    error,
    deviceName,
    pairingCode,
    pairingPassphrase,
    linkedDevices,
    enable,
    disable,
    setRelayUrl,
    regeneratePairingCode,
    removeDevice,
    setDeviceName,
  } = usePortalStore();

  const [localRelayUrl, setLocalRelayUrl] = useState(relayUrl);
  const [localDeviceName, setLocalDeviceName] = useState(deviceName);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLocalRelayUrl(relayUrl);
  }, [relayUrl]);

  useEffect(() => {
    setLocalDeviceName(deviceName);
  }, [deviceName]);

  // Generate QR code data
  const qrData = useMemo(() => {
    return JSON.stringify({
      type: "orca-portal",
      version: 1,
      relay: relayUrl,
      passphrase: pairingPassphrase,
      desktopName: deviceName,
    });
  }, [relayUrl, pairingPassphrase, deviceName]);

  const handleCopyPassphrase = () => {
    navigator.clipboard.writeText(pairingPassphrase);
    setCopied(true);
    toast.success("Passphrase copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveRelayUrl = () => {
    setRelayUrl(localRelayUrl);
    toast.success("Relay URL updated");
  };

  const handleSaveDeviceName = () => {
    setDeviceName(localDeviceName);
    toast.success("Device name updated");
  };

  const handleTogglePortal = (enabled: boolean) => {
    if (enabled) {
      enable();
      toast.success("Remote Portal enabled");
    } else {
      disable();
      toast.success("Remote Portal disabled");
    }
  };

  const handleRemoveDevice = (device: LinkedDevice) => {
    removeDevice(device.id);
    toast.success(`Removed ${device.name}`);
  };

  return (
    <div className="space-y-8">
      {/* Enable/Disable Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Remote Portal
            </h2>
            <p className="text-sm text-muted-foreground">
              Control Orca from your mobile device
            </p>
          </div>
          <Switch checked={isEnabled} onCheckedChange={handleTogglePortal} />
        </div>

        {/* Connection Status */}
        {isEnabled && (
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
              isConnected
                ? "bg-green-500/10 text-green-500"
                : "bg-yellow-500/10 text-yellow-500"
            )}
          >
            {isConnected ? (
              <>
                <Wifi className="h-4 w-4" />
                Connected to relay server
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4" />
                Connecting to relay server...
              </>
            )}
          </div>
        )}

        {error && (
          <div className="mt-2 text-sm text-destructive">{error}</div>
        )}
      </section>

      {isEnabled && (
        <>
          {/* QR Code Section */}
          <section>
            <h3 className="text-sm font-medium mb-3">Pair a Mobile Device</h3>
            <div className="flex gap-6">
              <div className="flex-shrink-0">
                <QRCodeDisplay data={qrData} size={160} />
              </div>
              <div className="flex-1 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Scan this QR code with the Orca Portal app on your phone to
                  connect.
                </p>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Or enter this code manually:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 rounded-md bg-muted font-mono text-lg tracking-widest">
                      {pairingCode}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyPassphrase}
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={regeneratePairingCode}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Passphrase:{" "}
                  <code className="text-foreground">{pairingPassphrase}</code>
                </p>
              </div>
            </div>
          </section>

          {/* Linked Devices Section */}
          <section>
            <h3 className="text-sm font-medium mb-3">
              Linked Devices ({linkedDevices.length})
            </h3>

            {linkedDevices.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-border rounded-lg">
                <Smartphone className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No devices linked yet
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Scan the QR code above with your phone
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {linkedDevices.map((device) => (
                  <div
                    key={device.id}
                    className="flex items-center justify-between px-4 py-3 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Smartphone className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{device.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Last seen {formatTimestamp(device.lastSeen)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveDevice(device)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Advanced Settings */}
          <section>
            <button
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <Settings2 className="h-4 w-4" />
              Advanced Settings
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-6 border-l-2 border-border">
                {/* Device Name */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Device Name</p>
                    <p className="text-xs text-muted-foreground">
                      How this desktop appears on mobile devices
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={localDeviceName}
                      onChange={(e) => setLocalDeviceName(e.target.value)}
                      className="w-40 h-8 text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveDeviceName}
                      disabled={localDeviceName === deviceName}
                    >
                      Save
                    </Button>
                  </div>
                </div>

                {/* Relay URL */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Relay Server</p>
                    <p className="text-xs text-muted-foreground">
                      WebSocket server for mobile connections
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={localRelayUrl}
                      onChange={(e) => setLocalRelayUrl(e.target.value)}
                      className="w-56 h-8 text-sm font-mono"
                      placeholder="wss://..."
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveRelayUrl}
                      disabled={localRelayUrl === relayUrl}
                    >
                      Save
                    </Button>
                  </div>
                </div>

                {/* Get Mobile App */}
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <div>
                    <p className="text-sm font-medium">Get Mobile App</p>
                    <p className="text-xs text-muted-foreground">
                      Download Orca Portal for iOS or Android
                    </p>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://chell.dev/mobile"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Download
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
