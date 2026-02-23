import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import type { ConnectionState, Project, GitStatus, WSMessage, RemoteTerminal } from "~/types";
import { initWebSocket, getWebSocket, OrcaWebSocket } from "~/lib/websocket";

// Linked portal (desktop) info
export interface LinkedPortal {
  id: string;
  name: string;
  relayUrl: string;
  pairedAt: number;
  lastSeen: number;
  isOnline: boolean;
}

// Project folder for multi-folder workspaces
export interface ProjectFolder {
  id: string;
  name: string;
  path: string;
}

// Simple project info from desktop
export interface DesktopProject {
  id: string;
  name: string;
  path: string;
  lastOpened?: string;
  folders?: ProjectFolder[];
}

interface ConnectionStore extends ConnectionState {
  // State
  wsUrl: string;
  activeProject: Project | null;
  gitStatus: GitStatus | null;

  // Multi-portal support
  linkedPortals: LinkedPortal[];
  activePortalId: string | null;

  // Project list from desktop
  availableProjects: DesktopProject[];

  // Remote desktop terminals
  remoteTerminals: RemoteTerminal[];

  // Whether initial status has been received from desktop
  hasReceivedInitialStatus: boolean;

  // Actions
  setWsUrl: (url: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  pair: (pairingPassphrase: string, deviceName: string) => Promise<void>;
  pairFromQR: (qrData: string) => Promise<void>;
  setActiveProject: (project: Project | null) => void;
  setGitStatus: (status: GitStatus | null) => void;

  // Portal management
  addPortal: (portal: LinkedPortal) => void;
  removePortal: (portalId: string) => void;
  selectPortal: (portalId: string) => Promise<void>;

  // Project management
  selectProject: (projectId: string) => void;
  requestStatus: () => void;

  // Remote commands (proxy to desktop)
  invoke: <T>(command: string, params?: Record<string, unknown>) => Promise<T>;
  sendTerminalInput: (terminalId: string, data: string) => void;

  // Remote terminal management
  attachTerminal: (terminalId: string) => void;
  detachTerminal: (terminalId: string) => void;
}

const SECURE_TOKEN_PREFIX = "orca_session_";
const SECURE_PASSPHRASE_PREFIX = "orca_passphrase_";

function getDeviceName(): string {
  if (Device.deviceName) return Device.deviceName;
  if (Device.modelName) return Device.modelName;
  return "Mobile Device";
}

// Track the current handler's unsubscribe function to prevent accumulation
let currentHandlerUnsubscribe: (() => void) | null = null;

// Shared message handler setup - used by both connect() and pairFromQR()
function setupMessageHandler(
  ws: OrcaWebSocket,
  get: () => ConnectionStore,
  set: (partial: any) => void,
  desktopNameOverride?: string,
  pendingPassphrase?: string
) {
  // Clean up previous handler if any (prevents handler accumulation)
  if (currentHandlerUnsubscribe) {
    currentHandlerUnsubscribe();
    currentHandlerUnsubscribe = null;
  }

  currentHandlerUnsubscribe = ws.onMessage(async (message: WSMessage) => {
    switch (message.type) {
      case "pair_response":
        if (message.success && message.sessionToken) {
          const portalId = message.desktopDeviceId || "";

          // Save token securely
          SecureStore.setItemAsync(
            SECURE_TOKEN_PREFIX + portalId,
            message.sessionToken
          );
          ws.setSessionToken(message.sessionToken);

          // Derive and set encryption key if we have the passphrase
          if (pendingPassphrase && portalId) {
            try {
              await ws.setEncryptionKey(pendingPassphrase, portalId);
              // Save passphrase securely for future reconnects
              await SecureStore.setItemAsync(
                SECURE_PASSPHRASE_PREFIX + portalId,
                pendingPassphrase
              );
              console.log("[ConnectionStore] Encryption key derived and passphrase saved");
            } catch (err) {
              console.error("[ConnectionStore] Failed to derive encryption key:", err);
            }
          }

          // Add to linked portals
          const newPortal: LinkedPortal = {
            id: portalId,
            name: message.desktopDeviceName || desktopNameOverride || "Desktop",
            relayUrl: get().wsUrl,
            pairedAt: Date.now(),
            lastSeen: Date.now(),
            isOnline: true,
          };

          set((state) => ({
            status: "connected",
            sessionToken: message.sessionToken,
            deviceId: message.mobileDeviceId || null,
            desktopDeviceName: message.desktopDeviceName || desktopNameOverride || null,
            lastConnected: Date.now(),
            error: null,
            activePortalId: portalId,
            linkedPortals: [
              ...state.linkedPortals.filter((p) => p.id !== portalId),
              newPortal,
            ],
          }));
        } else {
          set({
            status: "disconnected",
            error: message.error || "Pairing failed",
          });
        }
        break;

      case "status_update":
        // Update portal online status, project list, and remote terminals
        console.log("[ConnectionStore] Received status_update:", JSON.stringify(message).slice(0, 300));
        console.log("[ConnectionStore] Projects in message:", (message as any).projects);
        console.log("[ConnectionStore] Terminals in message:", (message as any).terminals);
        if (message.connectionStatus === "connected") {
          const projects = (message.projects as DesktopProject[]) || [];
          const terminals = ((message as any).terminals as RemoteTerminal[]) || [];
          const activeProjectId = message.activeProjectId as string | undefined;
          console.log("[ConnectionStore] Parsed projects:", projects.length, projects);
          console.log("[ConnectionStore] Parsed terminals:", terminals.length, terminals);

          // Find active project from list
          const activeProject = activeProjectId
            ? projects.find((p) => p.id === activeProjectId)
            : null;

          set((state) => ({
            availableProjects: projects,
            remoteTerminals: terminals,
            hasReceivedInitialStatus: true,
            activeProject: activeProject ?? state.activeProject,
            gitStatus: message.gitStatus || state.gitStatus,
            linkedPortals: state.linkedPortals.map((p) =>
              p.id === state.activePortalId
                ? { ...p, isOnline: true, lastSeen: Date.now() }
                : p
            ),
          }));

          // Handle theme sync from desktop
          const statusMsg = message as any;
          if (statusMsg.theme) {
            import("./themeStore").then(({ useThemeStore }) => {
              const { syncWithDesktop, syncFromDesktop } = useThemeStore.getState();
              if (syncWithDesktop) {
                syncFromDesktop(statusMsg.theme, statusMsg.customTheme);
              }
            });
          }
        } else {
          set((state) => ({
            linkedPortals: state.linkedPortals.map((p) =>
              p.id === state.activePortalId
                ? { ...p, isOnline: false }
                : p
            ),
          }));
        }
        break;

      case "project_changed":
        // Desktop confirmed project change
        const changedProjectId = message.projectId as string;
        set((state) => {
          const project = state.availableProjects.find(
            (p) => p.id === changedProjectId
          );
          return {
            activeProject: project ?? state.activeProject,
          };
        });
        break;

      case "terminal_output":
        // Forward terminal output to terminalStore
        const { terminalId, data } = message as { terminalId: string; data: string };
        console.log("[ConnectionStore] Terminal output for", terminalId, ":", data.slice(0, 50));
        import("./terminalStore").then(({ useTerminalStore }) => {
          useTerminalStore.getState().appendOutput(terminalId, data);
        });
        break;

      case "git_files_changed":
        // Desktop detected git file changes, refresh git status
        const changedRepoPath = (message as { repoPath: string }).repoPath;
        const currentProject = get().activeProject;
        // Only refresh if this is the active project
        if (currentProject && currentProject.path === changedRepoPath) {
          console.log("[ConnectionStore] Git files changed, refreshing status");
          import("./gitStore").then(({ useGitStore }) => {
            useGitStore.getState().refresh(changedRepoPath);
          });
        }
        break;

      case "error":
        set({ error: message.message });
        break;
    }
  });

  ws.onDisconnect(() => {
    set((state) => ({
      status: "disconnected",
      linkedPortals: state.linkedPortals.map((p) =>
        p.id === state.activePortalId ? { ...p, isOnline: false } : p
      ),
    }));
  });
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set, get) => ({
      // Initial state
      status: "disconnected",
      sessionToken: null,
      deviceId: null,
      desktopDeviceName: null,
      lastConnected: null,
      error: null,
      wsUrl: "",
      activeProject: null,
      gitStatus: null,
      linkedPortals: [],
      activePortalId: null,
      availableProjects: [],
      remoteTerminals: [],
      hasReceivedInitialStatus: false,

      setWsUrl: (url: string) => set({ wsUrl: url }),

      connect: async () => {
        const { wsUrl, activePortalId, status: currentStatus } = get();
        if (!wsUrl) {
          set({ error: "No WebSocket URL configured" });
          return;
        }

        // Guard against concurrent connect calls (including during QR pairing)
        if (currentStatus === "connecting" || currentStatus === "connected" || currentStatus === "pairing") {
          return;
        }

        set({ status: "connecting", error: null, hasReceivedInitialStatus: false });

        try {
          const ws = initWebSocket(wsUrl);

          // Set up message handler using shared function
          setupMessageHandler(ws, get, set);

          await ws.connect();

          // If we have a saved session token for the active portal, try to reconnect
          if (activePortalId) {
            console.log("[ConnectionStore] Checking for saved token for portal:", activePortalId);
            const savedToken = await SecureStore.getItemAsync(
              SECURE_TOKEN_PREFIX + activePortalId
            );
            console.log("[ConnectionStore] Saved token found:", !!savedToken);
            if (savedToken) {
              ws.setSessionToken(savedToken);

              // Derive encryption key from saved passphrase
              const savedPassphrase = await SecureStore.getItemAsync(
                SECURE_PASSPHRASE_PREFIX + activePortalId
              );
              if (savedPassphrase) {
                try {
                  await ws.setEncryptionKey(savedPassphrase, activePortalId);
                  console.log("[ConnectionStore] Encryption key derived from saved passphrase");
                } catch (err) {
                  console.error("[ConnectionStore] Failed to derive encryption key:", err);
                }
              } else {
                console.warn("[ConnectionStore] No saved passphrase for encryption");
              }

              // Resume session with relay so it knows to forward messages to us
              console.log("[ConnectionStore] Resuming session...");
              ws.resumeSession(get().deviceId || "mobile");

              set((state) => ({
                status: "connected",
                sessionToken: savedToken,
                linkedPortals: state.linkedPortals.map((p) =>
                  p.id === activePortalId
                    ? { ...p, isOnline: true, lastSeen: Date.now() }
                    : p
                ),
              }));

              // Status will be requested by _layout.tsx when status becomes "connected"
              return;
            }
          }

          set({ status: "pairing" });
        } catch (err) {
          set({
            status: "disconnected",
            error: err instanceof Error ? err.message : "Connection failed",
          });
        }
      },

      disconnect: () => {
        try {
          const ws = getWebSocket();
          ws.disconnect();
        } catch {
          // Ignore if not initialized
        }
        set({
          status: "disconnected",
          sessionToken: null,
          activeProject: null,
          gitStatus: null,
        });
      },

      pair: async (pairingPassphrase: string, deviceName: string) => {
        const ws = getWebSocket();
        set({ status: "pairing", error: null });

        // Send registration message
        ws.send({
          type: "register_mobile",
          id: Math.random().toString(36).substring(2, 15),
          deviceName: deviceName || getDeviceName(),
          pairingPassphrase,
        });
      },

      pairFromQR: async (qrData: string) => {
        try {
          const data = JSON.parse(qrData);

          if (data.type !== "orca-portal") {
            throw new Error("Invalid QR code");
          }

          const { relay, passphrase, desktopName } = data;

          // Set status to pairing FIRST to prevent _layout.tsx auto-connect race
          set({ wsUrl: relay, desktopDeviceName: desktopName, status: "pairing" });

          const ws = initWebSocket(relay);

          // Set up full message handler (handles pair_response, status_update, etc.)
          // Pass passphrase so we can derive encryption key after pairing
          setupMessageHandler(ws, get, set, desktopName, passphrase);

          await ws.connect();

          // Send pairing request
          ws.send({
            type: "register_mobile",
            id: Math.random().toString(36).substring(2, 15),
            deviceName: getDeviceName(),
            pairingPassphrase: passphrase,
          });
        } catch (err) {
          set({
            status: "disconnected",
            error: err instanceof Error ? err.message : "Invalid QR code",
          });
          throw err;
        }
      },

      addPortal: (portal: LinkedPortal) => {
        set((state) => ({
          linkedPortals: [
            ...state.linkedPortals.filter((p) => p.id !== portal.id),
            portal,
          ],
        }));
      },

      removePortal: (portalId: string) => {
        SecureStore.deleteItemAsync(SECURE_TOKEN_PREFIX + portalId);
        SecureStore.deleteItemAsync(SECURE_PASSPHRASE_PREFIX + portalId);
        set((state) => ({
          linkedPortals: state.linkedPortals.filter((p) => p.id !== portalId),
          activePortalId:
            state.activePortalId === portalId ? null : state.activePortalId,
        }));
      },

      selectPortal: async (portalId: string) => {
        const { linkedPortals, disconnect } = get();
        const portal = linkedPortals.find((p) => p.id === portalId);

        if (!portal) {
          throw new Error("Portal not found");
        }

        // Disconnect from current portal
        disconnect();

        // Connect to new portal
        set({
          wsUrl: portal.relayUrl,
          activePortalId: portalId,
          desktopDeviceName: portal.name,
        });

        await get().connect();
      },

      setActiveProject: (project: Project | null) =>
        set({ activeProject: project }),

      setGitStatus: (status: GitStatus | null) => set({ gitStatus: status }),

      selectProject: (projectId: string) => {
        // Optimistically set the active project locally
        const project = get().availableProjects.find((p) => p.id === projectId);
        if (project) {
          set({ activeProject: project });
        }

        // Also notify the desktop to switch its active tab
        const { sessionToken } = get();
        const ws = getWebSocket();
        ws.send({
          type: "select_project",
          id: Math.random().toString(36).substring(2, 15),
          sessionToken,
          projectId,
        });
      },

      requestStatus: () => {
        try {
          const ws = getWebSocket();
          ws.requestStatus();
        } catch {
          // WebSocket not initialized or not authenticated
        }
      },

      invoke: async <T>(
        command: string,
        params: Record<string, unknown> = {}
      ): Promise<T> => {
        const ws = getWebSocket();
        return ws.invoke<T>(command, params);
      },

      sendTerminalInput: (terminalId: string, data: string) => {
        try {
          const ws = getWebSocket();
          ws.sendTerminalInput(terminalId, data);
        } catch (err) {
          console.error("[ConnectionStore] sendTerminalInput failed:", err);
        }
      },

      attachTerminal: (terminalId: string) => {
        try {
          const { sessionToken } = get();
          const ws = getWebSocket();
          ws.send({
            type: "attach_terminal",
            id: Math.random().toString(36).substring(2, 15),
            sessionToken,
            terminalId,
          });
          console.log("[ConnectionStore] Attaching to remote terminal:", terminalId);
        } catch (err) {
          console.error("[ConnectionStore] attachTerminal failed:", err);
        }
      },

      detachTerminal: (terminalId: string) => {
        try {
          const { sessionToken } = get();
          const ws = getWebSocket();
          ws.send({
            type: "detach_terminal",
            id: Math.random().toString(36).substring(2, 15),
            sessionToken,
            terminalId,
          });
          console.log("[ConnectionStore] Detaching from remote terminal:", terminalId);
        } catch (err) {
          console.error("[ConnectionStore] detachTerminal failed:", err);
        }
      },
    }),
    {
      name: "orca-connection",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        wsUrl: state.wsUrl,
        deviceId: state.deviceId,
        desktopDeviceName: state.desktopDeviceName,
        lastConnected: state.lastConnected,
        linkedPortals: state.linkedPortals,
        activePortalId: state.activePortalId,
      }),
    }
  )
);
