// Project types
export interface ProjectFolder {
  id: string;
  name: string;
  path: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;           // Primary folder path (backward compat)
  folders?: ProjectFolder[]; // All folders (optional for backward compat)
  lastOpened: string;
}

// Project file format for .chell files
export interface ProjectFileData {
  version: number;
  name: string;
  folders: ProjectFolder[];
}

// Git types
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
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface Branch {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream?: string;
}

export interface Commit {
  id: string;
  shortId: string;
  message: string;
  author: string;
  authorEmail: string;
  timestamp: string;
  summary?: string; // AI-generated summary
}

export interface WorktreeInfo {
  name: string;
  path: string;
  branch?: string;
  headSha?: string;
  isMain: boolean;
  isLocked: boolean;
  lockReason?: string;
  isPrunable: boolean;
}

// Terminal types
export interface Terminal {
  id: string;
  title: string;
  cwd: string;
  type: "shell" | "assistant";
}

// AI types
export interface AISummary {
  summary: string;
  changes: string[];
}

export interface AIProvider {
  id: string;
  name: string;
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

// Snippet types
export interface Snippet {
  id: string;
  name: string;
  command: string;
  description?: string;
  projectId?: string; // null for global snippets
}

// Assistant types
export interface CodingAssistant {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  defaultArgs?: string;
  icon?: string;
}

export interface AssistantDefinition {
  id: string;
  name: string;
  command: string;
  description: string;
  installCommand: string;
  docsUrl: string;
  isBuiltIn: boolean;
}

export interface CustomAssistantConfig {
  id: string;
  name: string;
  command: string;
  description: string;
  installCommand: string;
  docsUrl: string;
}

// Tab types
export interface ProjectTab {
  id: string;
  projectId: string;
  projectName: string;
  terminalId?: string;
}

// Settings types
export type ThemeOption = 'dark' | 'tokyo' | 'light' | 'custom';

export interface CustomThemeColors {
  baseTheme: 'dark' | 'tokyo' | 'light';
  colors: {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    destructiveForeground: string;
    border: string;
    input: string;
    ring: string;
  };
}

export interface Settings {
  theme: ThemeOption;
  customTheme?: CustomThemeColors;
  aiProvider?: AIProvider;
  assistantArgs: Record<string, string>;
  globalSnippets: Snippet[];
  defaultClonePath?: string;
  autoCommitMessage: boolean;
  autoFetchRemote: boolean;
  groqApiKey?: string;
  preferredEditor?: string;
  showHiddenFiles: boolean;
  customAssistants: CustomAssistantConfig[];
  hiddenAssistantIds: string[];
  // Remote Portal settings
  portalEnabled?: boolean;
  portalRelayUrl?: string;
}

// Remote Portal types
export interface LinkedDevice {
  id: string;
  name: string;
  type: "mobile";
  pairedAt: number;
  lastSeen: number;
}

export interface PortalSession {
  deviceId: string;
  deviceName: string;
  pairingCode: string;
  pairingPassphrase: string;
  linkedDevices: LinkedDevice[];
  isConnected: boolean;
}

export interface Note {
  id: string;
  title: string;
  created: string;
  position: number;
  content: string;
}

// NLT (Natural Language Terminal) types
export interface NltResponse {
  command: string;
  explanation?: string;
}

export interface NltProgressEvent {
  request_id: string;
  status: "thinking" | "tool_call" | "done" | "error";
  message: string;
  tool_name?: string;
  iteration: number;
}
