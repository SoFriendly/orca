import { generateId } from "./utils";
import type {
  WSMessage,
  CommandMessage,
  CommandResponseMessage,
  TerminalInputMessage,
  PairMessage,
} from "~/types";
import {
  deriveKey,
  encryptMessage,
  decryptMessage,
  shouldEncrypt,
  type EncryptionKey,
} from "./portalCrypto";

type MessageHandler = (message: WSMessage) => void;
type ConnectionHandler = () => void;

interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class OrcaWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private sessionToken: string | null = null;
  private encryptionKey: EncryptionKey | null = null;
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

  // Derive and store encryption key from passphrase and desktop ID
  async setEncryptionKey(passphrase: string, desktopId: string): Promise<void> {
    try {
      this.encryptionKey = await deriveKey(passphrase, desktopId);
      console.log("[OrcaWS] Encryption key derived successfully");
    } catch (err) {
      console.error("[OrcaWS] Failed to derive encryption key:", err);
      throw err;
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Append /ws path if not already present
        const wsUrl = this.url.endsWith('/ws') ? this.url : `${this.url}/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log("[OrcaWS] Connected to relay server");
          this.reconnectAttempts = 0;
          this.connectHandlers.forEach((handler) => handler());
          resolve();
        };

        this.ws.onmessage = async (event) => {
          try {
            let message: WSMessage = JSON.parse(event.data);
            console.log("[OrcaWS] Received message:", message.type, JSON.stringify(message).slice(0, 200));

            // Decrypt message if it has encrypted payload
            if ((message as any).encrypted && this.encryptionKey) {
              const { type, timestamp, encrypted } = message as any;
              try {
                const decrypted = await decryptMessage(
                  this.encryptionKey,
                  encrypted.iv,
                  encrypted.ciphertext,
                  type,
                  timestamp
                );
                // Merge decrypted payload back into message
                message = { ...message, ...decrypted } as WSMessage;
                delete (message as any).encrypted;
                console.log("[OrcaWS] Decrypted message type:", type);
              } catch (err) {
                console.error("[OrcaWS] Failed to decrypt message:", err);
                return;
              }
            }

            this.handleMessage(message);
          } catch (err) {
            console.error("[OrcaWS] Failed to parse message:", err);
          }
        };

        this.ws.onclose = () => {
          console.log("[OrcaWS] Disconnected from relay server");
          this.disconnectHandlers.forEach((handler) => handler());
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error("[OrcaWS] WebSocket error:", error);
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
      console.log("[OrcaWS] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[OrcaWS] Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[OrcaWS] Reconnect failed:", err);
      });
    }, delay);
  }

  private handleMessage(message: WSMessage): void {
    console.log("[OrcaWS] handleMessage called, type:", message.type, "handlers count:", this.messageHandlers.size);

    // Handle command responses
    if (message.type === "command_response") {
      const response = message as CommandResponseMessage;
      console.log("[OrcaWS] Received command_response, requestId:", response.requestId, "pending commands:", Array.from(this.pendingCommands.keys()));
      const pending = this.pendingCommands.get(response.requestId);
      if (pending) {
        console.log("[OrcaWS] Found pending command for requestId:", response.requestId);
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(response.requestId);

        if (response.success) {
          pending.resolve(response.result);
        } else {
          pending.reject(new Error(response.error || "Command failed"));
        }
      } else {
        console.warn("[OrcaWS] No pending command found for requestId:", response.requestId);
      }
    }

    // Notify all handlers
    this.messageHandlers.forEach((handler) => handler(message));
  }

  async sendAsync(message: Omit<WSMessage, "timestamp">): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[OrcaWS] send failed - WebSocket not connected, state:", this.ws?.readyState);
      throw new Error("WebSocket not connected");
    }

    const timestamp = Date.now();
    const type = message.type;

    // Check if this message type should be encrypted
    if (this.encryptionKey && shouldEncrypt(type)) {
      try {
        // Extract routing fields that stay plaintext
        const { type: msgType, id, sessionToken, ...payload } = message as any;

        const encrypted = await encryptMessage(
          this.encryptionKey,
          payload,
          type,
          timestamp
        );

        const fullMessage = {
          type: msgType,
          id,
          sessionToken,
          timestamp,
          encrypted,
        };

        console.log("[OrcaWS] Sending encrypted message type:", message.type);
        this.ws.send(JSON.stringify(fullMessage));
        return;
      } catch (err) {
        console.error("[OrcaWS] Failed to encrypt message:", err);
        // Fall through to send unencrypted as fallback
      }
    }

    // Send unencrypted (for registration/pairing messages or if encryption failed)
    const fullMessage = {
      ...message,
      timestamp,
    };

    console.log("[OrcaWS] Sending message type:", message.type);
    this.ws.send(JSON.stringify(fullMessage));
  }

  // Synchronous wrapper for compatibility (logs warning if encryption needed)
  send(message: Omit<WSMessage, "timestamp">): void {
    // For messages that need encryption, use sendAsync
    if (this.encryptionKey && shouldEncrypt(message.type)) {
      this.sendAsync(message).catch((err) => {
        console.error("[OrcaWS] Failed to send encrypted message:", err);
      });
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[OrcaWS] send failed - WebSocket not connected, state:", this.ws?.readyState);
      throw new Error("WebSocket not connected");
    }

    const fullMessage = {
      ...message,
      timestamp: Date.now(),
    };

    console.log("[OrcaWS] Sending message type:", message.type);
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
    console.log("[OrcaWS] invoke called:", command);
    if (!this.sessionToken) {
      console.error("[OrcaWS] No session token!");
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
        console.error("[OrcaWS] Command timeout:", command);
        this.pendingCommands.delete(id);
        reject(new Error("Command timeout"));
      }, 30000);

      this.pendingCommands.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      try {
        console.log("[OrcaWS] Sending command:", command, "id:", id);
        this.send(message);
      } catch (err) {
        console.error("[OrcaWS] Send failed:", err);
        clearTimeout(timeout);
        this.pendingCommands.delete(id);
        reject(err);
      }
    });
  }

  // Terminal input
  sendTerminalInput(terminalId: string, data: string): void {
    if (!this.sessionToken) {
      console.error("[OrcaWS] sendTerminalInput called but no sessionToken");
      throw new Error("Not authenticated");
    }

    console.log("[OrcaWS] sendTerminalInput:", terminalId, "data:", JSON.stringify(data));

    const message: Omit<TerminalInputMessage, "timestamp"> = {
      type: "terminal_input",
      id: generateId(),
      sessionToken: this.sessionToken,
      terminalId,
      data,
    };

    this.send(message);
    console.log("[OrcaWS] terminal_input message sent");
  }

  // Request status update from desktop
  requestStatus(): void {
    if (!this.sessionToken) {
      console.log("[OrcaWS] requestStatus called but no sessionToken");
      throw new Error("Not authenticated");
    }

    console.log("[OrcaWS] Sending request_status with sessionToken:", this.sessionToken.slice(0, 20) + "...");
    this.send({
      type: "request_status",
      id: generateId(),
      sessionToken: this.sessionToken,
    } as any);
    console.log("[OrcaWS] request_status message sent");
  }

  // Resume session after reconnecting with saved token
  resumeSession(deviceId: string): void {
    if (!this.sessionToken) {
      throw new Error("Not authenticated");
    }

    console.log("[OrcaWS] Sending resume_session with token:", this.sessionToken.slice(0, 20) + "...");
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
    console.log("[OrcaWS] Adding message handler, total:", this.messageHandlers.size + 1);
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
let wsInstance: OrcaWebSocket | null = null;

export function getWebSocket(url?: string): OrcaWebSocket {
  if (!wsInstance && url) {
    wsInstance = new OrcaWebSocket(url);
  }
  if (!wsInstance) {
    throw new Error("WebSocket not initialized - provide URL first");
  }
  return wsInstance;
}

export function initWebSocket(url: string): OrcaWebSocket {
  if (wsInstance) {
    wsInstance.disconnect();
  }
  wsInstance = new OrcaWebSocket(url);
  return wsInstance;
}
