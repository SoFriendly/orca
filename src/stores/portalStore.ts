import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LinkedDevice } from "@/types";

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

          ws.onopen = () => {
            console.log("[Portal] Connected to relay");
            set({ isConnected: true, ws });

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
            deviceId: get().deviceId,
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

            console.log("[Portal] Received command from mobile:", command, "id:", id, "params:", JSON.stringify(params).slice(0, 100));

            // Inject API key for AI commands
            let finalParams = { ...params };
            if (command === "generate_commit_message" || command === "ai_shell_command") {
              const GROQ_API_KEY = "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";
              finalParams.apiKey = GROQ_API_KEY;
              console.log("[Portal] Injected API key for", command);
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

            // Add to mobileTerminalIds so output gets forwarded
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
            Promise.all([
              import("@/stores/settingsStore"),
              import("@/stores/projectStore"),
              import("@/stores/terminalStore"),
            ]).then(([{ useSettingsStore }, { useProjectStore }, { useTerminalStore }]) => {
              const { theme, customTheme } = useSettingsStore.getState();
              const { projects, tabs, activeTabId } = useProjectStore.getState();
              const { terminals } = useTerminalStore.getState();

              // Find active project from active tab
              const activeTab = tabs.find((t) => t.id === activeTabId);
              const activeProjectId = activeTab?.projectId || null;

              // Known assistant commands - used to infer terminal type
              const assistantCommands = ["claude", "aider", "gemini", "codex", "opencode"];

              // Get list of desktop terminals for mobile to see
              // Infer type from title/command
              const terminalList = Object.values(terminals).map((t) => {
                const titleLower = t.title.toLowerCase();
                const isAssistant = assistantCommands.some(cmd =>
                  titleLower === cmd ||
                  titleLower.includes(cmd) ||
                  titleLower.includes("claude code") ||
                  titleLower.includes("gemini cli") ||
                  titleLower.includes("openai codex")
                );
                return {
                  id: t.id,
                  title: t.title,
                  cwd: t.cwd,
                  type: isAssistant ? "assistant" : "shell",
                };
              });

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
                terminals: terminalList,
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
