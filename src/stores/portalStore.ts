import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LinkedDevice } from "@/types";
import { useSettingsStore } from "./settingsStore";
import {
  deriveKey,
  encryptMessage,
  decryptMessage,
  shouldEncrypt,
} from "@/lib/portalCrypto";

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

  // E2E encryption key (shared by all paired devices)
  encryptionKey: CryptoKey | null;

  // Mobile-spawned terminals (only forward output for these)
  mobileTerminalIds: Set<string>;

  // Desktop-spawned terminals (never forward these)
  localTerminalIds: Set<string>;

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
  registerLocalTerminal: (terminalId: string) => void;
  unregisterLocalTerminal: (terminalId: string) => void;

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
      relayUrl: "wss://relay.chell.app",
      error: null,
      deviceId: generateDeviceId(),
      deviceName: getDeviceName(),
      pairingCode: generatePairingCode(),
      pairingPassphrase: generatePassphrase(),
      linkedDevices: [],
      encryptionKey: null,
      mobileTerminalIds: new Set(),
      localTerminalIds: new Set(),
      ws: null,

      enable: () => {
        set({ isEnabled: true });
        get().connect();
        // Notify backend so it knows to minimize to tray on close
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("set_portal_enabled", { enabled: true });
        });
      },

      disable: () => {
        get().disconnect();
        set({ isEnabled: false });
        // Notify backend so it knows to quit on close
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("set_portal_enabled", { enabled: false });
        });
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

          ws.onopen = async () => {
            console.log("[Portal] Connected to relay");
            set({ isConnected: true, ws });

            // Derive encryption key from passphrase and deviceId
            try {
              const key = await deriveKey(pairingPassphrase, deviceId);
              set({ encryptionKey: key });
              console.log("[Portal] Derived encryption key");
            } catch (err) {
              console.error("[Portal] Failed to derive encryption key:", err);
            }

            // Register desktop with deviceId so relay can find existing session
            get().sendMessage({
              type: "register_desktop",
              id: crypto.randomUUID(),
              deviceId,
              deviceName,
              pairingCode,
              pairingPassphrase,
            });
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              // Log message types to terminal for debugging
              import("@tauri-apps/api/core").then(({ invoke }) => {
                invoke("debug_log", { message: `Portal received WS message: ${data.type}` });
              });
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

      regeneratePairingCode: async () => {
        const newCode = generatePairingCode();
        const newPassphrase = generatePassphrase();
        const { deviceId } = get();

        // Clear linked devices since new passphrase invalidates old pairings
        set({
          pairingCode: newCode,
          pairingPassphrase: newPassphrase,
          linkedDevices: [],
        });

        // Re-derive encryption key with new passphrase
        try {
          const key = await deriveKey(newPassphrase, deviceId);
          set({ encryptionKey: key });
          console.log("[Portal] Re-derived encryption key after passphrase change");
        } catch (err) {
          console.error("[Portal] Failed to re-derive encryption key:", err);
        }

        // Update relay if connected
        if (get().isConnected) {
          get().sendMessage({
            type: "register_desktop",
            id: crypto.randomUUID(),
            deviceId,
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

      registerLocalTerminal: (terminalId: string) => {
        set((state) => ({
          localTerminalIds: state.localTerminalIds.has(terminalId)
            ? state.localTerminalIds
            : new Set([...state.localTerminalIds, terminalId]),
        }));
      },

      unregisterLocalTerminal: (terminalId: string) => {
        set((state) => {
          if (!state.localTerminalIds.has(terminalId)) return {};
          const newSet = new Set(state.localTerminalIds);
          newSet.delete(terminalId);
          return { localTerminalIds: newSet };
        });
      },

      handleMessage: async (data: unknown) => {
        let message = data as Record<string, unknown>;

        // Decrypt message if it has encrypted payload
        if (message.encrypted && typeof message.encrypted === "object") {
          console.log("[Portal] Received encrypted message, type:", message.type);
          const { type, timestamp } = message as {
            type: string;
            timestamp: number;
            encrypted: { iv: string; ciphertext: string };
          };
          const encrypted = message.encrypted as { iv: string; ciphertext: string };

          const { encryptionKey } = get();

          if (!encryptionKey) {
            console.error("[Portal] No encryption key available for decryption");
            return;
          }

          console.log("[Portal] Attempting decryption with key present");
          try {
            const decrypted = await decryptMessage(
              encryptionKey,
              encrypted.iv,
              encrypted.ciphertext,
              type,
              timestamp
            );
            // Merge decrypted payload back into message
            message = { ...message, ...decrypted };
            delete message.encrypted;
            console.log("[Portal] Decrypted message type:", type);
          } catch (err) {
            console.error("[Portal] Failed to decrypt message:", err);
            return;
          }
        }

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

            console.log("[Portal] Received command from mobile:", command, "id:", id, "params:", JSON.stringify(params).slice(0, 100));

            // Inject API key for AI commands from settings
            let finalParams = { ...params };
            if (command === "generate_commit_message" || command === "ai_shell_command") {
              const groqApiKey = useSettingsStore.getState().groqApiKey;
              if (groqApiKey) {
                finalParams.apiKey = groqApiKey;
                console.log("[Portal] Injected API key for", command);
              } else {
                console.warn("[Portal] No Groq API key configured in settings");
              }
            }

            // Import invoke dynamically to avoid issues
            import("@tauri-apps/api/core").then(({ invoke }) => {
              console.log("[Portal] Calling Tauri invoke:", command);
              invoke(command, finalParams)
                .then((result) => {
                  // Track terminal IDs spawned by mobile
                  if (command === "spawn_terminal" && typeof result === "string") {
                    set((state) => ({
                      mobileTerminalIds: new Set([...state.mobileTerminalIds, result]),
                    }));
                  }

                  // Clean up killed terminal IDs
                  if (command === "kill_terminal" && finalParams.id) {
                    set((state) => {
                      const newSet = new Set(state.mobileTerminalIds);
                      newSet.delete(finalParams.id as string);
                      return { mobileTerminalIds: newSet };
                    });
                  }

                  console.log("[Portal] Command succeeded:", command, "sending response with requestId:", id);
                  get().sendMessage({
                    type: "command_response",
                    id: crypto.randomUUID(),
                    requestId: id,
                    success: true,
                    result,
                  });
                })
                .catch((error) => {
                  console.log("[Portal] Command failed:", command, "error:", error, "sending response with requestId:", id);
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

            console.log("[Portal] Received terminal_input for", terminalId, "data:", JSON.stringify(inputData));
            // Ensure output gets forwarded for terminals used by mobile after reconnects
            set((state) => ({
              mobileTerminalIds: state.mobileTerminalIds.has(terminalId)
                ? state.mobileTerminalIds
                : new Set([...state.mobileTerminalIds, terminalId]),
            }));

            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke("write_terminal", { id: terminalId, data: inputData })
                .then(() => {
                  console.log("[Portal] write_terminal success");
                })
                .catch((err) => {
                  console.error("[Portal] write_terminal failed:", err);
                });
            });
            break;
          }

          case "attach_terminal": {
            // Mobile wants to attach to an existing desktop terminal session
            const { terminalId } = message as { terminalId: string };
            console.log("[Portal] Mobile attaching to terminal:", terminalId);

            // Fetch buffer content and send to mobile BEFORE enabling live output forwarding
            // This ensures buffer arrives first, then live output follows
            import("@tauri-apps/api/core").then(async ({ invoke }) => {
              try {
                const buffer = await invoke<string>("get_terminal_buffer", { id: terminalId });
                console.log("[Portal] Got buffer for terminal", terminalId, "length:", buffer.length);

                if (buffer && buffer.length > 0) {
                  // Decode base64 buffer to text
                  const bytes = Uint8Array.from(atob(buffer), c => c.charCodeAt(0));
                  const text = new TextDecoder().decode(bytes);

                  if (text) {
                    // Send buffered output to mobile
                    get().sendMessage({
                      type: "terminal_output",
                      id: crypto.randomUUID(),
                      terminalId,
                      data: text,
                    });
                  }
                }

                // NOW add to mobileTerminalIds so future live output gets forwarded
                // (after buffer has been sent)
                set((state) => ({
                  mobileTerminalIds: state.mobileTerminalIds.has(terminalId)
                    ? state.mobileTerminalIds
                    : new Set([...state.mobileTerminalIds, terminalId]),
                }));

                // Send confirmation back
                get().sendMessage({
                  type: "attach_terminal_response",
                  id: crypto.randomUUID(),
                  terminalId,
                  success: true,
                });
              } catch (err) {
                console.error("[Portal] Failed to get terminal buffer:", err);
                // Still add to forwarding list and send confirmation
                set((state) => ({
                  mobileTerminalIds: state.mobileTerminalIds.has(terminalId)
                    ? state.mobileTerminalIds
                    : new Set([...state.mobileTerminalIds, terminalId]),
                }));
                get().sendMessage({
                  type: "attach_terminal_response",
                  id: crypto.randomUUID(),
                  terminalId,
                  success: true,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            });
            break;
          }

          case "detach_terminal": {
            // Mobile wants to stop receiving output from a terminal (but not kill it)
            const { terminalId } = message as { terminalId: string };
            console.log("[Portal] Mobile detaching from terminal:", terminalId);

            set((state) => {
              const newSet = new Set(state.mobileTerminalIds);
              newSet.delete(terminalId);
              return { mobileTerminalIds: newSet };
            });
            break;
          }

          case "request_status": {
            // Send current status to mobile including theme, custom colors, project list, and terminals
            console.log("[Portal] Received request_status from mobile");
            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke("debug_log", { message: "Portal received request_status from mobile" });
            });
            Promise.all([
              import("@/stores/settingsStore"),
              import("@/stores/projectStore"),
              import("@tauri-apps/api/core"),
            ]).then(async ([{ useSettingsStore }, { useProjectStore }, { invoke }]) => {
              const { theme, customTheme } = useSettingsStore.getState();
              const { projects, tabs, activeTabId } = useProjectStore.getState();

              // TEMPORARILY DISABLED: Desktop terminal listing
              // let terminals: Array<{ id: string; title: string; cwd: string }> = [];
              // try {
              //   terminals = await invoke<Array<{ id: string; title: string; cwd: string }>>("list_terminals");
              //   console.log("[Portal] Got terminals from backend:", terminals);
              // } catch (err) {
              //   console.error("[Portal] Failed to list terminals:", err);
              // }

              // Find active project from active tab
              const activeTab = tabs.find((t) => t.id === activeTabId);
              const activeProjectId = activeTab?.projectId || null;

              // TEMPORARILY DISABLED: Desktop terminals are not sent to mobile
              // Mobile can only spawn its own terminals for now
              // const terminalList = terminals.map((t) => {
              //   const titleLower = t.title.toLowerCase();
              //   const isAssistant = assistantCommands.some(cmd =>
              //     titleLower === cmd ||
              //     titleLower.includes(cmd) ||
              //     titleLower.includes("claude code") ||
              //     titleLower.includes("gemini cli") ||
              //     titleLower.includes("openai codex")
              //   );
              //   return {
              //     id: t.id,
              //     title: t.title,
              //     cwd: t.cwd,
              //     type: isAssistant ? "assistant" : "shell",
              //   };
              // });

              const statusUpdate: Record<string, unknown> = {
                type: "status_update",
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                connectionStatus: "connected",
                theme,
                projects: projects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  path: p.path,
                })),
                activeProjectId,
                terminals: [], // Desktop terminals disabled - mobile spawns its own
              };

              // Include custom theme colors if using custom theme
              if (theme === "custom" && customTheme) {
                statusUpdate.customTheme = {
                  baseTheme: customTheme.baseTheme,
                  colors: customTheme.colors,
                };
              }

              console.log("[Portal] Sending status_update (desktop terminals disabled)");
              invoke("debug_log", { message: "Portal sending status_update (desktop terminals disabled - mobile spawns its own)" });
              get().sendMessage(statusUpdate);
            });
            break;
          }

          case "select_project": {
            // Mobile wants to switch to a different project
            const { projectId } = message as { projectId: string };
            import("@/stores/projectStore").then(({ useProjectStore }) => {
              const { projects, openTab } = useProjectStore.getState();
              const project = projects.find((p) => p.id === projectId);

              if (project) {
                // Open/switch to this project's tab
                openTab(project);

                // Send confirmation back
                get().sendMessage({
                  type: "project_changed",
                  id: crypto.randomUUID(),
                  timestamp: Date.now(),
                  projectId,
                });
              }
            });
            break;
          }

          case "error":
            console.error("[Portal] Error from relay:", message.code, message.message);
            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke("debug_log", { message: `Portal error: ${message.code} - ${message.message}` });
            });
            set({ error: message.message as string });
            break;
        }
      },

      sendMessage: async (message: Record<string, unknown>) => {
        const { ws, encryptionKey } = get();
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const timestamp = Date.now();
        const type = message.type as string;

        // Check if this message type should be encrypted
        if (encryptionKey && shouldEncrypt(type)) {
          try {
            // Extract routing fields that stay plaintext
            const { type: msgType, id, sessionToken, ...payload } = message;

            const encrypted = await encryptMessage(
              encryptionKey,
              payload,
              type,
              timestamp
            );

            console.log("[Portal] Sending encrypted message type:", msgType);
            ws.send(
              JSON.stringify({
                type: msgType,
                id,
                sessionToken,
                timestamp,
                encrypted,
              })
            );
            return;
          } catch (err) {
            console.error("[Portal] Failed to encrypt message:", err);
            // Fall through to send unencrypted as fallback
          }
        }

        // Send unencrypted (for registration messages or if encryption failed)
        ws.send(
          JSON.stringify({
            ...message,
            timestamp,
          })
        );
      },
    }),
    {
      name: "chell-portal",
      partialize: (state) => ({
        isEnabled: state.isEnabled,
        relayUrl: state.relayUrl,
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        pairingCode: state.pairingCode,
        pairingPassphrase: state.pairingPassphrase,
        linkedDevices: state.linkedDevices,
      }),
      onRehydrateStorage: () => (state) => {
        // Sync portal enabled state with backend
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("set_portal_enabled", { enabled: state?.isEnabled ?? false });
        });

        // Auto-connect if portal was enabled before app closed
        if (state?.isEnabled) {
          console.log("[Portal] Auto-connecting on launch (was enabled)");
          // Slight delay to ensure app is fully initialized
          setTimeout(() => {
            state.connect();
          }, 500);
        }
      },
    }
  )
);

