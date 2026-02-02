// Shared types between mobile and desktop
export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface Commit {
  id: string;
  shortId: string;
  message: string;
  author: string;
  timestamp: number;
}

export interface Branch {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream?: string;
}

export interface Terminal {
  id: string;
  title: string;
  cwd: string;
  type: "shell" | "assistant";
}

export interface ProjectContext {
  projectType: string;
  packageManager: string;
  scripts: string[];
  hasDocker: boolean;
  hasMakefile: boolean;
}

// WebSocket message types
export type MessageType =
  | "connect"
  | "disconnect"
  | "pair"
  | "pair_response"
  | "command"
  | "command_response"
  | "terminal_output"
  | "terminal_input"
  | "status_update"
  | "error"
  | "select_project"
  | "project_changed"
  | "git_files_changed"
  | "register_mobile"
  | "attach_terminal"
  | "detach_terminal"
  | "request_status"
  | "resume_session";

export interface BaseMessage {
  type: MessageType;
  id: string;
  timestamp: number;
}

export interface PairMessage extends BaseMessage {
  type: "pair";
  pairingCode: string;
  deviceName: string;
}

export interface PairResponseMessage extends BaseMessage {
  type: "pair_response";
  success: boolean;
  sessionToken?: string;
  deviceId?: string;
  mobileDeviceId?: string;
  desktopDeviceId?: string;
  desktopDeviceName?: string;
  error?: string;
}

export interface CommandMessage extends BaseMessage {
  type: "command";
  sessionToken: string;
  command: string;
  params: Record<string, unknown>;
}

export interface CommandResponseMessage extends BaseMessage {
  type: "command_response";
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface TerminalOutputMessage extends BaseMessage {
  type: "terminal_output";
  terminalId: string;
  data: string;
}

export interface TerminalInputMessage extends BaseMessage {
  type: "terminal_input";
  sessionToken: string;
  terminalId: string;
  data: string;
}

export interface RemoteTerminal {
  id: string;
  title: string;
  cwd: string;
  type: "shell" | "assistant";
}

export interface StatusUpdateMessage extends BaseMessage {
  type: "status_update";
  connectionStatus: "connected" | "disconnected";
  activeProject?: Project;
  gitStatus?: GitStatus;
  projects?: Array<{
    id: string;
    name: string;
    path: string;
  }>;
  activeProjectId?: string;
  theme?: string;
  customTheme?: Record<string, string>;
  terminals?: RemoteTerminal[];
}

export interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  message: string;
}

export interface SelectProjectMessage extends BaseMessage {
  type: "select_project";
  projectId: string;
}

export interface ProjectChangedMessage extends BaseMessage {
  type: "project_changed";
  projectId: string;
}

export interface GitFilesChangedMessage extends BaseMessage {
  type: "git_files_changed";
  files: string[];
}

export interface RegisterMobileMessage extends BaseMessage {
  type: "register_mobile";
  sessionToken: string;
  deviceId: string;
  deviceName: string;
}

export interface AttachTerminalMessage extends BaseMessage {
  type: "attach_terminal";
  sessionToken: string;
  terminalId: string;
}

export interface DetachTerminalMessage extends BaseMessage {
  type: "detach_terminal";
  sessionToken: string;
  terminalId: string;
}

export type WSMessage =
  | PairMessage
  | PairResponseMessage
  | CommandMessage
  | CommandResponseMessage
  | TerminalOutputMessage
  | TerminalInputMessage
  | StatusUpdateMessage
  | ErrorMessage
  | SelectProjectMessage
  | ProjectChangedMessage
  | GitFilesChangedMessage
  | RegisterMobileMessage
  | AttachTerminalMessage
  | DetachTerminalMessage;

// Connection state
export interface ConnectionState {
  status: "disconnected" | "connecting" | "pairing" | "connected";
  sessionToken: string | null;
  deviceId: string | null;
  desktopDeviceName: string | null;
  lastConnected: number | null;
  error: string | null;
}

// Remote command interface
export interface RemoteCommand {
  name: string;
  params: Record<string, unknown>;
}

export type CommandHandler = (
  command: string,
  params: Record<string, unknown>
) => Promise<unknown>;
