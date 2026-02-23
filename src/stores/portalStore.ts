import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LinkedDevice } from "@/types";
import { useSettingsStore } from "./settingsStore";

interface PortalState {
  // Connection state (synced from backend)
  isEnabled: boolean;
  isConnected: boolean;
  relayUrl: string;
  error: string | null;

  // Session info (synced from backend)
  deviceId: string;
  deviceName: string;
  pairingCode: string;
  pairingPassphrase: string;
  linkedDevices: LinkedDevice[];

  // Desktop-spawned terminals (never forward these)
  localTerminalIds: Set<string>;

  // Actions
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  setRelayUrl: (url: string) => Promise<void>;
  regeneratePairingCode: () => Promise<void>;
  removeDevice: (deviceId: string) => Promise<void>;
  setDeviceName: (name: string) => void;
  registerLocalTerminal: (terminalId: string) => void;
  unregisterLocalTerminal: (terminalId: string) => void;
  syncFromBackend: () => Promise<void>;
  sendMessage: (message: Record<string, unknown>) => Promise<void>;

  // Internal: update state from backend events
  updateFromBackend: (data: Partial<PortalState>) => void;
}

export const usePortalStore = create<PortalState>()(
  persist(
    (set, get) => ({
      // Initial state
      isEnabled: false,
      isConnected: false,
      relayUrl: "wss://relay.chell.app",
      error: null,
      deviceId: "",
      deviceName: "",
      pairingCode: "",
      pairingPassphrase: "",
      linkedDevices: [],
      localTerminalIds: new Set(),

      enable: async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("portal_enable");
          // State will be updated via event listener
          set({ isEnabled: true, error: null });
        } catch (err) {
          console.error("[Portal] Failed to enable:", err);
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      disable: async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("portal_disable");
          set({ isEnabled: false, isConnected: false });
        } catch (err) {
          console.error("[Portal] Failed to disable:", err);
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      setRelayUrl: async (url: string) => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const config = await invoke<{
            is_enabled: boolean;
            relay_url: string;
            device_id: string;
            device_name: string;
            pairing_code: string;
            pairing_passphrase: string;
            linked_devices: LinkedDevice[];
          }>("get_portal_config");

          config.relay_url = url;
          await invoke("set_portal_config", { config });
          set({ relayUrl: url });

          // If enabled, need to reconnect with new URL
          if (get().isEnabled) {
            await invoke("portal_disable");
            await invoke("portal_enable");
          }
        } catch (err) {
          console.error("[Portal] Failed to set relay URL:", err);
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      regeneratePairingCode: async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const config = await invoke<{
            pairing_code: string;
            pairing_passphrase: string;
            linked_devices: LinkedDevice[];
          }>("portal_regenerate_pairing");
          set({
            pairingCode: config.pairing_code,
            pairingPassphrase: config.pairing_passphrase,
            linkedDevices: config.linked_devices,
          });
        } catch (err) {
          console.error("[Portal] Failed to regenerate pairing:", err);
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      removeDevice: async (deviceId: string) => {
        try {
          // Update local state immediately
          set((state) => ({
            linkedDevices: state.linkedDevices.filter((d) => d.id !== deviceId),
          }));

          // Send unpair message via backend
          const { sendMessage } = get();
          await sendMessage({
            type: "unpair",
            id: crypto.randomUUID(),
            deviceId,
          });
        } catch (err) {
          console.error("[Portal] Failed to remove device:", err);
        }
      },

      setDeviceName: (name: string) => {
        set({ deviceName: name });
        // TODO: sync to backend
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

      syncFromBackend: async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const status = await invoke<{
            isEnabled: boolean;
            isConnected: boolean;
            deviceId: string;
            deviceName: string;
            pairingCode: string;
            linkedDevices: LinkedDevice[];
          }>("portal_get_status");

          // Also get full config for passphrase and relay URL
          const config = await invoke<{
            is_enabled: boolean;
            relay_url: string;
            device_id: string;
            device_name: string;
            pairing_code: string;
            pairing_passphrase: string;
            linked_devices: LinkedDevice[];
          }>("get_portal_config");

          set({
            isEnabled: status.isEnabled,
            isConnected: status.isConnected,
            relayUrl: config.relay_url,
            deviceId: status.deviceId,
            deviceName: status.deviceName,
            pairingCode: status.pairingCode,
            pairingPassphrase: config.pairing_passphrase,
            linkedDevices: status.linkedDevices,
          });
        } catch (err) {
          console.error("[Portal] Failed to sync from backend:", err);
        }
      },

      sendMessage: async (message: Record<string, unknown>) => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("portal_send_message", { message });
        } catch (err) {
          console.error("[Portal] Failed to send message:", err);
        }
      },

      updateFromBackend: (data: Partial<PortalState>) => {
        set(data);
      },
    }),
    {
      name: "orca-portal",
      partialize: (state) => ({
        // Only persist local terminal IDs, everything else comes from backend
        localTerminalIds: Array.from(state.localTerminalIds),
      }),
      merge: (persisted, current) => ({
        ...current,
        localTerminalIds: new Set(
          (persisted as { localTerminalIds?: string[] })?.localTerminalIds || []
        ),
      }),
    }
  )
);

