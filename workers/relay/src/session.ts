// Durable Object for session management
import type {
  SessionData,
  LinkedDevice,
  WSMessage,
  CommandMessage,
  CommandResponseMessage,
  TerminalInputMessage,
  TerminalOutputMessage,
  StatusUpdateMessage,
} from "./types";
import { generateSessionToken, generateDeviceId, generateMessageId } from "./crypto";

interface WebSocketState {
  type: "desktop" | "mobile";
  deviceId: string;
  deviceName: string;
  sessionToken?: string;
}

export class SessionDO implements DurableObject {
  private state: DurableObjectState;
  private sessions: Map<string, SessionData> = new Map();
  private connections: Map<WebSocket, WebSocketState> = new Map();
  private desktopByPassphrase: Map<string, WebSocket> = new Map();
  private mobilesBySession: Map<string, Set<WebSocket>> = new Map();
  private desktopBySession: Map<string, WebSocket> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Map<string, SessionData>>("sessions");
      if (stored) {
        this.sessions = stored;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.handleWebSocket(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocket(ws: WebSocket) {
    ws.accept();

    ws.addEventListener("message", async (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data as string);
        await this.handleMessage(ws, message);
      } catch (err) {
        console.error("Failed to handle message:", err);
        this.sendError(ws, "INVALID_MESSAGE", "Failed to parse message");
      }
    });

    ws.addEventListener("close", () => {
      this.handleDisconnect(ws);
    });

    ws.addEventListener("error", (err) => {
      console.error("WebSocket error:", err);
      this.handleDisconnect(ws);
    });
  }

  private async handleMessage(ws: WebSocket, message: WSMessage) {
    switch (message.type) {
      case "register_desktop":
        await this.handleDesktopRegister(ws, message);
        break;

      case "register_mobile":
        await this.handleMobileRegister(ws, message);
        break;

      case "unpair":
        await this.handleUnpair(ws, message);
        break;

      case "command":
        await this.handleCommand(ws, message);
        break;

      case "command_response":
        await this.handleCommandResponse(ws, message);
        break;

      case "terminal_input":
        await this.handleTerminalInput(ws, message);
        break;

      case "terminal_output":
        await this.handleTerminalOutput(ws, message);
        break;

      case "status_update":
        await this.handleStatusUpdate(ws, message);
        break;

      case "request_status":
        await this.handleRequestStatus(ws, message);
        break;

      case "resume_session":
        await this.handleResumeSession(ws, message);
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong", id: message.id, timestamp: Date.now() }));
        break;

      default:
        this.sendError(ws, "UNKNOWN_MESSAGE", `Unknown message type: ${message.type}`);
    }
  }

