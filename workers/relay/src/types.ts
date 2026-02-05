// Message types for WebSocket communication
export type MessageType =
  | "register_desktop"
  | "register_mobile"
  | "pair_request"
  | "pair_response"
  | "unpair"
  | "command"
  | "command_response"
  | "terminal_output"
  | "terminal_input"
  | "status_update"
  | "device_list"
  | "portal_list"
  | "mobile_connection_update"
  | "error"
  | "ping"
  | "pong";

// E2E encryption payload (present on encrypted messages, relay passes through)
export interface EncryptedPayload {
  iv: string;        // Base64 encoded 12-byte IV
  ciphertext: string; // Base64 encoded encrypted payload + auth tag
}

export interface BaseMessage {
  type: MessageType;
  id: string;
  timestamp: number;
  // Optional E2E encrypted payload (relay passes through without decryption)
  encrypted?: EncryptedPayload;
}

// Desktop registration
export interface RegisterDesktopMessage extends BaseMessage {
  type: "register_desktop";
  deviceName: string;
  pairingCode: string; // 6-digit code for QR
  pairingPassphrase: string; // Full passphrase encoded in QR
}

// Mobile registration
export interface RegisterMobileMessage extends BaseMessage {
  type: "register_mobile";
  deviceName: string;
  pairingPassphrase: string; // Scanned from QR code
}

// Pairing response from desktop
export interface PairResponseMessage extends BaseMessage {
  type: "pair_response";
  success: boolean;
  sessionToken?: string;
  desktopDeviceId?: string;
  desktopDeviceName?: string;
  mobileDeviceId?: string;
  error?: string;
}

// Unpair device
export interface UnpairMessage extends BaseMessage {
  type: "unpair";
  sessionToken: string;
  deviceId: string;
}

// Command from mobile to desktop
export interface CommandMessage extends BaseMessage {
  type: "command";
  sessionToken: string;
  command: string;
  params: Record<string, unknown>;
}

// Command response from desktop
export interface CommandResponseMessage extends BaseMessage {
  type: "command_response";
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// Terminal output from desktop
export interface TerminalOutputMessage extends BaseMessage {
  type: "terminal_output";
  terminalId: string;
  data: string;
}

// Terminal input from mobile
export interface TerminalInputMessage extends BaseMessage {
  type: "terminal_input";
  sessionToken: string;
  terminalId: string;
  data: string;
}

// Project folder info for multi-folder workspaces
export interface ProjectFolder {
  id: string;
  name: string;
  path: string;
}

// Status update from desktop
export interface StatusUpdateMessage extends BaseMessage {
  type: "status_update";
  connectionStatus: "connected" | "disconnected";
  activeProject?: {
    id: string;
    name: string;
    path: string;
    folders?: ProjectFolder[];
  };
  gitStatus?: {
    branch: string;
    ahead: number;
    behind: number;
    staged: string[];
    unstaged: string[];
    untracked: string[];
  };
  projects?: Array<{
    id: string;
    name: string;
    path: string;
    folders?: ProjectFolder[];
  }>;
  activeProjectId?: string;
  theme?: string;
  customTheme?: Record<string, string>;
}

// Device list for desktop
export interface DeviceListMessage extends BaseMessage {
  type: "device_list";
  devices: LinkedDevice[];
}

// Mobile connection update for desktop
export interface MobileConnectionUpdateMessage extends BaseMessage {
  type: "mobile_connection_update";
  activeMobiles: number;
}

// Portal list for mobile
export interface PortalListMessage extends BaseMessage {
  type: "portal_list";
  portals: LinkedPortal[];
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  message: string;
}

export type WSMessage =
  | RegisterDesktopMessage
  | RegisterMobileMessage
  | PairResponseMessage
  | UnpairMessage
  | CommandMessage
  | CommandResponseMessage
  | TerminalOutputMessage
  | TerminalInputMessage
  | StatusUpdateMessage
  | DeviceListMessage
  | MobileConnectionUpdateMessage
  | PortalListMessage
  | ErrorMessage;

// Stored device information
export interface LinkedDevice {
  id: string;
  name: string;
  type: "mobile";
  pairedAt: number;
  lastSeen: number;
  sessionToken: string; // Token used for routing messages
}

export interface LinkedPortal {
  id: string;
  name: string;
  type: "desktop";
  pairedAt: number;
  lastSeen: number;
  isOnline: boolean;
}

// Session data stored in Durable Object
export interface SessionData {
  desktopDeviceId: string;
  desktopDeviceName: string;
  pairingCode: string;
  pairingPassphrase: string;
  linkedMobiles: LinkedDevice[];
  createdAt: number;
  lastActivity: number;
}

// Mobile session data
export interface MobileSessionData {
  mobileDeviceId: string;
  mobileDeviceName: string;
  linkedPortals: LinkedPortal[];
  createdAt: number;
  lastActivity: number;
}