// Handle command messages from backend (needs frontend context for API keys, invoke)
async function handleCommand(message: Record<string, unknown>) {
  const { command, params, id } = message as {
    command: string;
    params: Record<string, unknown>;
    id: string;
  };

  console.log("[Portal] Received command from mobile:", command, "id:", id);

  // Inject API key and provider for AI commands from settings
  let finalParams = { ...params };
  if (command === "generate_commit_message" || command === "ai_shell_command") {
    const { aiApiKey, aiProviderType, aiModel } = useSettingsStore.getState();
    if (aiApiKey) {
      finalParams.apiKey = aiApiKey;
      finalParams.provider = aiProviderType;
      finalParams.model = aiModel;
      console.log("[Portal] Injected API key and provider for", command);
    } else {
      console.warn("[Portal] No AI API key configured in settings");
    }
  }

  const { invoke } = await import("@tauri-apps/api/core");
  const { sendMessage } = usePortalStore.getState();

  try {
    const result = await invoke(command, finalParams);
    console.log("[Portal] Command succeeded:", command);

    // Auto-register mobile-spawned terminals for output forwarding
    if (command === "spawn_terminal" && typeof result === "string") {
      try {
        await invoke("portal_register_mobile_terminal", { terminalId: result });
        console.log("[Portal] Auto-registered mobile terminal for output forwarding:", result);
      } catch (err) {
        console.error("[Portal] Failed to register mobile terminal:", err);
      }
    }

    await sendMessage({
      type: "command_response",
      id: crypto.randomUUID(),
      requestId: id,
      success: true,
      result,
    });
  } catch (error) {
    console.log("[Portal] Command failed:", command, "error:", error);
    await sendMessage({
      type: "command_response",
      id: crypto.randomUUID(),
      requestId: id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Handle select_project messages from backend (needs frontend to open tab)
async function handleSelectProject(message: Record<string, unknown>) {
  const { projectId } = message as { projectId: string };
  const { useProjectStore } = await import("@/stores/projectStore");
  const { projects, openTab } = useProjectStore.getState();
  const project = projects.find((p) => p.id === projectId);

  if (project) {
    openTab(project);

    const { sendMessage } = usePortalStore.getState();
    await sendMessage({
      type: "project_changed",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      projectId,
    });
  }
}

// Setup event listeners for backend portal events
export function setupPortalEventListeners() {
  import("@tauri-apps/api/event").then(({ listen }) => {
    // Connection state changes
    listen<{ isConnected: boolean }>("portal-state-changed", (event) => {
      console.log("[Portal] State changed:", event.payload);
      usePortalStore.getState().updateFromBackend({
        isConnected: event.payload.isConnected,
      });
    });

    // Linked devices updated
    listen<LinkedDevice[]>("portal-devices-updated", (event) => {
      console.log("[Portal] Devices updated:", event.payload);
      usePortalStore.getState().updateFromBackend({
        linkedDevices: event.payload,
      });
    });

    // Command from mobile - needs frontend handling
    listen<Record<string, unknown>>("portal-command", (event) => {
      console.log("[Portal] Received portal-command event");
      handleCommand(event.payload);
    });

    // Select project from mobile - needs frontend handling
    listen<Record<string, unknown>>("portal-select-project", (event) => {
      console.log("[Portal] Received portal-select-project event");
      handleSelectProject(event.payload);
    });

    // Error from relay
    listen<{ code: string; message: string }>("portal-error", (event) => {
      console.error("[Portal] Error:", event.payload);
      usePortalStore.getState().updateFromBackend({
        error: event.payload.message,
      });
    });
  });

  // Sync initial state from backend
  usePortalStore.getState().syncFromBackend();
}

// Git file change forwarding - notify mobile when git files change
export function setupGitChangeForwarding() {
  import("@tauri-apps/api/event").then(({ listen }) => {
    listen<string>("git-files-changed", (event) => {
      const { isConnected, sendMessage } = usePortalStore.getState();
      if (!isConnected) return;

      sendMessage({
        type: "git_files_changed",
        id: crypto.randomUUID(),
        repoPath: event.payload,
      });
    });
  });
}

// Terminal output forwarding is now handled in Rust backend
// Keep this function for backwards compatibility but it's now a no-op
export function setupTerminalForwarding() {
  // Terminal output forwarding is handled in Rust backend (portal.rs)
  // This function is kept for backwards compatibility
  console.log("[Portal] Terminal forwarding handled by Rust backend");
}

// Window focus reconnect is no longer needed - backend stays connected
export function setupWindowFocusReconnect() {
  // No longer needed - Rust backend maintains connection even when window is hidden
  console.log("[Portal] Window focus reconnect not needed - backend handles connection");
}