  private async handleDesktopRegister(ws: WebSocket, message: any) {
    const { deviceName, pairingCode, pairingPassphrase } = message;

    // Generate or use existing device ID
    let state = this.connections.get(ws);
    const deviceId = state?.deviceId || generateDeviceId();

    // Create session data
    const sessionData: SessionData = {
      desktopDeviceId: deviceId,
      desktopDeviceName: deviceName,
      pairingCode,
      pairingPassphrase,
      linkedMobiles: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    // Store session
    this.sessions.set(deviceId, sessionData);
    await this.state.storage.put("sessions", this.sessions);

    // Track connection
    this.connections.set(ws, {
      type: "desktop",
      deviceId,
      deviceName,
    });

    // Map passphrase to desktop
    this.desktopByPassphrase.set(pairingPassphrase, ws);

    // Restore session mappings for existing linked mobiles
    // This allows request_status to work after desktop reconnects
    for (const mobile of sessionData.linkedMobiles) {
      if (mobile.sessionToken) {
        this.desktopBySession.set(mobile.sessionToken, ws);
      }
    }

    // Send confirmation
    ws.send(
      JSON.stringify({
        type: "register_desktop_response",
        id: generateMessageId(),
        timestamp: Date.now(),
        success: true,
        deviceId,
      })
    );

    // Send current linked devices
    this.sendDeviceList(ws, sessionData);
  }

  private async handleMobileRegister(ws: WebSocket, message: any) {
    const { deviceName, pairingPassphrase } = message;

    // Find desktop by passphrase
    const desktopWs = this.desktopByPassphrase.get(pairingPassphrase);
    if (!desktopWs) {
      this.sendError(ws, "INVALID_PASSPHRASE", "Invalid pairing passphrase");
      return;
    }

    const desktopState = this.connections.get(desktopWs);
    if (!desktopState) {
      this.sendError(ws, "DESKTOP_NOT_FOUND", "Desktop not connected");
      return;
    }

    const session = this.sessions.get(desktopState.deviceId);
    if (!session) {
      this.sendError(ws, "SESSION_NOT_FOUND", "Session not found");
      return;
    }

    // Generate mobile device ID and session token
    const mobileDeviceId = generateDeviceId();
    const sessionToken = await generateSessionToken(
      desktopState.deviceId,
      mobileDeviceId,
      pairingPassphrase
    );

    // Add mobile to linked devices
    const linkedDevice: LinkedDevice = {
      id: mobileDeviceId,
      name: deviceName,
      type: "mobile",
      pairedAt: Date.now(),
      lastSeen: Date.now(),
      sessionToken,
    };
    session.linkedMobiles.push(linkedDevice);
    session.lastActivity = Date.now();

    // Save session
    this.sessions.set(desktopState.deviceId, session);
    await this.state.storage.put("sessions", this.sessions);

    // Track mobile connection
    this.connections.set(ws, {
      type: "mobile",
      deviceId: mobileDeviceId,
      deviceName,
      sessionToken,
    });

    // Track by session token
    if (!this.mobilesBySession.has(sessionToken)) {
      this.mobilesBySession.set(sessionToken, new Set());
    }
    this.mobilesBySession.get(sessionToken)!.add(ws);
    this.desktopBySession.set(sessionToken, desktopWs);

    // Send success to mobile
    ws.send(
      JSON.stringify({
        type: "pair_response",
        id: generateMessageId(),
        timestamp: Date.now(),
        success: true,
        sessionToken,
        desktopDeviceId: desktopState.deviceId,
        desktopDeviceName: desktopState.deviceName,
        mobileDeviceId,
      })
    );

    // Notify desktop of new device
    this.sendDeviceList(desktopWs, session);

    // Request status update from desktop
    desktopWs.send(
      JSON.stringify({
        type: "request_status",
        id: generateMessageId(),
        timestamp: Date.now(),
        sessionToken,
      })
    );
  }

  private async handleUnpair(ws: WebSocket, message: any) {
    const { sessionToken, deviceId } = message;

    const state = this.connections.get(ws);
    if (!state) return;

    // Find session
    for (const [desktopId, session] of this.sessions) {
      const deviceIndex = session.linkedMobiles.findIndex((d) => d.id === deviceId);
      if (deviceIndex !== -1) {
        session.linkedMobiles.splice(deviceIndex, 1);
        this.sessions.set(desktopId, session);
        await this.state.storage.put("sessions", this.sessions);

        // Notify desktop
        const desktopWs = this.desktopBySession.get(sessionToken);
        if (desktopWs) {
          this.sendDeviceList(desktopWs, session);
        }

        // Clean up mobile connections
        const mobiles = this.mobilesBySession.get(sessionToken);
        if (mobiles) {
          for (const mobileWs of mobiles) {
            const mobileState = this.connections.get(mobileWs);
            if (mobileState?.deviceId === deviceId) {
              mobiles.delete(mobileWs);
              this.connections.delete(mobileWs);
              mobileWs.close(1000, "Unpaired");
            }
          }
        }

        break;
      }
    }
  }

  private async handleCommand(ws: WebSocket, message: CommandMessage) {
    const { sessionToken, command, params, id } = message;

    // Find desktop for this session
    const desktopWs = this.desktopBySession.get(sessionToken);
    if (!desktopWs) {
      this.sendError(ws, "DESKTOP_OFFLINE", "Desktop is not connected");
      return;
    }

    // Forward command to desktop
    desktopWs.send(
      JSON.stringify({
        type: "command",
        id,
        timestamp: Date.now(),
        command,
        params,
        requesterId: this.connections.get(ws)?.deviceId,
      })
    );
  }

  private async handleCommandResponse(ws: WebSocket, message: CommandResponseMessage) {
    const { requestId, success, result, error } = message;

    // Forward to all mobile clients for this session
    const state = this.connections.get(ws);
    if (!state || state.type !== "desktop") return;

    // Find session token for this desktop
    for (const [token, desktop] of this.desktopBySession) {
      if (desktop === ws) {
        const mobiles = this.mobilesBySession.get(token);
        if (mobiles) {
          const response: CommandResponseMessage = {
            type: "command_response",
            id: generateMessageId(),
            timestamp: Date.now(),
            requestId,
            success,
            result,
            error,
          };
          for (const mobileWs of mobiles) {
            mobileWs.send(JSON.stringify(response));
          }
        }
        break;
      }
    }
  }

  private async handleTerminalInput(ws: WebSocket, message: TerminalInputMessage) {
    const { sessionToken, terminalId, data } = message;

    const desktopWs = this.desktopBySession.get(sessionToken);
    if (!desktopWs) {
      this.sendError(ws, "DESKTOP_OFFLINE", "Desktop is not connected");
      return;
    }

    desktopWs.send(
      JSON.stringify({
        type: "terminal_input",
        id: generateMessageId(),
        timestamp: Date.now(),
        terminalId,
        data,
      })
    );
  }

  private async handleTerminalOutput(ws: WebSocket, message: TerminalOutputMessage) {
    const { terminalId, data } = message;

    const state = this.connections.get(ws);
    if (!state || state.type !== "desktop") return;

    // Forward to all mobile clients
    for (const [token, desktop] of this.desktopBySession) {
      if (desktop === ws) {
        const mobiles = this.mobilesBySession.get(token);
        if (mobiles) {
          const output: TerminalOutputMessage = {
            type: "terminal_output",
            id: generateMessageId(),
            timestamp: Date.now(),
            terminalId,
            data,
          };
          for (const mobileWs of mobiles) {
            mobileWs.send(JSON.stringify(output));
          }
        }
        break;
      }
    }
  }

  private async handleStatusUpdate(ws: WebSocket, message: StatusUpdateMessage) {
    const state = this.connections.get(ws);
    if (!state || state.type !== "desktop") return;

    // Forward to all mobile clients
    for (const [token, desktop] of this.desktopBySession) {
      if (desktop === ws) {
        const mobiles = this.mobilesBySession.get(token);
        if (mobiles) {
          for (const mobileWs of mobiles) {
            mobileWs.send(JSON.stringify(message));
          }
        }
        break;
      }
    }
  }

  private async handleRequestStatus(ws: WebSocket, message: any) {
    const { sessionToken } = message;

    // Find desktop for this session
    const desktopWs = this.desktopBySession.get(sessionToken);
    if (!desktopWs) {
      this.sendError(ws, "DESKTOP_OFFLINE", "Desktop is not connected");
      return;
    }

    // Forward request to desktop
    desktopWs.send(
      JSON.stringify({
        type: "request_status",
        id: message.id,
        timestamp: Date.now(),
        sessionToken,
      })
    );
  }

  private async handleResumeSession(ws: WebSocket, message: any) {
    const { sessionToken, deviceId, deviceName } = message;

    if (!sessionToken) {
      this.sendError(ws, "INVALID_SESSION", "Session token required");
      return;
    }

    // Track mobile connection
    this.connections.set(ws, {
      type: "mobile",
      deviceId: deviceId || "unknown",
      deviceName: deviceName || "Mobile",
      sessionToken,
    });

    // Add to mobilesBySession so it can receive messages
    if (!this.mobilesBySession.has(sessionToken)) {
      this.mobilesBySession.set(sessionToken, new Set());
    }
    this.mobilesBySession.get(sessionToken)!.add(ws);

    // Send confirmation
    ws.send(
      JSON.stringify({
        type: "session_resumed",
        id: message.id,
        timestamp: Date.now(),
        success: true,
      })
    );

    // If desktop is connected, request status update
    const desktopWs = this.desktopBySession.get(sessionToken);
    if (desktopWs) {
      desktopWs.send(
        JSON.stringify({
          type: "request_status",
          id: generateMessageId(),
          timestamp: Date.now(),
          sessionToken,
        })
      );
    }
  }

  private handleDisconnect(ws: WebSocket) {
    const state = this.connections.get(ws);
    if (!state) return;

    if (state.type === "desktop") {
      // Clean up passphrase mapping
      for (const [passphrase, desktopWs] of this.desktopByPassphrase) {
        if (desktopWs === ws) {
          this.desktopByPassphrase.delete(passphrase);
          break;
        }
      }

      // Notify mobiles that desktop went offline
      for (const [token, desktop] of this.desktopBySession) {
        if (desktop === ws) {
          const mobiles = this.mobilesBySession.get(token);
          if (mobiles) {
            for (const mobileWs of mobiles) {
              mobileWs.send(
                JSON.stringify({
                  type: "status_update",
                  id: generateMessageId(),
                  timestamp: Date.now(),
                  connectionStatus: "disconnected",
                })
              );
            }
          }
          this.desktopBySession.delete(token);
          break;
        }
      }
    } else {
      // Mobile disconnected
      if (state.sessionToken) {
        const mobiles = this.mobilesBySession.get(state.sessionToken);
        if (mobiles) {
          mobiles.delete(ws);
        }
      }
    }

    this.connections.delete(ws);
  }

  private sendDeviceList(ws: WebSocket, session: SessionData) {
    ws.send(
      JSON.stringify({
        type: "device_list",
        id: generateMessageId(),
        timestamp: Date.now(),
        devices: session.linkedMobiles,
      })
    );
  }

  private sendError(ws: WebSocket, code: string, message: string) {
    ws.send(
      JSON.stringify({
        type: "error",
        id: generateMessageId(),
        timestamp: Date.now(),
        code,
        message,
      })
    );
  }
}
