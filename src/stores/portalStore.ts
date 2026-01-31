import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LinkedDevice, PortalSession } from "@/types";

// Word list for passphrase generation
const WORD_LIST = [
  "apple", "banana", "cherry", "dragon", "eagle", "falcon", "grape", "honey",
  "island", "jungle", "koala", "lemon", "mango", "nectar", "orange", "pearl",
  "quartz", "river", "sunset", "tiger", "umbrella", "violet", "walnut", "xenon",
  "yellow", "zebra", "anchor", "bridge", "castle", "dolphin", "ember", "frost",
  "garden", "harbor", "igloo", "jasper", "kite", "lotus", "meadow", "north",
  "ocean", "piano", "quest", "rainbow", "silver", "thunder", "unity", "valley",
  "wonder", "crystal", "blaze", "cloud", "dawn", "echo", "flame", "glow",
  "haven", "ivory", "jade", "karma", "lunar", "mystic", "nova", "oasis",
];

function generatePassphrase(): string {
  const words: string[] = [];
  for (let i = 0; i < 6; i++) {
    const index = Math.floor(Math.random() * WORD_LIST.length);
    words.push(WORD_LIST[index]);
  }
  return words.join("-");
}

function generatePairingCode(): string {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

function generateDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface PortalState {
  // Connection state
  isEnabled: boolean;
  isConnected: boolean;
  relayUrl: string;
  error: string | null;

  // Session info
  deviceId: string;
  deviceName: string;
  pairingCode: string;
  pairingPassphrase: string;
  linkedDevices: LinkedDevice[];

  // WebSocket
  ws: WebSocket | null;

  // Actions
  enable: () => void;
  disable: () => void;
  setRelayUrl: (url: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  regeneratePairingCode: () => void;
  removeDevice: (deviceId: string) => void;
  setDeviceName: (name: string) => void;

  // Internal handlers
  handleMessage: (data: unknown) => void;
  sendMessage: (message: Record<string, unknown>) => void;
}

const getDeviceName = (): string => {
  // Try to get a reasonable device name
  if (typeof navigator !== "undefined") {
    const platform = navigator.platform || "Desktop";
    const userAgent = navigator.userAgent || "";

    if (userAgent.includes("Mac")) return "Mac";
    if (userAgent.includes("Windows")) return "Windows PC";
    if (userAgent.includes("Linux")) return "Linux PC";
    return platform;
  }
  return "Chell Desktop";
};

export const usePortalStore = create<PortalState>()(
  persist(
    (set, get) => ({
      // Initial state
      isEnabled: false,
      isConnected: false,
      relayUrl: "wss://chell-relay.workers.dev",
      error: null,
      deviceId: generateDeviceId(),
      deviceName: getDeviceName(),
      pairingCode: generatePairingCode(),
      pairingPassphrase: generatePassphrase(),
      linkedDevices: [],
      ws: null,

      enable: () => {
        set({ isEnabled: true });
        get().connect();
      },

      disable: () => {
        get().disconnect();
        set({ isEnabled: false });
      },

      setRelayUrl: (url: string) => {
        const wasConnected = get().isConnected;
        if (wasConnected) {
          get().disconnect();
        }
        set({ relayUrl: url });
        if (wasConnected && get().isEnabled) {
          get().connect();
        }
      },

      connect: async () => {
        const { relayUrl, ws: existingWs, deviceId, deviceName, pairingCode, pairingPassphrase } = get();

        if (existingWs) {
          existingWs.close();
        }

        set({ error: null });

        try {
          const ws = new WebSocket(`${relayUrl}/ws`);

          ws.onopen = () => {
            console.log("[Portal] Connected to relay");
            set({ isConnected: true, ws });

            // Register desktop
            get().sendMessage({
              type: "register_desktop",
              id: crypto.randomUUID(),
              deviceName,
              pairingCode,
              pairingPassphrase,
            });
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              get().handleMessage(data);
            } catch (err) {
              console.error("[Portal] Failed to parse message:", err);
            }
          };

          ws.onclose = () => {
            console.log("[Portal] Disconnected from relay");
            set({ isConnected: false, ws: null });

            // Auto-reconnect if enabled
            if (get().isEnabled) {
              setTimeout(() => {
                if (get().isEnabled && !get().isConnected) {
                  get().connect();
                }
              }, 5000);
            }
          };

          ws.onerror = (error) => {
            console.error("[Portal] WebSocket error:", error);
            set({ error: "Connection failed", isConnected: false });
          };
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Failed to connect",
            isConnected: false,
          });
        }
      },

      disconnect: () => {
        const { ws } = get();
        if (ws) {
          ws.close();
        }
        set({ isConnected: false, ws: null });
      },

      regeneratePairingCode: () => {
        const newCode = generatePairingCode();
        const newPassphrase = generatePassphrase();
        set({
          pairingCode: newCode,
          pairingPassphrase: newPassphrase,
        });

        // Update relay if connected
        if (get().isConnected) {
          get().sendMessage({
            type: "register_desktop",
            id: crypto.randomUUID(),
            deviceName: get().deviceName,
            pairingCode: newCode,
            pairingPassphrase: newPassphrase,
          });
        }
      },

      removeDevice: (deviceId: string) => {
        set((state) => ({
          linkedDevices: state.linkedDevices.filter((d) => d.id !== deviceId),
        }));

        // Notify relay
        get().sendMessage({
          type: "unpair",
          id: crypto.randomUUID(),
          deviceId,
        });
      },

      setDeviceName: (name: string) => {
        set({ deviceName: name });
      },

      handleMessage: (data: unknown) => {
        const message = data as Record<string, unknown>;

        switch (message.type) {
          case "device_list":
            set({ linkedDevices: message.devices as LinkedDevice[] });
            break;

          case "command": {
            // Forward command to Tauri backend
            const { command, params, id } = message as {
              command: string;
              params: Record<string, unknown>;
              id: string;
            };

            // Import invoke dynamically to avoid issues
            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke(command, params)
                .then((result) => {
                  get().sendMessage({
                    type: "command_response",
                    id: crypto.randomUUID(),
                    requestId: id,
                    success: true,
                    result,
                  });
                })
                .catch((error) => {
                  get().sendMessage({
                    type: "command_response",
                    id: crypto.randomUUID(),
                    requestId: id,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                  });
                });
            });
            break;
          }

          case "terminal_input": {
            const { terminalId, data: inputData } = message as {
              terminalId: string;
              data: string;
            };

            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke("write_terminal", { id: terminalId, data: inputData });
            });
            break;
          }

          case "request_status": {
            // Send current status to mobile including theme and custom colors
            import("@/stores/settingsStore").then(({ useSettingsStore }) => {
              const { theme, customTheme } = useSettingsStore.getState();

              const statusUpdate: Record<string, unknown> = {
                type: "status_update",
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                connectionStatus: "connected",
                theme,
              };

              // Include custom theme colors if using custom theme
              if (theme === "custom" && customTheme) {
                statusUpdate.customTheme = {
                  baseTheme: customTheme.baseTheme,
                  colors: customTheme.colors,
                };
              }

              get().sendMessage(statusUpdate);
            });
            break;
          }

          case "error":
            set({ error: message.message as string });
            break;
        }
      },

      sendMessage: (message: Record<string, unknown>) => {
        const { ws } = get();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              ...message,
              timestamp: Date.now(),
            })
          );
        }
      },
    }),
    {
      name: "chell-portal",
      partialize: (state) => ({
        isEnabled: state.isEnabled,
        relayUrl: state.relayUrl,
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        linkedDevices: state.linkedDevices,
      }),
    }
  )
);

// Terminal output forwarding - hook into terminal events
export function setupTerminalForwarding() {
  const { listen } = require("@tauri-apps/api/event");

  // Listen for terminal output events and forward to mobile
  listen("terminal-output", (event: { payload: { terminalId: string; data: number[] } }) => {
    const { isConnected, sendMessage } = usePortalStore.getState();
    if (!isConnected) return;

    const { terminalId, data } = event.payload;
    const text = new TextDecoder().decode(new Uint8Array(data));

    sendMessage({
      type: "terminal_output",
      id: crypto.randomUUID(),
      terminalId,
      data: text,
    });
  });
}
