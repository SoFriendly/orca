import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import type { ConnectionState, Project, GitStatus, WSMessage } from "~/types";
import { initWebSocket, getWebSocket, ChellWebSocket } from "~/lib/websocket";

// Linked portal (desktop) info
export interface LinkedPortal {
  id: string;
  name: string;
  relayUrl: string;
  pairedAt: number;
  lastSeen: number;
  isOnline: boolean;
}

// Simple project info from desktop
export interface DesktopProject {
  id: string;
  name: string;
  path: string;
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
}

const SECURE_TOKEN_PREFIX = "chell_session_";

function getDeviceName(): string {
  if (Device.deviceName) return Device.deviceName;
  if (Device.modelName) return Device.modelName;
  return "Mobile Device";
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

      setWsUrl: (url: string) => set({ wsUrl: url }),

      connect: async () => {
        const { wsUrl, activePortalId } = get();
        if (!wsUrl) {
          set({ error: "No WebSocket URL configured" });
          return;
        }

        set({ status: "connecting", error: null });

        try {
          const ws = initWebSocket(wsUrl);

          // Set up message handler
          ws.onMessage((message: WSMessage) => {
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

                  // Add to linked portals
                  const newPortal: LinkedPortal = {
                    id: portalId,
                    name: message.desktopDeviceName || "Desktop",
                    relayUrl: get().wsUrl,
                    pairedAt: Date.now(),
                    lastSeen: Date.now(),
                    isOnline: true,
                  };

                  set((state) => ({
                    status: "connected",
                    sessionToken: message.sessionToken,
                    deviceId: message.mobileDeviceId || null,
                    desktopDeviceName: message.desktopDeviceName || null,
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
                // Update portal online status and project list
                console.log("[ConnectionStore] Received status_update:", JSON.stringify(message).slice(0, 300));
                console.log("[ConnectionStore] Projects in message:", (message as any).projects);
                if (message.connectionStatus === "connected") {
                  const projects = (message.projects as DesktopProject[]) || [];
                  const activeProjectId = message.activeProjectId as string | undefined;
                  console.log("[ConnectionStore] Parsed projects:", projects.length, projects);

                  // Find active project from list
                  const activeProject = activeProjectId
                    ? projects.find((p) => p.id === activeProjectId)
                    : null;

                  set((state) => ({
                    availableProjects: projects,
                    activeProject: activeProject
                      ? { ...activeProject, lastOpened: "" }
                      : state.activeProject,
                    gitStatus: message.gitStatus || state.gitStatus,
                    linkedPortals: state.linkedPortals.map((p) =>
                      p.id === state.activePortalId
                        ? { ...p, isOnline: true, lastSeen: Date.now() }
                        : p
                    ),
                  }));
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
                    activeProject: project
                      ? { ...project, lastOpened: "" }
                      : state.activeProject,
                  };
                });
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

              // Resume session with relay so it knows to forward messages to us
              console.log("[ConnectionStore] Resuming session...");
              ws.resumeSession(get().deviceId || "mobile");

              set({
                status: "connected",
                sessionToken: savedToken,
              });
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

          if (data.type !== "chell-portal") {
            throw new Error("Invalid QR code");
          }

          const { relay, passphrase, desktopName } = data;

          // Set the relay URL and connect
          set({ wsUrl: relay, desktopDeviceName: desktopName });

          const ws = initWebSocket(relay);

          // Set up message handler before connecting
          ws.onMessage((message: WSMessage) => {
            if (message.type === "pair_response") {
              if (message.success && message.sessionToken) {
                const portalId = message.desktopDeviceId || "";

                SecureStore.setItemAsync(
                  SECURE_TOKEN_PREFIX + portalId,
                  message.sessionToken
                );
                ws.setSessionToken(message.sessionToken);

                const newPortal: LinkedPortal = {
                  id: portalId,
                  name: message.desktopDeviceName || desktopName || "Desktop",
                  relayUrl: relay,
                  pairedAt: Date.now(),
                  lastSeen: Date.now(),
                  isOnline: true,
                };

                set((state) => ({
                  status: "connected",
                  sessionToken: message.sessionToken,
                  deviceId: message.mobileDeviceId || null,
                  desktopDeviceName: message.desktopDeviceName || desktopName || null,
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
            }
          });

          await ws.connect();

          // Send pairing request
          ws.send({
            type: "register_mobile",
            id: Math.random().toString(36).substring(2, 15),
            deviceName: getDeviceName(),
            pairingPassphrase: passphrase,
          });

          set({ status: "pairing" });
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
        const ws = getWebSocket();
        ws.send({
          type: "select_project",
          id: Math.random().toString(36).substring(2, 15),
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
        const ws = getWebSocket();
        ws.sendTerminalInput(terminalId, data);
      },
    }),
    {
      name: "chell-connection",
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