// Terminal output forwarding - hook into terminal events
export function setupTerminalForwarding() {
  import("@tauri-apps/api/event").then(({ listen }) => {
    // Listen for terminal output events and forward to mobile
    // Only forward output for terminals spawned by mobile, not local desktop terminals
    listen("terminal-output", (event: { payload: { terminalId: string; data: string } }) => {
      const { isConnected, sendMessage, mobileTerminalIds, localTerminalIds } = usePortalStore.getState();
      if (!isConnected) return;

      const { terminalId, data } = event.payload;

      if (localTerminalIds.has(terminalId)) return;

      // Only forward output for terminals spawned by mobile
      if (!mobileTerminalIds.has(terminalId)) return;

      // Decode base64 to text
      try {
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const text = new TextDecoder().decode(bytes);
        if (!text) return;

        sendMessage({
          type: "terminal_output",
          id: crypto.randomUUID(),
          terminalId,
          data: text,
        });
      } catch (e) {
        console.error("[Portal] Failed to decode terminal output:", e);
      }
    });
  });
}

// Git file change forwarding - notify mobile when git files change
export function setupGitChangeForwarding() {
  import("@tauri-apps/api/event").then(({ listen }) => {
    listen<string>("git-files-changed", (event) => {
      const { isConnected, sendMessage } = usePortalStore.getState();
      if (!isConnected) return;

      // Notify mobile that git files changed for this repo
      sendMessage({
        type: "git_files_changed",
        id: crypto.randomUUID(),
        repoPath: event.payload,
      });
    });
  });
}
