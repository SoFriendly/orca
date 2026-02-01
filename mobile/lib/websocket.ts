import { generateId } from "./utils";
import type {
  WSMessage,
  CommandMessage,
  CommandResponseMessage,
  TerminalInputMessage,
  PairMessage,
} from "~/types";

type MessageHandler = (message: WSMessage) => void;
type ConnectionHandler = () => void;

interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ChellWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionToken: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<ConnectionHandler> = new Set();

  constructor(url: string) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Append /ws path if not already present
        const wsUrl = this.url.endsWith('/ws') ? this.url : `${this.url}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log("[ChellWS] Connected to relay server");
          this.reconnectAttempts = 0;
          this.connectHandlers.forEach((handler) => handler());
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WSMessage = JSON.parse(event.data);
            console.log("[ChellWS] Received message:", message.type, JSON.stringify(message).slice(0, 200));
            this.handleMessage(message);
          } catch (err) {
            console.error("[ChellWS] Failed to parse message:", err);
          }
        };

        this.ws.onclose = () => {
          console.log("[ChellWS] Disconnected from relay server");
          this.disconnectHandlers.forEach((handler) => handler());
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error("[ChellWS] WebSocket error:", error);
          reject(error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingCommands.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Connection closed"));
    });
    this.pendingCommands.clear();
  }

  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[ChellWS] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[ChellWS] Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[ChellWS] Reconnect failed:", err);
      });
    }, delay);
  }

  private handleMessage(message: WSMessage): void {
    console.log("[ChellWS] handleMessage called, handlers count:", this.messageHandlers.size);

    // Handle command responses
    if (message.type === "command_response") {
      const response = message as CommandResponseMessage;
      const pending = this.pendingCommands.get(response.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(response.requestId);

        if (response.success) {
          pending.resolve(response.result);
        } else {
          pending.reject(new Error(response.error || "Command failed"));
        }
      }
    }

    // Notify all handlers
    this.messageHandlers.forEach((handler) => handler(message));
  }

  private send(message: Omit<WSMessage, "timestamp">): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[ChellWS] send failed - WebSocket not connected, state:", this.ws?.readyState);
      throw new Error("WebSocket not connected");
    }

    const fullMessage = {
      ...message,
      timestamp: Date.now(),
    };

    console.log("[ChellWS] Sending message type:", message.type);
    this.ws.send(JSON.stringify(fullMessage));
  }

  // Pairing
  async pair(pairingCode: string, deviceName: string): Promise<void> {
    const message: Omit<PairMessage, "timestamp"> = {
      type: "pair",
      id: generateId(),
      pairingCode,
      deviceName,
    };

    this.send(message);
  }

  // Send commands to desktop app
  async invoke<T>(
    command: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    if (!this.sessionToken) {
      throw new Error("Not authenticated - please pair with desktop first");
    }

    const id = generateId();
    const message: Omit<CommandMessage, "timestamp"> = {
      type: "command",
      id,
      sessionToken: this.sessionToken,
      command,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error("Command timeout"));
      }, 30000);

      this.pendingCommands.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      try {
        this.send(message);
      } catch (err) {
        clearTimeout(timeout);
        this.pendingCommands.delete(id);
        reject(err);
      }
    });
  }

  // Terminal input
  sendTerminalInput(terminalId: string, data: string): void {
    if (!this.sessionToken) {
      console.error("[ChellWS] sendTerminalInput called but no sessionToken");
      throw new Error("Not authenticated");
    }

    console.log("[ChellWS] sendTerminalInput:", terminalId, "data:", JSON.stringify(data));

    const message: Omit<TerminalInputMessage, "timestamp"> = {
      type: "terminal_input",
      id: generateId(),
      sessionToken: this.sessionToken,
      terminalId,
      data,
    };

    this.send(message);
    console.log("[ChellWS] terminal_input message sent");
  }

  // Request status update from desktop
  requestStatus(): void {
    if (!this.sessionToken) {
      console.log("[ChellWS] requestStatus called but no sessionToken");
      throw new Error("Not authenticated");
    }

    console.log("[ChellWS] Sending request_status");
    this.send({
      type: "request_status",
      id: generateId(),
      sessionToken: this.sessionToken,
    } as any);
  }

  // Resume session after reconnecting with saved token
  resumeSession(deviceId: string): void {
    if (!this.sessionToken) {
      throw new Error("Not authenticated");
    }

    console.log("[ChellWS] Sending resume_session with token:", this.sessionToken.slice(0, 20) + "...");
    this.send({
      type: "resume_session",
      id: generateId(),
      sessionToken: this.sessionToken,
      deviceId,
      deviceName: "Mobile",
    } as any);
  }

  // Event handlers
  onMessage(handler: MessageHandler): () => void {
    console.log("[ChellWS] Adding message handler, total:", this.messageHandlers.size + 1);
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
let wsInstance: ChellWebSocket | null = null;

export function getWebSocket(url?: string): ChellWebSocket {
  if (!wsInstance && url) {
    wsInstance = new ChellWebSocket(url);
  }
  if (!wsInstance) {
    throw new Error("WebSocket not initialized - provide URL first");
  }
  return wsInstance;
}

export function initWebSocket(url: string): ChellWebSocket {
  if (wsInstance) {
    wsInstance.disconnect();
  }
  wsInstance = new ChellWebSocket(url);
  return wsInstance;
}
