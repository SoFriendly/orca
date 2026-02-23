import { useEffect, useLayoutEffect, useState, useRef, useCallback, type WheelEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Settings,
  Terminal as TerminalIcon,
  X,
  Trash2,
  Plus,
  Bot,
  GitBranch,
  Folder,
  FolderOpen,
  ChevronDown,
  Check,
  Loader2,
  Search,
  Sparkles,
  FileText,
  Pencil,
  Save,
  Eye,
  LetterText,
  ExternalLink,
  HelpCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import Terminal from "@/components/Terminal";
import SmartShell from "@/components/SmartShell";
import GitPanel from "@/components/GitPanel";
import DiffPanel from "@/components/DiffPanel";
import NotesPanel from "@/components/NotesPanel";
import SettingsSheet from "@/components/SettingsSheet";
import Onboarding from "@/components/Onboarding";
import { useProjectStore, ensureFolders } from "@/stores/projectStore";
import { useGitStore } from "@/stores/gitStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import { hslToHex, THEME_DEFAULTS } from "@/lib/colorUtils";
import { getAllAssistants, getAllAssistantCommands } from "@/lib/assistants";
import type { Project, GitStatus, FileDiff, Branch, Commit, WorktreeInfo, CustomThemeColors, ProjectFolder, ProjectFileData, DiffPanelSelection } from "@/types";

// Types for global file search
interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  modified?: number;
}

interface FileNameMatch {
  name: string;
  path: string;
  isDir: boolean;
  basePath: string;
  modified?: number;
}

interface ContentMatch {
  path: string;
  lineNumber: number;
  line: string;
  absolutePath: string;
}

interface ContentSearchResult {
  matches: ContentMatch[];
  truncated: boolean;
}

// Map file extensions to Monaco language IDs
const getMonacoLanguage = (filePath: string): string => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const filename = filePath.split('/').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    // Web
    html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss', less: 'less',
    // Data/Config
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini', xml: 'xml', csv: 'plaintext',
    // Shell
    sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell',
    // Languages
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    scala: 'scala', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    swift: 'swift', m: 'objective-c', mm: 'objective-c',
    php: 'php', pl: 'perl', r: 'r', lua: 'lua', zig: 'zig', v: 'v',
    // Database/Query
    sql: 'sql', graphql: 'graphql', gql: 'graphql', prisma: 'prisma',
    // Markup
    md: 'markdown', markdown: 'markdown', mdx: 'markdown',
    // Other
    dockerfile: 'dockerfile', makefile: 'makefile',
    env: 'ini', gitignore: 'ini', dockerignore: 'ini', editorconfig: 'ini',
  };

  // Check for special filenames first
  if (filename === 'dockerfile') return 'dockerfile';
  if (filename === 'makefile') return 'makefile';
  if (filename.startsWith('.env')) return 'ini';

  return languageMap[ext] || 'plaintext';
};

// Compute Monaco background colors from CSS variables
const MONACO_BACKGROUNDS = {
  dark: hslToHex(THEME_DEFAULTS.dark.card),
  tokyo: hslToHex(THEME_DEFAULTS.tokyo.card),
  light: hslToHex(THEME_DEFAULTS.light.card),
};

// Define custom Monaco themes matching app themes
const defineMonacoThemes = (
  monaco: Parameters<NonNullable<Parameters<typeof Editor>[0]['beforeMount']>>[0],
  customTheme?: CustomThemeColors
) => {
  // Dark theme (matches app dark theme)
  monaco.editor.defineTheme('orca-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff79c6' },
      { token: 'string', foreground: 'f1fa8c' },
      { token: 'number', foreground: 'bd93f9' },
      { token: 'type', foreground: '8be9fd' },
      { token: 'function', foreground: '50fa7b' },
      { token: 'variable', foreground: 'f8f8f2' },
      { token: 'constant', foreground: 'bd93f9' },
      { token: 'operator', foreground: 'ff79c6' },
    ],
    colors: {
      'editor.background': MONACO_BACKGROUNDS.dark,
      'editor.foreground': '#e0e0e0',
      'editor.lineHighlightBackground': '#1f1f1f',
      'editor.selectionBackground': '#FF6B0040',
      'editorCursor.foreground': '#FF6B00',
      'editorLineNumber.foreground': '#6272a4',
      'editorLineNumber.activeForeground': '#f8f8f2',
      'editor.findMatchBackground': '#FF6B0060',
      'editor.findMatchHighlightBackground': '#FF6B0030',
    },
  });

  // Tokyo Night theme
  monaco.editor.defineTheme('orca-indigo', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'bb9af7' },
      { token: 'string', foreground: '9ece6a' },
      { token: 'number', foreground: 'ff9e64' },
      { token: 'type', foreground: '7dcfff' },
      { token: 'function', foreground: '7aa2f7' },
      { token: 'variable', foreground: 'c0caf5' },
      { token: 'constant', foreground: 'ff9e64' },
      { token: 'operator', foreground: '89ddff' },
    ],
    colors: {
      'editor.background': MONACO_BACKGROUNDS.tokyo,
      'editor.foreground': '#c0caf5',
      'editor.lineHighlightBackground': '#282a3a',
      'editor.selectionBackground': '#7aa2f740',
      'editorCursor.foreground': '#7aa2f7',
      'editorLineNumber.foreground': '#414868',
      'editorLineNumber.activeForeground': '#c0caf5',
      'editor.findMatchBackground': '#7aa2f760',
      'editor.findMatchHighlightBackground': '#7aa2f730',
    },
  });

  // Light theme
  monaco.editor.defineTheme('orca-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'a0a1a7', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a626a4' },
      { token: 'string', foreground: '50a14f' },
      { token: 'number', foreground: 'c18401' },
      { token: 'type', foreground: '0184bc' },
      { token: 'function', foreground: '4078f2' },
      { token: 'variable', foreground: '383a42' },
      { token: 'constant', foreground: 'c18401' },
      { token: 'operator', foreground: 'a626a4' },
    ],
    colors: {
      'editor.background': MONACO_BACKGROUNDS.light,
      'editor.foreground': '#383a42',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editor.selectionBackground': '#526eff30',
      'editorCursor.foreground': '#526eff',
      'editorLineNumber.foreground': '#a0a1a7',
      'editorLineNumber.activeForeground': '#383a42',
      'editor.findMatchBackground': '#526eff40',
      'editor.findMatchHighlightBackground': '#526eff20',
    },
  });

  // Custom theme (uses user-defined colors)
  if (customTheme) {
    const { colors, baseTheme } = customTheme;
    // Derive a slightly lighter/darker shade for line highlight
    const lineHighlightBg = baseTheme === 'light'
      ? colors.muted
      : colors.secondary;

    monaco.editor.defineTheme('orca-custom', {
      base: baseTheme === 'light' ? 'vs' : 'vs-dark',
      inherit: true,
      rules: baseTheme === 'light' ? [
        { token: 'comment', foreground: colors.mutedForeground.replace('#', ''), fontStyle: 'italic' },
        { token: 'keyword', foreground: 'a626a4' },
        { token: 'string', foreground: '50a14f' },
        { token: 'number', foreground: 'c18401' },
        { token: 'type', foreground: '0184bc' },
        { token: 'function', foreground: colors.primary.replace('#', '') },
        { token: 'variable', foreground: colors.foreground.replace('#', '') },
        { token: 'constant', foreground: 'c18401' },
        { token: 'operator', foreground: 'a626a4' },
      ] : [
        { token: 'comment', foreground: colors.mutedForeground.replace('#', ''), fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff79c6' },
        { token: 'string', foreground: 'f1fa8c' },
        { token: 'number', foreground: 'bd93f9' },
        { token: 'type', foreground: '8be9fd' },
        { token: 'function', foreground: colors.primary.replace('#', '') },
        { token: 'variable', foreground: colors.foreground.replace('#', '') },
        { token: 'constant', foreground: 'bd93f9' },
        { token: 'operator', foreground: 'ff79c6' },
      ],
      colors: {
        'editor.background': colors.background,
        'editor.foreground': colors.foreground,
        'editor.lineHighlightBackground': lineHighlightBg,
        'editor.selectionBackground': colors.primary + '40',
        'editorCursor.foreground': colors.primary,
        'editorLineNumber.foreground': colors.mutedForeground,
        'editorLineNumber.activeForeground': colors.foreground,
        'editor.findMatchBackground': colors.primary + '60',
        'editor.findMatchHighlightBackground': colors.primary + '30',
      },
    });
  }

  // Disable TypeScript/JavaScript diagnostics since we don't have access to node_modules
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });
};

// Map app theme to Monaco theme name
const getMonacoTheme = (appTheme: string): string => {
  switch (appTheme) {
    case 'tokyo': return 'orca-indigo';
    case 'light': return 'orca-light';
    case 'custom': return 'orca-custom';
    default: return 'orca-dark';
  }
};

interface TerminalTab {
  id: string;
  name: string;
  command: string;  // Command to run (empty for shell)
  terminalId: string | null;  // Set by Terminal component after spawning
  cwd?: string;  // Working directory for this terminal - empty means needs selection (Issue #6)
  isAssistant?: boolean;  // Whether this tab runs an assistant (affects how the command is spawned)
}

interface AssistantOption {
  id: string;
  name: string;
  command: string;
  icon: React.ReactNode;
  installed: boolean;
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects, openTab, addFolderToProject, removeFolderFromProject, updateProject, addProject } = useProjectStore();
  const { branches, worktrees, setStatus, setDiffs, setBranches, setHistory, setWorktrees, setLoading } = useGitStore();
  const { assistantArgs, defaultAssistant, autoFetchRemote, theme, customTheme, customAssistants, hiddenAssistantIds, hasSeenOnboarding, setHasSeenOnboarding } = useSettingsStore();

  // Terminal background colors per theme (computed from --card CSS variable)
  const terminalBg =
    theme === "custom" && customTheme
      ? customTheme.colors.card
      : hslToHex(THEME_DEFAULTS[theme as keyof typeof THEME_DEFAULTS]?.card || THEME_DEFAULTS.dark.card);

  // App background colors per theme (computed from CSS --background values)
  const appBgColor =
    theme === "custom" && customTheme
      ? customTheme.colors.background
      : hslToHex(THEME_DEFAULTS[theme as keyof typeof THEME_DEFAULTS]?.background || THEME_DEFAULTS.dark.background);

  // Set webview background color to match app surface (prevents edge tint mismatch)
  useEffect(() => {
    getCurrentWebview().setBackgroundColor(appBgColor).catch(() => {});
  }, [appBgColor]);

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // On Windows, default shell to closed state to avoid ConPTY timing issues on initial load
  const isWindows = navigator.platform.toUpperCase().indexOf("WIN") >= 0;
  const [utilityTerminalId, setUtilityTerminalId] = useState<string | null>(isWindows ? "closed" : null);
  const [activeSidebarItem, setActiveSidebarItem] = useState<"terminal" | "settings">("terminal");
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState("");
  const [installedAssistants, setInstalledAssistants] = useState<string[]>([]);
  const [showGitPanel, setShowGitPanel] = useState(true);
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [showAssistantPanel, setShowAssistantPanel] = useState(true);
  const [showShellPanel, setShowShellPanel] = useState(true);
  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [showMarkdownPanel, setShowMarkdownPanel] = useState(false);
  const [markdownFile, setMarkdownFile] = useState<{ path: string; content: string; lineNumber?: number } | null>(null);
  const [markdownEditMode, setMarkdownEditMode] = useState(false);
  const [shellCwd, setShellCwd] = useState<string>("");
  const [shellDirs, setShellDirs] = useState<string[]>([]);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  // Global file search state
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [fileNameMatches, setFileNameMatches] = useState<FileNameMatch[]>([]);
  const [contentSearchResults, setContentSearchResults] = useState<ContentMatch[]>([]);
  const [isSearchingContent, setIsSearchingContent] = useState(false);
  const [contentSearchTruncated, setContentSearchTruncated] = useState(false);
  const fileSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNlt, setShowNlt] = useState(false);
  // Track selected folders for tabs pending folder selection (Issue #6)
  const [pendingTabFolders, setPendingTabFolders] = useState<Record<string, string>>({});
  const [pendingShellFolder, setPendingShellFolder] = useState<string>("");
  const [pendingEmptyStateFolder, setPendingEmptyStateFolder] = useState<string>("");
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const sidebarNavRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Kill all terminal sessions when the window is closed
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(() => {
      const ids: string[] = [];
      terminalTabs.forEach(tab => {
        if (tab.terminalId) ids.push(tab.terminalId);
      });
      if (utilityTerminalId && utilityTerminalId !== "closed") {
        ids.push(utilityTerminalId);
      }
      if (ids.length > 0) {
        invoke("kill_terminals", { ids }).catch(() => {});
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, [terminalTabs, utilityTerminalId]);

  // Preload file list when search dialog opens
  useEffect(() => {
    if (showFileSearch && fileTree.length > 0 && !fileSearchQuery.trim()) {
      setFileNameMatches(collectFileNameMatches(""));
    }
  }, [showFileSearch, fileTree]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent backspace from navigating back in the Tauri webview
      if (e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (!isEditable) {
          e.preventDefault();
        }
      }

      // File search (Cmd+P / Ctrl+P / Cmd+F / Ctrl+F)
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      if (modifier && (e.key === 'p' || e.key === 'f')) {
        e.preventDefault();
        loadFileTree();
        setShowFileSearch(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Count visible panels - must always have at least one
  const visiblePanelCount = [showGitPanel, showAssistantPanel, showShellPanel, showNotesPanel, showMarkdownPanel].filter(Boolean).length;

  // Derived values for header: active folder, current branch, branch lists
  const activeFolder = currentProject?.folders?.find(f => f.id === activeFolderId) || currentProject?.folders?.[0];
  const gitRepoPath = activeFolder?.path ?? currentProject?.path ?? "";
  const currentBranch = branches.find(b => b.isHead);
  const localBranches = branches.filter(b => !b.isRemote);
  const remoteBranches = branches.filter(b => b.isRemote);

  // Handle branch switching
  const handleSwitchBranch = async (branchName: string) => {
    if (branchName === currentBranch?.name || !gitRepoPath) return;
    setIsSwitchingBranch(true);
    try {
      await invoke("checkout_branch", { repoPath: gitRepoPath, branch: branchName });
      toast.success(`Switched to ${branchName}`);
      refreshGitData(gitRepoPath);
    } catch (error) {
      toast.error("Failed to switch branch");
      console.error(error);
    } finally {
      setIsSwitchingBranch(false);
    }
  };

  // Handle opening remote URL in browser
  const handleOpenRemoteUrl = async () => {
    if (!gitRepoPath) return;
    try {
      const url = await invoke<string>("get_remote_url", { repoPath: gitRepoPath });
      await openUrl(url);
    } catch (error) {
      toast.error("Failed to open remote URL");
      console.error(error);
    }
  };

  // Handle creating a new branch
  const handleCreateBranch = async () => {
    if (!newBranchName.trim() || !gitRepoPath) return;
    setIsCreatingBranch(true);
    try {
      await invoke("create_branch", { repoPath: gitRepoPath, name: newBranchName });
      toast.success(`Created branch ${newBranchName}`);
      await invoke("checkout_branch", { repoPath: gitRepoPath, branch: newBranchName });
      toast.success(`Switched to ${newBranchName}`);
      refreshGitData(gitRepoPath);
      setShowBranchDialog(false);
      setNewBranchName("");
    } catch (error) {
      toast.error("Failed to create branch");
      console.error(error);
    } finally {
      setIsCreatingBranch(false);
    }
  };

  // Toggle handlers - redistribute space among visible panels
  const redistributePanelSpace = (
    freedOrNeeded: number,
    hiding: boolean,
    otherPanels: { width: number; setWidth: (w: number) => void; minWidth: number }[]
  ) => {
    const visible = otherPanels.filter((p) => p.width > 0);
    if (visible.length === 0) return;
    const totalWidth = visible.reduce((sum, p) => sum + p.width, 0);
    if (totalWidth <= 0) return;

    for (const panel of visible) {
      const ratio = panel.width / totalWidth;
      const delta = freedOrNeeded * ratio;
      const newWidth = hiding ? panel.width + delta : panel.width - delta;
      panel.setWidth(Math.max(panel.minWidth, Math.round(newWidth)));
    }
  };

  const toggleGitPanel = () => {
    if (showGitPanel && visiblePanelCount <= 1) return;
    isPanelResizing.current = true;
    const others = [
      { width: showAssistantPanel ? assistantPanelWidth : 0, setWidth: setAssistantPanelWidth, minWidth: 320 },
      { width: showShellPanel ? shellPanelWidth : 0, setWidth: setShellPanelWidth, minWidth: 280 },
      { width: showNotesPanel ? notesPanelWidth : 0, setWidth: setNotesPanelWidth, minWidth: 250 },
    ];

    if (showGitPanel) {
      const freed = gitPanelWidth + 8;
      savedGitWidth.current = gitPanelWidth;
      setShowGitPanel(false);
      setGitPanelWidth(0);
      // Close diff panel when git panel is hidden
      if (showDiffPanel) setDiffPanelSelection(null);
      redistributePanelSpace(freed, true, others);
    } else {
      const restored = savedGitWidth.current;
      const needed = restored + 8;
      setGitPanelWidth(restored);
      setShowGitPanel(true);
      redistributePanelSpace(needed, false, others);
    }
    setTimeout(() => { isPanelResizing.current = false; }, 100);
  };

  const toggleAssistantPanel = () => {
    if (showAssistantPanel && visiblePanelCount <= 1) return;
    isPanelResizing.current = true;
    const others = [
      { width: showGitPanel ? gitPanelWidth : 0, setWidth: setGitPanelWidth, minWidth: 280 },
      { width: showShellPanel ? shellPanelWidth : 0, setWidth: setShellPanelWidth, minWidth: 280 },
      { width: showNotesPanel ? notesPanelWidth : 0, setWidth: setNotesPanelWidth, minWidth: 250 },
    ];

    if (showAssistantPanel) {
      const freed = assistantPanelWidth + 8;
      savedAssistantWidth.current = assistantPanelWidth;
      setShowAssistantPanel(false);
      redistributePanelSpace(freed, true, others);
    } else {
      const restored = savedAssistantWidth.current;
      const needed = restored + 8;
      setAssistantPanelWidth(restored);
      setShowAssistantPanel(true);
      redistributePanelSpace(needed, false, others);
    }
    setTimeout(() => { isPanelResizing.current = false; }, 100);
  };

  const toggleShellPanel = () => {
    if (showShellPanel && visiblePanelCount <= 1) return;
    isPanelResizing.current = true;
    const others = [
      { width: showGitPanel ? gitPanelWidth : 0, setWidth: setGitPanelWidth, minWidth: 280 },
      { width: showAssistantPanel ? assistantPanelWidth : 0, setWidth: setAssistantPanelWidth, minWidth: 320 },
      { width: showNotesPanel ? notesPanelWidth : 0, setWidth: setNotesPanelWidth, minWidth: 250 },
    ];

    if (showShellPanel) {
      const freed = shellPanelWidth + 8;
      savedShellWidth.current = shellPanelWidth;
      setShowShellPanel(false);
      setShellPanelWidth(0);
      redistributePanelSpace(freed, true, others);
    } else {
      const restored = savedShellWidth.current;
      const needed = restored + 8;
      setShellPanelWidth(restored);
      setShowShellPanel(true);
      redistributePanelSpace(needed, false, others);
    }
    setTimeout(() => { isPanelResizing.current = false; }, 100);
  };

  const toggleNotesPanel = () => {
    if (showNotesPanel && visiblePanelCount <= 1) return;
    isPanelResizing.current = true;
    const others = [
      { width: showGitPanel ? gitPanelWidth : 0, setWidth: setGitPanelWidth, minWidth: 280 },
      { width: showAssistantPanel ? assistantPanelWidth : 0, setWidth: setAssistantPanelWidth, minWidth: 320 },
      { width: showShellPanel ? shellPanelWidth : 0, setWidth: setShellPanelWidth, minWidth: 280 },
    ];

    if (showNotesPanel) {
      const freed = notesPanelWidth + 8;
      savedNotesWidth.current = notesPanelWidth;
      setShowNotesPanel(false);
      setNotesPanelWidth(0);
      redistributePanelSpace(freed, true, others);
    } else {
      const restored = savedNotesWidth.current;
      const needed = restored + 8;
      setNotesPanelWidth(restored);
      setShowNotesPanel(true);
      redistributePanelSpace(needed, false, others);
    }
    setTimeout(() => { isPanelResizing.current = false; }, 100);
  };

  const handleSaveMarkdownRef = useRef<() => void>(() => {});

  // Markdown panel handlers
  const handleOpenMarkdownInPanel = async (filePath: string, lineNumber?: number) => {
    try {
      const content = await invoke<string>("read_text_file", { path: filePath });
      setMarkdownFile({ path: filePath, content, lineNumber });

      // Shrink other visible panels to make room for markdown panel
      if (!showMarkdownPanel) {
        isPanelResizing.current = true;
        const needed = savedMarkdownWidth.current + 8;
        const others = [
          { width: showGitPanel ? gitPanelWidth : 0, setWidth: setGitPanelWidth, minWidth: 280 },
          { width: showAssistantPanel ? assistantPanelWidth : 0, setWidth: setAssistantPanelWidth, minWidth: 320 },
          { width: showShellPanel ? shellPanelWidth : 0, setWidth: setShellPanelWidth, minWidth: 280 },
          { width: showNotesPanel ? notesPanelWidth : 0, setWidth: setNotesPanelWidth, minWidth: 250 },
        ];
        redistributePanelSpace(needed, false, others);
        setTimeout(() => { isPanelResizing.current = false; }, 100);
      }

      setShowMarkdownPanel(true);
      setMarkdownPanelWidth(savedMarkdownWidth.current);
      setMarkdownEditMode(false);
    } catch (err) {
      toast.error(`Failed to open file: ${err}`);
    }
  };

  const handleSaveMarkdown = async () => {
    if (!markdownFile) return;
    // Read latest content from the editor to avoid stale closure
    const content = editorRef.current?.getValue() ?? markdownFile.content;
    try {
      await invoke("write_text_file", {
        path: markdownFile.path,
        content
      });
      toast.success("File saved");
      setMarkdownEditMode(false);
    } catch (err) {
      toast.error(`Failed to save: ${err}`);
    }
  };
  handleSaveMarkdownRef.current = handleSaveMarkdown;

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: typeof import("monaco-editor")) => {
    editorRef.current = editor;

    // Add Cmd/Ctrl+S keyboard shortcut for save (use ref to avoid stale closure)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveMarkdownRef.current();
    });

    // Jump to line number if specified
    if (markdownFile?.lineNumber) {
      const line = markdownFile.lineNumber;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    }
  };

  // Jump to line when markdownFile changes and editor is already mounted
  useEffect(() => {
    if (markdownFile?.lineNumber && editorRef.current) {
      const line = markdownFile.lineNumber;
      // Small delay to ensure content is loaded
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.revealLineInCenter(line);
          editorRef.current.setPosition({ lineNumber: line, column: 1 });
          editorRef.current.focus();
        }
      }, 50);
    }
  }, [markdownFile?.path, markdownFile?.lineNumber]);

  const handleEditorFind = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      editorRef.current.trigger('keyboard', 'actions.find', null);
    }
  };

  const handleCloseMarkdownPanel = () => {
    isPanelResizing.current = true;
    // Save width and close panel
    savedMarkdownWidth.current = markdownPanelWidth;
    const freed = markdownPanelWidth + 8;
    setMarkdownFile(null);
    setShowMarkdownPanel(false);

    // Distribute freed space to other visible panels
    const others = [
      { width: showGitPanel ? gitPanelWidth : 0, setWidth: setGitPanelWidth, minWidth: 280 },
      { width: showAssistantPanel ? assistantPanelWidth : 0, setWidth: setAssistantPanelWidth, minWidth: 320 },
      { width: showShellPanel ? shellPanelWidth : 0, setWidth: setShellPanelWidth, minWidth: 280 },
      { width: showNotesPanel ? notesPanelWidth : 0, setWidth: setNotesPanelWidth, minWidth: 250 },
    ];
    redistributePanelSpace(freed, true, others);
    setTimeout(() => { isPanelResizing.current = false; }, 100);
  };

  // Open a new window
  const handleNewWindow = async () => {
    try {
      const webview = new WebviewWindow(`orca-${Date.now()}`, {
        url: "/",
        title: "Orca",
        width: 1200,
        height: 800,
        minWidth: 1024,
        minHeight: 600,
        center: true,
        titleBarStyle: "overlay",
        hiddenTitle: true,
        visible: false,
        backgroundColor: appBgColor,
      });
      webview.once("tauri://created", () => {
        webview.show();
      });
      webview.once("tauri://error", (e) => {
        console.error("Failed to create window:", e);
        toast.error("Failed to open new window");
      });
    } catch (error) {
      console.error("Error creating window:", error);
      toast.error("Failed to open new window");
    }
  };

  // Resize handle drag handler
  const handleResizeStart = (e: React.MouseEvent, panel: 'git' | 'shell' | 'notes' | 'markdown' | 'diff') => {
    e.preventDefault();
    const startX = e.clientX;
    const startGitWidth = gitPanelWidth;
    const startAssistantWidth = assistantPanelWidth;
    const startShellWidth = shellPanelWidth;
    const startNotesWidth = notesPanelWidth;
    const startMarkdownWidth = markdownPanelWidth;
    const startDiffWidth = diffPanelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      if (panel === 'git') {
        // Git resize: adjust git and assistant panels
        const newGitWidth = Math.max(280, Math.min(500, startGitWidth + delta));
        const newAssistantWidth = Math.max(320, startAssistantWidth - (newGitWidth - startGitWidth));
        setGitPanelWidth(newGitWidth);
        setAssistantPanelWidth(newAssistantWidth);
      } else if (panel === 'diff') {
        // Diff panel resize: adjust diff and assistant panels
        const newDiffWidth = Math.max(250, Math.min(700, startDiffWidth + delta));
        const newAssistantWidth = Math.max(320, startAssistantWidth - (newDiffWidth - startDiffWidth));
        setDiffPanelWidth(newDiffWidth);
        setAssistantPanelWidth(newAssistantWidth);
      } else if (panel === 'shell') {
        // Shell resize: adjust shell and assistant panels
        const newShellWidth = Math.max(280, Math.min(600, startShellWidth - delta));
        const newAssistantWidth = Math.max(320, startAssistantWidth + (startShellWidth - newShellWidth));
        setShellPanelWidth(newShellWidth);
        setAssistantPanelWidth(newAssistantWidth);
      } else if (panel === 'notes') {
        const newWidth = Math.max(250, Math.min(600, startNotesWidth - delta));
        setNotesPanelWidth(newWidth);
      } else if (panel === 'markdown') {
        const newWidth = Math.max(300, Math.min(800, startMarkdownWidth - delta));
        setMarkdownPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };


  // Handle drag over to allow dropping (must prevent default)
  const handlePanelDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  // Handle drops on the assistant panel (main terminals)
  const handleAssistantPanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const filePath = e.dataTransfer.getData("text/plain");
    if (!filePath) return;

    const activeTab = terminalTabs.find(t => t.id === activeTabId);
    if (activeTab?.terminalId) {
      invoke("write_terminal", { id: activeTab.terminalId, data: filePath + " " });
      // Focus the terminal so user can type immediately
      const textarea = assistantPanelRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
      textarea?.focus();
    }
  };

  // Handle drops on the shell panel (utility terminal)
  const handleShellPanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const filePath = e.dataTransfer.getData("text/plain");
    if (!filePath) return;

    if (utilityTerminalId && utilityTerminalId !== "closed") {
      invoke("write_terminal", { id: utilityTerminalId, data: filePath + " " });
      // Focus the terminal so user can type immediately
      const textarea = shellPanelRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
      textarea?.focus();
    }
  };

  // Handle note drops from NotesPanel onto terminal panels
  const handleNoteDropAtPosition = (text: string, x: number, y: number) => {
    const assistantRect = assistantPanelRef.current?.getBoundingClientRect();
    const shellRect = shellPanelRef.current?.getBoundingClientRect();

    if (assistantRect && x >= assistantRect.left && x <= assistantRect.right &&
        y >= assistantRect.top && y <= assistantRect.bottom) {
      const activeTab = terminalTabs.find(t => t.id === activeTabId);
      if (activeTab?.terminalId) {
        invoke("write_terminal", { id: activeTab.terminalId, data: text });
        const textarea = assistantPanelRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
        textarea?.focus();
      }
    } else if (shellRect && x >= shellRect.left && x <= shellRect.right &&
               y >= shellRect.top && y <= shellRect.bottom) {
      if (utilityTerminalId && utilityTerminalId !== "closed") {
        invoke("write_terminal", { id: utilityTerminalId, data: text });
        const textarea = shellPanelRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
        textarea?.focus();
      }
    }
  };

  // Handle file drag and drop from OS (e.g. Finder) into terminals
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const { paths, position } = event.payload;
        if (!paths || paths.length === 0) return;

        // Escape paths for shell (wrap in quotes, escape special chars)
        const escapedPaths = paths
          .map(p => `"${p.replace(/"/g, '\\"')}"`)
          .join(" ");

        // Determine which panel was targeted based on position
        const assistantRect = assistantPanelRef.current?.getBoundingClientRect();
        const shellRect = shellPanelRef.current?.getBoundingClientRect();

        if (assistantRect && position.x >= assistantRect.left && position.x <= assistantRect.right &&
            position.y >= assistantRect.top && position.y <= assistantRect.bottom) {
          // Dropped on assistant panel - find active tab's terminal
          const activeTab = terminalTabs.find(t => t.id === activeTabId);
          if (activeTab?.terminalId) {
            invoke("write_terminal", { id: activeTab.terminalId, data: escapedPaths });
            const textarea = assistantPanelRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
            textarea?.focus();
          }
        } else if (shellRect && position.x >= shellRect.left && position.x <= shellRect.right &&
                   position.y >= shellRect.top && position.y <= shellRect.bottom) {
          // Dropped on shell panel
          if (utilityTerminalId && utilityTerminalId !== "closed") {
            invoke("write_terminal", { id: utilityTerminalId, data: escapedPaths });
            const textarea = shellPanelRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement;
            textarea?.focus();
          }
        }
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [terminalTabs, activeTabId, utilityTerminalId]);

  const terminalsStarted = useRef(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const assistantPanelRef = useRef<HTMLDivElement>(null);
  const shellPanelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Panel widths in pixels
  const [gitPanelWidth, setGitPanelWidth] = useState(280);
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(520); // Main terminal area
  const [shellPanelWidth, setShellPanelWidth] = useState(400);
  const [markdownPanelWidth, setMarkdownPanelWidth] = useState(400);
  const [notesPanelWidth, setNotesPanelWidth] = useState(260);
  const [diffPanelSelection, setDiffPanelSelection] = useState<DiffPanelSelection | null>(null);
  const [diffPanelWidth, setDiffPanelWidth] = useState(400);
  const savedDiffWidth = useRef(400);
  const showDiffPanel = diffPanelSelection !== null;
  const savedGitWidth = useRef(280);
  const savedAssistantWidth = useRef(520);
  const savedShellWidth = useRef(400);
  const savedMarkdownWidth = useRef(400);
  const savedNotesWidth = useRef(260);
  const lastContainerWidth = useRef<number | null>(null);
  const isPanelResizing = useRef(false);

  // Proportionally resize all panels when window is resized
  useEffect(() => {
    const handleWindowResize = () => {
      const container = containerRef.current;
      if (!container) return;

      const newWidth = container.clientWidth;
      const oldWidth = lastContainerWidth.current;

      // Initialize on first run
      if (oldWidth === null) {
        lastContainerWidth.current = newWidth;
        return;
      }

      // Skip proportional resize when the window change is from opening/closing a panel
      if (isPanelResizing.current) {
        lastContainerWidth.current = newWidth;
        return;
      }

      // Only adjust if width changed significantly
      if (Math.abs(newWidth - oldWidth) > 5) {
        const ratio = newWidth / oldWidth;

        // Proportionally adjust all panel widths
        setGitPanelWidth(prev => Math.max(280, Math.round(prev * ratio)));
        setAssistantPanelWidth(prev => Math.max(320, Math.round(prev * ratio)));
        setShellPanelWidth(prev => Math.max(280, Math.round(prev * ratio)));
        setNotesPanelWidth(prev => Math.max(250, Math.round(prev * ratio)));
        setMarkdownPanelWidth(prev => Math.max(150, Math.round(prev * ratio)));
        setDiffPanelWidth(prev => Math.max(250, Math.round(prev * ratio)));

        // Update saved widths too
        savedGitWidth.current = Math.max(280, Math.round(savedGitWidth.current * ratio));
        savedAssistantWidth.current = Math.max(320, Math.round(savedAssistantWidth.current * ratio));
        savedShellWidth.current = Math.max(280, Math.round(savedShellWidth.current * ratio));
        savedNotesWidth.current = Math.max(250, Math.round(savedNotesWidth.current * ratio));
        savedMarkdownWidth.current = Math.max(150, Math.round(savedMarkdownWidth.current * ratio));
        savedDiffWidth.current = Math.max(250, Math.round(savedDiffWidth.current * ratio));

        lastContainerWidth.current = newWidth;
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  // Grow window when panels overflow the container
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Sum all visible panel widths + resize handles (6px each)
    const sidebarWidth = 56; // w-14
    const padding = 16; // pl-1.5 + pr-2
    let totalNeeded = 0;
    const panels = [
      { show: showGitPanel, width: gitPanelWidth },
      { show: showDiffPanel, width: diffPanelWidth },
      { show: showAssistantPanel, width: assistantPanelWidth },
      { show: showShellPanel, width: shellPanelWidth },
      { show: showNotesPanel, width: notesPanelWidth },
      { show: showMarkdownPanel, width: markdownPanelWidth },
    ];
    let visibleCount = 0;
    for (const p of panels) {
      if (p.show) {
        totalNeeded += p.width;
        visibleCount++;
      }
    }
    // Resize handles between panels
    totalNeeded += Math.max(0, visibleCount - 1) * 6;

    const availableWidth = container.clientWidth;
    const overflow = totalNeeded - availableWidth;

    if (overflow > 0) {
      const win = getCurrentWindow();
      win.outerSize().then(size => {
        win.scaleFactor().then(scale => {
          const logicalWidth = size.width / scale;
          const logicalHeight = size.height / scale;
          win.setSize(new LogicalSize(Math.round(logicalWidth + overflow + 8), Math.round(logicalHeight)));
          lastContainerWidth.current = availableWidth + overflow + 8;
        });
      });
    }
  }, [showGitPanel, showAssistantPanel, showShellPanel, showNotesPanel, showMarkdownPanel, showDiffPanel,
      gitPanelWidth, assistantPanelWidth, shellPanelWidth, notesPanelWidth, markdownPanelWidth, diffPanelWidth]);

  // Diff panel handler
  const handleShowDiff = useCallback((selection: DiffPanelSelection | null) => {
    if (selection === null) {
      // Closing: give space back to other panels
      if (showDiffPanel) {
        isPanelResizing.current = true;
        const freed = diffPanelWidth + 8;
        const others = [
          { width: showAssistantPanel ? assistantPanelWidth : 0, setWidth: setAssistantPanelWidth, minWidth: 320 },
          { width: showGitPanel ? gitPanelWidth : 0, setWidth: setGitPanelWidth, minWidth: 280 },
          { width: showShellPanel ? shellPanelWidth : 0, setWidth: setShellPanelWidth, minWidth: 280 },
        ].filter(p => p.width > 0);
        const totalWidth = others.reduce((sum, p) => sum + p.width, 0);
        if (totalWidth > 0) {
          for (const panel of others) {
            const ratio = panel.width / totalWidth;
            panel.setWidth(Math.max(panel.minWidth, Math.round(panel.width + freed * ratio)));
          }
        }
        savedDiffWidth.current = diffPanelWidth;
        setTimeout(() => { isPanelResizing.current = false; }, 100);
      }
      setDiffPanelSelection(null);
    } else {
      // Opening or updating
      if (!showDiffPanel) {
        // First open: steal space from other panels
        isPanelResizing.current = true;
        const needed = savedDiffWidth.current + 8;
        const others = [
          { width: showAssistantPanel ? assistantPanelWidth : 0, setWidth: setAssistantPanelWidth, minWidth: 320 },
          { width: showGitPanel ? gitPanelWidth : 0, setWidth: setGitPanelWidth, minWidth: 280 },
          { width: showShellPanel ? shellPanelWidth : 0, setWidth: setShellPanelWidth, minWidth: 280 },
        ].filter(p => p.width > 0);
        const totalWidth = others.reduce((sum, p) => sum + p.width, 0);
        if (totalWidth > 0) {
          for (const panel of others) {
            const ratio = panel.width / totalWidth;
            panel.setWidth(Math.max(panel.minWidth, Math.round(panel.width - needed * ratio)));
          }
        }
        setDiffPanelWidth(savedDiffWidth.current);
        setTimeout(() => { isPanelResizing.current = false; }, 100);
      }
      setDiffPanelSelection(selection);
    }
  }, [showDiffPanel, diffPanelWidth, assistantPanelWidth, gitPanelWidth, shellPanelWidth, showAssistantPanel, showGitPanel, showShellPanel]);

  // Trigger terminal resize when panel visibility changes
  useEffect(() => {
    // Small delay to let the layout settle, then trigger resize
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showGitPanel, showAssistantPanel, showShellPanel, showNotesPanel]);

  // Enforce intended sidebar width in case external styles inject inline overrides.
  useEffect(() => {
    const nav = sidebarNavRef.current;
    if (!nav) return;
    const enforceSidebarStyle = () => {
      nav.style.setProperty("width", "56px", "important");
      nav.style.setProperty("min-width", "56px", "important");
      nav.style.setProperty("max-width", "56px", "important");
    };
    enforceSidebarStyle();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          enforceSidebarStyle();
        }
      }
    });
    observer.observe(nav, { attributes: true, attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Skip if we already have this project loaded
    if (currentProject?.id === projectId) return;

    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setCurrentProject(project);
      openTab(project);
      loadGitData(project.path);
    } else {
      loadProjectFromBackend();
    }
  }, [projectId, projects, currentProject?.id]);

  // Sync local currentProject state when the store's project data changes (e.g. folder add/remove)
  useEffect(() => {
    if (!currentProject) return;
    const updatedProject = projects.find((p) => p.id === currentProject.id);
    if (updatedProject && updatedProject !== currentProject) {
      setCurrentProject(updatedProject);
    }
  }, [projects]);

  // Check installed assistants on mount
  useEffect(() => {
    const checkAssistants = async () => {
      const commands = getAllAssistantCommands(customAssistants);
      const installed = await invoke<string[]>("check_commands_installed", { commands });
      setInstalledAssistants(installed);
    };
    checkAssistants();
  }, [customAssistants]);

  // Track previous project ID to detect project switches
  const prevProjectIdRef = useRef<string | undefined>(undefined);

  // Reset terminals when project ID changes
  useEffect(() => {
    // Only run cleanup when actually switching projects (not on initial mount)
    if (prevProjectIdRef.current && prevProjectIdRef.current !== projectId) {
      // Kill existing terminals
      const ids: string[] = [];
      terminalTabs.forEach(tab => {
        if (tab.terminalId) ids.push(tab.terminalId);
      });
      if (utilityTerminalId && utilityTerminalId !== "closed") {
        ids.push(utilityTerminalId);
      }
      if (ids.length > 0) {
        invoke("kill_terminals", { ids }).catch(() => {});
      }

      // Clear terminal state
      setTerminalTabs([]);
      setActiveTabId(null);
      setUtilityTerminalId(isWindows ? "closed" : null);
      terminalsStarted.current = false;
    }
    prevProjectIdRef.current = projectId;
  }, [projectId]);

  // Auto-start terminals when project loads
  useEffect(() => {
    if (currentProject && !terminalsStarted.current) {
      terminalsStarted.current = true;
      startTerminals(currentProject.path);
    }
  }, [currentProject]);

  // Initialize shell cwd when project loads (only for single-folder projects)
  useEffect(() => {
    if (currentProject) {
      // For multi-folder projects, don't auto-set cwd - let user pick
      if (!currentProject.folders || currentProject.folders.length <= 1) {
        setShellCwd(currentProject.path);
        loadShellDirectories(currentProject.path);
      }
    }
  }, [currentProject]);

  const loadShellDirectories = async (path: string) => {
    try {
      const dirs = await invoke<string[]>("list_directories", { path });
      setShellDirs(dirs);
    } catch (error) {
      console.error("Failed to list directories:", error);
      setShellDirs([]);
    }
  };

  const loadShellHistory = async () => {
    const projectPath = currentProject?.path;
    if (!projectPath) return;

    try {
      // First try project-specific history
      const projectHistory = await invoke<string[]>("get_project_shell_history", {
        projectPath,
        limit: 500
      });

      if (projectHistory.length > 0) {
        setShellHistory(projectHistory.reverse()); // Most recent first
      } else {
        // Fallback to global history if no project history exists yet
        const globalHistory = await invoke<string[]>("get_shell_history", { limit: 500 });
        setShellHistory(globalHistory.reverse());
      }
    } catch (error) {
      console.error("Failed to load shell history:", error);
      setShellHistory([]);
    }
  };

  const recordCommand = async (command: string) => {
    const projectPath = currentProject?.path;
    if (!projectPath || !command.trim()) return;

    try {
      await invoke("record_project_command", {
        command: command.trim(),
        projectPath
      });
    } catch (error) {
      console.error("Failed to record command:", error);
    }
  };

  const handleHistorySelect = (command: string) => {
    if (!utilityTerminalId || utilityTerminalId === "closed") return;
    invoke("write_terminal", { id: utilityTerminalId, data: command });
    recordCommand(command); // Record when selecting from history
    setShowHistorySearch(false);
  };

  // Global file search functions
  const loadFileTree = async () => {
    const projectPath = currentProject?.path;
    if (!projectPath) return;
    try {
      const tree = await invoke<FileTreeNode[]>("get_file_tree", {
        path: projectPath,
        showHidden: false,
      });
      setFileTree(tree);
    } catch (error) {
      console.error("Failed to load file tree:", error);
    }
  };

  const collectFileNameMatches = (query: string): FileNameMatch[] => {
    const queryLower = query.toLowerCase();
    const results: FileNameMatch[] = [];
    const projectPath = currentProject?.path || "";

    const walkTree = (nodes: FileTreeNode[]) => {
      for (const node of nodes) {
        if (!node.isDir && (!queryLower || node.name.toLowerCase().includes(queryLower))) {
          results.push({
            name: node.name,
            path: node.path,
            isDir: false,
            basePath: projectPath,
            modified: node.modified,
          });
        }
        if (node.children) {
          walkTree(node.children);
        }
      }
    };

    walkTree(fileTree);
    results.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
    return results.slice(0, 50); // Limit results
  };

  const triggerContentSearch = async (query: string) => {
    const projectPath = currentProject?.path;
    if (!projectPath || query.length < 2) {
      setContentSearchResults([]);
      setContentSearchTruncated(false);
      setIsSearchingContent(false);
      return;
    }

    setIsSearchingContent(true);
    try {
      const result = await invoke<ContentSearchResult>("search_file_contents", {
        path: projectPath,
        query,
        showHidden: false,
        maxResults: 50,
      });
      setContentSearchResults(result.matches);
      setContentSearchTruncated(result.truncated);
    } catch (error) {
      console.error("Content search failed:", error);
    } finally {
      setIsSearchingContent(false);
    }
  };

  const handleFileSearchChange = (value: string) => {
    setFileSearchQuery(value);

    // Immediate file name search (show all files when query is empty)
    setFileNameMatches(collectFileNameMatches(value.trim()));

    // Debounced content search
    if (fileSearchTimeoutRef.current) {
      clearTimeout(fileSearchTimeoutRef.current);
    }
    if (value.trim().length >= 2) {
      setIsSearchingContent(true);
      fileSearchTimeoutRef.current = setTimeout(() => {
        triggerContentSearch(value.trim());
      }, 300);
    } else {
      setContentSearchResults([]);
      setContentSearchTruncated(false);
      setIsSearchingContent(false);
    }
  };

  const handleCloseFileSearch = () => {
    setShowFileSearch(false);
    setFileSearchQuery("");
    setFileNameMatches([]);
    setContentSearchResults([]);
    setContentSearchTruncated(false);
    setIsSearchingContent(false);
    if (fileSearchTimeoutRef.current) {
      clearTimeout(fileSearchTimeoutRef.current);
    }
  };

  const handleFileSearchResultClick = (match: FileNameMatch) => {
    if (!match.isDir) {
      const absolutePath = `${match.basePath}/${match.path}`;
      handleOpenMarkdownInPanel(absolutePath);
    }
    handleCloseFileSearch();
  };

  const handleContentMatchClick = (match: ContentMatch) => {
    handleOpenMarkdownInPanel(match.absolutePath, match.lineNumber);
    handleCloseFileSearch();
  };

  const handleShellCd = async (dirName: string) => {
    if (!utilityTerminalId || utilityTerminalId === "closed") return;

    let newPath: string;
    if (dirName === "..") {
      // Go up one directory - handle both / and \ separators
      const sep = shellCwd.includes("\\") ? "\\" : "/";
      const parts = shellCwd.split(/[/\\]/).filter(Boolean);
      parts.pop();
      newPath = sep === "\\" ? parts.join("\\") : "/" + parts.join("/");
    } else {
      const sep = shellCwd.includes("\\") ? "\\" : "/";
      newPath = `${shellCwd}${sep}${dirName}`;
    }

    // Send cd command to the shell
    const cdCommand = `cd "${newPath}"\n`;
    await invoke("write_terminal", { id: utilityTerminalId, data: cdCommand });

    // Update state
    setShellCwd(newPath);
    loadShellDirectories(newPath);
  };

  // Handle cwd changes detected from shell via OSC 7 sequences
  const handleShellCwdChange = (newCwd: string) => {
    if (newCwd !== shellCwd) {
      setShellCwd(newCwd);
      loadShellDirectories(newCwd);
    }
  };

  // Add a folder to the current project (Issue #6)
  const handleAddFolder = async () => {
    if (!currentProject) return;

    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add Folder to Project",
    });

    if (selected && typeof selected === "string") {
      const folderName = selected.split("/").pop() || selected.split("\\").pop() || "folder";
      const newFolder: ProjectFolder = {
        id: crypto.randomUUID(),
        name: folderName,
        path: selected,
      };

      const baseProject = ensureFolders(currentProject);
      addFolderToProject(currentProject.id, newFolder);
      // Update local state to reflect the change
      const updatedProject = {
        ...baseProject,
        folders: [...baseProject.folders!, newFolder],
      };
      setCurrentProject(updatedProject);
      // Persist to backend database
      await invoke("add_project", { project: updatedProject });
      toast.success(`Added folder: ${folderName}`);
    }
  };

  // Rename workspace (Issue #6)
  const handleRenameWorkspace = (name: string) => {
    if (!currentProject) return;
    updateProject(currentProject.id, { name });
    setCurrentProject(prev => prev ? { ...prev, name } : null);
  };

  // Save project as .orca file (Issue #6)
  const handleSaveProject = async () => {
    if (!currentProject) return;

    const filePath = await save({
      defaultPath: `${currentProject.name}.orca`,
      filters: [{ name: "Orca Project", extensions: ["orca"] }],
      title: "Save Project",
    });

    if (filePath) {
      const projectData: ProjectFileData = {
        version: 1,
        name: currentProject.name,
        folders: currentProject.folders || [{
          id: crypto.randomUUID(),
          name: currentProject.name,
          path: currentProject.path,
        }],
      };

      try {
        await invoke("save_project_file", { path: filePath, data: projectData });
        toast.success("Project saved successfully");
      } catch (error) {
        console.error("Failed to save project:", error);
        toast.error("Failed to save project");
      }
    }
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  const getAssistantOptions = (): AssistantOption[] => {
    const visibleAssistants = getAllAssistants(customAssistants, hiddenAssistantIds);
    const options: AssistantOption[] = visibleAssistants.map((a) => ({
      id: a.id,
      name: a.name,
      command: a.command,
      icon: <Bot className="h-4 w-4" />,
      installed: installedAssistants.includes(a.command),
    }));
    options.push({
      id: "shell",
      name: "Shell",
      command: "",
      icon: <TerminalIcon className="h-4 w-4" />,
      installed: true,
    });
    return options;
  };

  // Callback when Terminal component spawns its PTY
  const handleTerminalReady = (tabId: string, newTerminalId: string) => {
    setTerminalTabs(prev =>
      prev.map(tab =>
        tab.id === tabId ? { ...tab, terminalId: newTerminalId } : tab
      )
    );
  };

  // Actually create the terminal tab with a specific cwd
  const doCreateTerminalTab = async (cwd: string, assistantId?: string) => {
    try {
      // Check installed assistants fresh (don't rely on stale state)
      const commands = getAllAssistantCommands(customAssistants);
      const currentInstalled = await invoke<string[]>("check_commands_installed", { commands });

      let command = "";
      let name = "Shell";

      // Use provided assistantId, or fall back to default from settings
      const targetAssistant = assistantId || defaultAssistant;

      if (targetAssistant && targetAssistant !== "shell") {
        const options = getAssistantOptions();
        const targetOption = options.find(a => a.id === targetAssistant);
        const isInstalled = targetOption ? currentInstalled.includes(targetOption.command) : false;

        if (isInstalled && targetOption) {
          command = targetOption.command;
          name = targetOption.name;
          const argsKey = targetAssistant === "claude" ? "claude-code" : targetAssistant;
          const args = assistantArgs[argsKey] || "";
          invoke("debug_log", { message: `createNewTab - argsKey: ${argsKey}, args: "${args}"` });
          if (args) command = `${command} ${args}`;
          invoke("debug_log", { message: `createNewTab - final command: "${command}"` });
        } else {
          // Fall back to first installed assistant if default isn't installed
          const fallback = options.find(a => a.id !== "shell" && currentInstalled.includes(a.command));
          if (fallback) {
            command = fallback.command;
            name = fallback.name;
            const argsKey = fallback.id === "claude" ? "claude-code" : fallback.id;
            const args = assistantArgs[argsKey] || "";
            if (args) command = `${command} ${args}`;
          }
        }
      }

      // Don't spawn terminal here - let Terminal component do it with correct dimensions
      const tabId = `tab-${Date.now()}`;
      const isAssistantTab = command !== "";  // Non-empty command means it's an assistant
      const newTab: TerminalTab = {
        id: tabId,
        name,
        command,  // Store command, Terminal will spawn with correct dimensions
        terminalId: null,  // Will be set by Terminal component
        cwd,  // Working directory for this terminal
        isAssistant: isAssistantTab,
      };

      setTerminalTabs(prev => [...prev, newTab]);
      setActiveTabId(tabId);

      if (command) {
        toast.success(`${newTab.name} starting...`);
      }

      return newTab;
    } catch (error) {
      console.error("Failed to create terminal tab:", error);
      return null;
    }
  };

  // Create a new terminal tab - if multiple folders, tab shows folder selector in pane (Issue #6)
  const createNewTab = async (_projectPath: string, assistantId?: string) => {
    if (!currentProject) return null;

    // If project has multiple folders, create tab without cwd (will show folder selector in pane)
    if (currentProject.folders && currentProject.folders.length > 1) {
      return doCreateTerminalTab("", assistantId); // Empty cwd triggers folder selection UI
    }

    // Single folder or no folders - use project path directly
    return doCreateTerminalTab(currentProject.path, assistantId);
  };

  // Set cwd for a tab that needs folder selection (Issue #6)
  const setTabCwd = (tabId: string, cwd: string) => {
    setTerminalTabs(prev =>
      prev.map(tab =>
        tab.id === tabId ? { ...tab, cwd } : tab
      )
    );
  };

  const closeTab = (tabId: string) => {
    const tab = terminalTabs.find(t => t.id === tabId);
    const remaining = terminalTabs.filter(t => t.id !== tabId);

    // Kill terminal in background
    if (tab?.terminalId) {
      invoke("kill_terminal", { id: tab.terminalId }).catch(() => {});
    }

    // Update both states - React 18 batches automatically
    const newActiveId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    if (activeTabId === tabId) {
      setActiveTabId(newActiveId);
    }
    setTerminalTabs(remaining);
  };

  const startEditingTab = (tab: TerminalTab) => {
    setEditingTabId(tab.id);
    setEditingTabName(tab.name);
  };

  const finishEditingTab = () => {
    if (editingTabId && editingTabName.trim()) {
      setTerminalTabs(prev =>
        prev.map(tab =>
          tab.id === editingTabId ? { ...tab, name: editingTabName.trim() } : tab
        )
      );
    }
    setEditingTabId(null);
    setEditingTabName("");
  };

  const handleTabNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      finishEditingTab();
    } else if (e.key === "Escape") {
      setEditingTabId(null);
      setEditingTabName("");
    }
  };

  // Tab reordering
  const reorderTabs = useCallback((sourceId: string, targetId: string) => {
    setTerminalTabs((prev) => {
      const sourceIndex = prev.findIndex((tab) => tab.id === sourceId);
      const targetIndex = prev.findIndex((tab) => tab.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }, []);

  // Mouse-based tab reordering (more reliable than HTML5 drag API)
  const handleTabMouseDown = (event: React.MouseEvent, tabId: string) => {
    // Ignore if clicking on buttons or inputs
    const target = event.target as HTMLElement;
    if (target.closest('button, input')) return;

    event.preventDefault();
    setDraggingTabId(tabId);
    setDragPosition({ x: event.clientX, y: event.clientY });

    const handleMouseMove = (e: MouseEvent) => {
      setDragPosition({ x: e.clientX, y: e.clientY });

      // Find which tab we're over
      let foundTab: string | null = null;
      tabRefs.current.forEach((el, id) => {
        if (id !== tabId) {
          const rect = el.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom) {
            foundTab = id;
          }
        }
      });
      setDragOverTabId(foundTab);
    };

    const handleMouseUp = (e: MouseEvent) => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // Find which tab we're over
      let targetTab: string | null = null;
      tabRefs.current.forEach((el, id) => {
        if (id !== tabId) {
          const rect = el.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom) {
            targetTab = id;
          }
        }
      });

      if (targetTab) {
        reorderTabs(tabId, targetTab);
      }

      setDraggingTabId(null);
      setDragOverTabId(null);
      setDragPosition(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Horizontal scroll for tab list (convert vertical scroll to horizontal)
  const handleTabWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = tabListRef.current;
    if (!container) return;
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      if (container.scrollWidth > container.clientWidth) {
        container.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    }
  };

  const startTerminals = async (projectPath: string) => {
    try {
      // In production builds, the Tauri backend may not be fully ready when the
      // page first loads. Wait a moment for the backend to initialize.
      // This ping also ensures IPC is working before we try to spawn terminals.
      await invoke("debug_log", { message: "Backend ready check" });

      // Small additional delay to ensure window is visible and layout has settled
      await new Promise(resolve => setTimeout(resolve, 150));

      // Utility terminal will spawn itself when its Terminal component mounts
      // Just create the first AI terminal tab
      await createNewTab(projectPath);
    } catch (error) {
      console.error("Failed to start terminals:", error);
    }
  };

  const loadProjectFromBackend = async () => {
    try {
      const project = await invoke<Project | null>("get_project", { id: projectId });
      if (project) {
        const migrated = ensureFolders(project);
        setCurrentProject(migrated);
        openTab(migrated);
        loadGitData(migrated.path);
        // Write back migrated data if folders were missing
        if (!project.folders || project.folders.length === 0) {
          await invoke("add_project", { project: migrated });
        }
      } else {
        toast.error("Project not found");
        navigate("/");
      }
    } catch {
      toast.error("Failed to load project");
      navigate("/");
    }
  };

  const loadGitData = async (path: string) => {
    setLoading(true);
    try {
      // Check if this is a git repo first
      const isRepo = await invoke<boolean>("is_git_repo", { path });
      setIsGitRepo(isRepo);

      if (!isRepo) {
        // Clear git data if not a repo
        setStatus(null);
        setDiffs([]);
        setBranches([]);
        setHistory([]);
        setLoading(false);
        return;
      }

      const [status, diffs, branches, history, worktrees] = await Promise.all([
        invoke<GitStatus>("get_status", { repoPath: path }),
        invoke<FileDiff[]>("get_diff", { repoPath: path }),
        invoke<Branch[]>("get_branches", { repoPath: path }),
        invoke<Commit[]>("get_history", { repoPath: path, limit: 50 }),
        invoke<WorktreeInfo[]>("list_worktrees", { repoPath: path }).catch(() => [] as WorktreeInfo[]),
      ]);
      setStatus(status);
      setDiffs(diffs);
      setBranches(branches);
      setHistory(history);
      setWorktrees(worktrees);
    } catch (error) {
      console.error("Failed to load git data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Use ref for current project path to avoid effect dependency issues
  const currentProjectPathRef = useRef<string | null>(null);
  useEffect(() => {
    currentProjectPathRef.current = currentProject?.path || null;
  }, [currentProject?.path]);

  const refreshGitData = useCallback(async (overridePath?: string) => {
    const path = overridePath || currentProjectPathRef.current;
    if (path) {
      // Load git data immediately without waiting for fetch
      loadGitData(path);
      // Fire off fetch in background - don't block the refresh
      invoke("fetch_remote", { repoPath: path, remote: "origin" })
        .then(() => loadGitData(path))
        .catch(() => {}); // Silently continue - fetch may fail if no remote configured
    }
  }, []);

  const initGitRepo = useCallback(async () => {
    const path = currentProjectPathRef.current;
    if (path) {
      try {
        await invoke("init_repo", { path });
        toast.success("Git repository initialized");
        await loadGitData(path);
      } catch (error) {
        console.error("Failed to initialize git repo:", error);
        toast.error("Failed to initialize git repository");
      }
    }
  }, []);

  useEffect(() => {
    const unlisten = listen("git-refresh", () => {
      refreshGitData();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshGitData]);

  // Auto-fetch remote when enabled (every 60 seconds)
  useEffect(() => {
    if (!autoFetchRemote || !currentProject) return;

    // Set up interval for periodic fetching (don't fetch immediately to avoid loops)
    const interval = setInterval(() => {
      const path = currentProjectPathRef.current;
      if (path) {
        invoke("fetch_remote", { repoPath: path, remote: "origin" })
          .then(() => refreshGitData())
          .catch(() => {});
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [autoFetchRemote, currentProject?.path, refreshGitData]);

  // Refresh git data when active folder changes
  useEffect(() => {
    if (gitRepoPath) {
      refreshGitData(gitRepoPath);
    }
  }, [gitRepoPath, refreshGitData]);

  // File watcher for git status updates (replaces polling)
  useEffect(() => {
    if (!currentProject?.path) return;

    const repoPath = currentProject.path;

    // Start watching the repo
    invoke("watch_repo", { repoPath }).catch((err) => {
      console.error("Failed to start git watcher:", err);
    });

    // Listen for file change events
    const unlisten = listen<string>("git-files-changed", (event) => {
      // Only refresh if this event is for our repo
      if (event.payload === repoPath) {
        loadGitData(repoPath);
      }
    });

    return () => {
      // Stop watching when component unmounts or project changes
      invoke("unwatch_repo", { repoPath }).catch(() => {});
      unlisten.then((fn) => fn());
    };
  }, [currentProject?.path]);

  // Auto-refresh markdown preview when the file changes on disk
  useEffect(() => {
    if (!markdownFile || !showMarkdownPanel || markdownEditMode) return;

    const filePath = markdownFile.path;
    const unlisten = listen<string>("git-files-changed", async () => {
      try {
        const content = await invoke<string>("read_text_file", { path: filePath });
        setMarkdownFile((prev) => prev && prev.path === filePath ? { ...prev, content } : prev);
      } catch {
        // File may have been deleted; ignore
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [markdownFile?.path, showMarkdownPanel, markdownEditMode]);

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  const assistantOptions = getAssistantOptions();
  const navButtonBase =
    "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/50 transition-all duration-200";
  const panelShellClass =
    "rounded-2xl bg-card border border-border/30 transition-opacity duration-150";

  return (
    <div
      className="relative flex h-full bg-background"
      onMouseDown={(e) => {
        // Only start dragging if clicking in the top 40px and not on interactive elements
        if (e.clientY <= 40) {
          const target = e.target as HTMLElement;
          // Exclude interactive elements and tab items (but allow empty tab bar space)
          if (!target.closest('button, a, input, [role="button"], [data-tab-item]')) {
            getCurrentWindow().startDragging();
          }
        }
      }}
    >
      {/* Centered header with project/folder name and branch selector */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 h-12 mt-0.5">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 mr-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                loadFileTree();
                setShowFileSearch(true);
              }}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Search Files (⌘P)</TooltipContent>
        </Tooltip>
        {currentProject?.folders && currentProject.folders.length > 1 ? (
          /* Multi-folder: active folder name with dropdown */
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2.5 rounded-full text-sm font-medium hover:bg-muted/50"
                    >
                      <span className="truncate max-w-[150px]">{activeFolder?.name || currentProject.name}</span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-56 max-h-80 overflow-y-auto">
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Folders
                    </div>
                    {currentProject.folders.map((folder) => {
                      const isActive = folder.id === (activeFolderId || currentProject.folders?.[0]?.id);
                      return (
                        <DropdownMenuItem
                          key={folder.id}
                          onClick={() => setActiveFolderId(folder.id)}
                          className={cn("flex items-center justify-between", isActive && "bg-muted/50 text-foreground")}
                        >
                          <span className="truncate">{folder.name}</span>
                          {isActive && <Check className="h-3 w-3 text-primary" />}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleAddFolder}>
                      <Plus className="mr-2 h-3 w-3" />
                      Add Folder to Workspace
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </ContextMenuTrigger>
            {isGitRepo && (
              <ContextMenuContent>
                <ContextMenuItem onClick={handleOpenRemoteUrl}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open Remote URL
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
        ) : (
          /* Single folder: just show project name */
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <span className="text-sm font-medium px-2 cursor-default h-6 inline-flex items-center">{currentProject?.name}</span>
            </ContextMenuTrigger>
            {isGitRepo && (
              <ContextMenuContent>
                <ContextMenuItem onClick={handleOpenRemoteUrl}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open Remote URL
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
        )}
        {isGitRepo && (
          <>
            <span className="text-muted-foreground text-sm h-6 inline-flex items-center">/</span>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2.5 rounded-full text-sm font-normal text-muted-foreground hover:text-foreground translate-y-px"
                        disabled={isSwitchingBranch}
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        <span className="max-w-[100px] truncate">{currentBranch?.name || "main"}</span>
                        {isSwitchingBranch ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-56 max-h-80 overflow-y-auto">
                      <DropdownMenuItem onClick={() => setShowBranchDialog(true)}>
                        <Plus className="mr-2 h-3 w-3" />
                        New branch
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {localBranches.length > 0 && (
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                          Local
                        </div>
                      )}
                      {localBranches.map((branch) => (
                        <DropdownMenuItem
                          key={branch.name}
                          onClick={() => handleSwitchBranch(branch.name)}
                          className={cn("flex items-center justify-between", branch.isHead && "bg-muted/50 text-foreground")}
                        >
                          <span className="truncate">{branch.name}</span>
                          {branch.isHead && <Check className="h-3 w-3 text-primary" />}
                        </DropdownMenuItem>
                      ))}
                      {remoteBranches.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                            Remote
                          </div>
                          {remoteBranches.map((branch) => (
                            <DropdownMenuItem
                              key={branch.name}
                              onClick={() => handleSwitchBranch(branch.name.replace(/^origin\//, ""))}
                              className="flex items-center justify-between text-muted-foreground"
                            >
                              <span className="truncate">{branch.name}</span>
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                      {worktrees.length > 1 && (
                        <>
                          <DropdownMenuSeparator />
                          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                            Worktrees
                          </div>
                          {worktrees.filter(wt => !wt.isMain).map((wt) => (
                            <DropdownMenuItem
                              key={wt.path}
                              onClick={async () => {
                                const name = wt.path.split(/[/\\]/).pop() || "Worktree";
                                const project: Project = {
                                  id: crypto.randomUUID(),
                                  name,
                                  path: wt.path,
                                  folders: [{ id: crypto.randomUUID(), name, path: wt.path }],
                                  lastOpened: new Date().toISOString(),
                                };
                                await invoke("add_project", { project });
                                navigate(`/project/${project.id}`);
                              }}
                              className="flex items-center justify-between text-muted-foreground"
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="truncate text-xs">{wt.branch || wt.name}</span>
                                <span className="truncate text-[10px] text-muted-foreground/60">{wt.path}</span>
                              </div>
                              {wt.isLocked && <span className="text-[10px]">locked</span>}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={handleOpenRemoteUrl}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open Remote URL
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </>
        )}
      </div>

      {/* Left icon sidebar */}
      <nav
        ref={sidebarNavRef}
        aria-label="Sidebar"
        className="relative z-20 flex w-14 flex-col pl-2 pb-2 pt-12 backdrop-blur-sm"
      >
        {/* Top icon container */}
        <div className="flex flex-col items-center gap-1.5 px-3 py-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleNewWindow}
                aria-label="New window"
                className={cn(navButtonBase, "hover:text-foreground/70 hover:bg-muted/20")}
              >
                <Plus className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New Window</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={async () => {
                  const selected = await open({
                    directory: true,
                    multiple: false,
                    title: "Select Folder",
                  });
                  if (selected && typeof selected === "string") {
                    const name = selected.split(/[/\\]/).pop() || "Unknown";
                    const project: Project = ensureFolders({
                      id: crypto.randomUUID(),
                      name,
                      path: selected,
                      lastOpened: new Date().toISOString(),
                    });
                    addProject(project);
                    await invoke("add_project", { project });
                    navigate(`/project/${project.id}`);
                  }
                }}
                aria-label="Open folder"
                className={cn(navButtonBase, "hover:text-foreground/70 hover:bg-muted/20")}
              >
                <FolderOpen className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open Folder</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  setActiveSidebarItem("settings");
                  setShowSettings(true);
                }}
                aria-label="Settings"
                className={cn(
                  navButtonBase,
                  activeSidebarItem === "settings"
                    ? "text-primary"
                    : "hover:text-foreground"
                )}
              >
                <Settings className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom icon container */}
        <div className="flex flex-col items-center gap-1.5 px-3 py-2">
          {/* Panel toggle icons */}
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleGitPanel}
                  aria-label={showGitPanel ? "Hide git panel" : "Show git panel"}
                className={cn(
                  navButtonBase,
                  showGitPanel
                    ? "text-primary"
                    : "hover:text-foreground/70 hover:bg-muted/20",
                  showGitPanel && visiblePanelCount <= 1 && "cursor-not-allowed"
                )}
              >
                <GitBranch className="h-5 w-5" />
              </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {showGitPanel && visiblePanelCount <= 1
                  ? "Can't hide last panel"
                  : showGitPanel ? "Hide Git Panel" : "Show Git Panel"}
              </TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleAssistantPanel}
                  aria-label={showAssistantPanel ? "Hide assistant" : "Show assistant"}
                className={cn(
                  navButtonBase,
                  showAssistantPanel
                    ? "text-primary"
                    : "hover:text-foreground/70 hover:bg-muted/20",
                  showAssistantPanel && visiblePanelCount <= 1 && "cursor-not-allowed"
                )}
              >
                <Bot className="h-5 w-5" />
              </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {showAssistantPanel && visiblePanelCount <= 1
                  ? "Can't hide last panel"
                  : showAssistantPanel ? "Hide Assistant" : "Show Assistant"}
              </TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleShellPanel}
                  aria-label={showShellPanel ? "Hide shell" : "Show shell"}
                className={cn(
                  navButtonBase,
                  showShellPanel
                    ? "text-primary"
                    : "hover:text-foreground/70 hover:bg-muted/20",
                  showShellPanel && visiblePanelCount <= 1 && "cursor-not-allowed"
                )}
              >
                <TerminalIcon className="h-5 w-5" />
              </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {showShellPanel && visiblePanelCount <= 1
                  ? "Can't hide last panel"
                  : showShellPanel ? "Hide Shell" : "Show Shell"}
              </TooltipContent>
            </Tooltip>

            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleNotesPanel}
                  aria-label={showNotesPanel ? "Hide notes" : "Show notes"}
                className={cn(
                  navButtonBase,
                  showNotesPanel
                    ? "text-primary"
                    : "hover:text-foreground/70 hover:bg-muted/20",
                  showNotesPanel && visiblePanelCount <= 1 && "cursor-not-allowed"
                )}
              >
                <LetterText className="h-5 w-5" />
              </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {showNotesPanel && visiblePanelCount <= 1
                  ? "Can't hide last panel"
                  : showNotesPanel ? "Hide Notes" : "Show Notes"}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="my-1.5" />

          {/* Bottom icons */}
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  aria-label="Help"
                  onClick={() => setHasSeenOnboarding(false)}
                  className={cn(navButtonBase, "hover:text-foreground/70 hover:bg-muted/20")}
                >
                  <HelpCircle className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Help</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </nav>

      {/* Main content area */}
      <main
        ref={containerRef}
        className="relative z-10 flex flex-1 overflow-hidden pl-1.5 pr-2 pb-2 pt-12"
      >
        <h1 className="sr-only">{currentProject.name} - Orca</h1>
        {/* Left sidebar - Git panel */}
        <div
          role="region"
          aria-label="Git panel"
          className={cn("h-full flex flex-col overflow-hidden", panelShellClass, !showGitPanel && "hidden")}
          style={{ flex: `0 1 ${gitPanelWidth}px`, minWidth: 280 }}
        >
          <GitPanel
            projectPath={currentProject.path}
            isGitRepo={isGitRepo}
            onRefresh={refreshGitData}
            onInitRepo={initGitRepo}
            onOpenMarkdown={handleOpenMarkdownInPanel}
            shellCwd={shellCwd}
            folders={currentProject.folders}
            onAddFolder={handleAddFolder}
            onRemoveFolder={(folderId) => removeFolderFromProject(currentProject.id, folderId)}
            workspaceName={currentProject.name}
            onRenameWorkspace={handleRenameWorkspace}
            onSaveWorkspace={handleSaveProject}
            onShowDiff={handleShowDiff}
            activeDiffPath={diffPanelSelection?.diff.path ?? null}
          />
        </div>
        {/* Resize handle for git panel */}
        {showGitPanel && (
          <div
            className="w-1.5 shrink-0 cursor-col-resize"
            onMouseDown={(e) => handleResizeStart(e, 'git')}
          />
        )}

        {/* Diff panel */}
        {showDiffPanel && (
          <>
            <div
              className={cn("h-full flex flex-col overflow-hidden", panelShellClass)}
              style={{ flex: `0 1 ${diffPanelWidth}px`, minWidth: 250 }}
            >
              <DiffPanel
                selection={diffPanelSelection}
                onClose={() => handleShowDiff(null)}
                onRefresh={() => refreshGitData()}
              />
            </div>
            <div
              className="w-1.5 shrink-0 cursor-col-resize"
              onMouseDown={(e) => handleResizeStart(e, 'diff')}
            />
          </>
        )}

        {/* Center - Terminal area */}
        <div
          ref={assistantPanelRef}
          role="region"
          aria-label="Assistant panel"
          className={cn(
            "h-full overflow-hidden",
            panelShellClass,
            !showAssistantPanel && "hidden"
          )}
          style={{ flex: `1 1 ${assistantPanelWidth}px`, minWidth: 320, backgroundColor: terminalBg }}
          onDragOver={handlePanelDragOver}
          onDrop={handleAssistantPanelDrop}
        >
          <div className="flex h-full flex-col select-none overflow-hidden">
          {/* Tab bar */}
          <div className="flex h-10 items-center px-1.5 pt-1">
            <div
              ref={tabListRef}
              role="tablist"
              aria-label="Terminal tabs"
              className="tab-scroll flex flex-1 items-center"
              onWheel={handleTabWheel}
            >
              <div className="flex min-w-max items-center">
                {terminalTabs.map((tab) => (
                  <div
                    key={tab.id}
                    data-tab-item
                    role="tab"
                    aria-selected={activeTabId === tab.id}
                    ref={(el) => {
                      if (el) tabRefs.current.set(tab.id, el);
                      else tabRefs.current.delete(tab.id);
                    }}
                    className={cn(
                      "group flex h-7 shrink-0 cursor-grab items-center gap-1.5 pl-3 pr-3 group-hover:pr-2 my-1.5 mx-0.5 rounded-full text-sm font-medium transition-all duration-200",
                      activeTabId === tab.id
                        ? "text-foreground bg-muted/50"
                        : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/20",
                      draggingTabId === tab.id && "opacity-60 cursor-grabbing",
                      dragOverTabId === tab.id && draggingTabId !== tab.id && "bg-muted/25"
                    )}
                    onClick={() => !draggingTabId && setActiveTabId(tab.id)}
                    onMouseDown={(event) => handleTabMouseDown(event, tab.id)}
                  >
                    {tab.command === "" ? (
                      <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {editingTabId === tab.id ? (
                    <Input
                      ref={editInputRef}
                      value={editingTabName}
                      onChange={(e) => setEditingTabName(e.target.value)}
                      onBlur={finishEditingTab}
                      onKeyDown={handleTabNameKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      className="h-5 w-24 px-1 py-0 text-sm"
                    />
                  ) : (
                    <span
                      className="truncate max-w-[120px]"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditingTab(tab);
                      }}
                    >
                      {tab.name}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    aria-label={`Close ${tab.name} tab`}
                    className="ml-1 shrink-0 rounded-full p-0.5 hidden group-hover:flex hover:bg-muted/50 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  </div>
                ))}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="New tab"
                  className="flex h-7 w-7 items-center justify-center my-1.5 mx-0.5 rounded-full text-muted-foreground/70 transition-all duration-200 hover:bg-muted/25 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {assistantOptions.map((assistant) => (
                  <DropdownMenuItem
                    key={assistant.id}
                    onClick={() => currentProject && createNewTab(currentProject.path, assistant.id)}
                    disabled={!assistant.installed}
                    className="flex items-center gap-2"
                  >
                    {assistant.icon}
                    <span>{assistant.name}</span>
                    {!assistant.installed && (
                      <span className="text-xs text-muted-foreground ml-auto">(not installed)</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Floating drag indicator */}
          {draggingTabId && dragPosition && (
            <div
              className="fixed pointer-events-none z-50 px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium shadow-lg"
              style={{
                left: dragPosition.x + 10,
                top: dragPosition.y + 10,
              }}
            >
              {terminalTabs.find(t => t.id === draggingTabId)?.name}
            </div>
          )}

          {/* Tab content - render in stable order (sorted by id) to prevent remounting on reorder */}
          {/* Uses absolute positioning + invisible instead of display:none to preserve xterm scroll position */}
          <div className={cn("relative flex-1 overflow-hidden", terminalTabs.length === 0 && "hidden")}>
          {[...terminalTabs].sort((a, b) => a.id.localeCompare(b.id)).map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "absolute inset-0 flex flex-col overflow-hidden",
                activeTabId !== tab.id && "invisible pointer-events-none"
              )}
            >
              <div
                className="flex-1 overflow-hidden"
                style={{ backgroundColor: terminalBg }}
              >
                {tab.cwd ? (
                  <Terminal
                    id={tab.terminalId || undefined}
                    command={tab.command}
                    cwd={tab.cwd}
                    onTerminalReady={(terminalId) => handleTerminalReady(tab.id, terminalId)}
                    visible={showAssistantPanel && activeTabId === tab.id}
                    autoFocusOnWindowFocus
                    isAssistant={tab.isAssistant}
                  />
                ) : (
                  /* Folder selector for multi-folder projects (Issue #6) */
                  <div className="flex h-full flex-col items-center justify-center p-8">
                    <div className="flex flex-col items-center text-center max-w-[280px]">
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted/30 mb-4">
                        <Bot className="h-7 w-7 text-muted-foreground/70" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        Start {tab.name}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mb-4">
                        Select a working directory and start the assistant
                      </p>
                      <div className="flex flex-col gap-2 w-48">
                        <Select
                          value={pendingTabFolders[tab.id] || currentProject.folders?.[0]?.path || ""}
                          onValueChange={(value) => setPendingTabFolders(prev => ({ ...prev, [tab.id]: value }))}
                        >
                          <SelectTrigger>
                            <Folder className="h-3.5 w-3.5 mr-2 shrink-0" />
                            <SelectValue placeholder="Select a folder" />
                          </SelectTrigger>
                          <SelectContent>
                            {currentProject.folders?.map((folder) => (
                              <SelectItem key={folder.id} value={folder.path}>
                                {folder.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          onClick={() => {
                            const folder = pendingTabFolders[tab.id] || currentProject.folders?.[0]?.path;
                            if (folder) setTabCwd(tab.id, folder);
                          }}
                          className="w-full"
                        >
                          Start {tab.name}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          </div>

          {/* Empty state when no tabs */}
          {terminalTabs.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center p-8" style={{ backgroundColor: terminalBg }}>
              <div className="flex flex-col items-center text-center max-w-[280px]">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted/30 mb-4">
                  <Bot className="h-7 w-7 text-muted-foreground/70" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  No assistants running
                </p>
                <p className="text-xs text-muted-foreground/60 mb-4">
                  Start an AI coding assistant in a directory
                </p>
                {currentProject.folders && currentProject.folders.length > 1 ? (
                  /* Multi-folder: show both folder and assistant dropdowns */
                  <div className="flex flex-col gap-2 w-48">
                    <Select
                      value={pendingEmptyStateFolder || currentProject.folders?.[0]?.path || ""}
                      onValueChange={(value) => setPendingEmptyStateFolder(value)}
                    >
                      <SelectTrigger>
                        <Folder className="h-3.5 w-3.5 mr-2 shrink-0" />
                        <SelectValue placeholder="Select a folder" />
                      </SelectTrigger>
                      <SelectContent>
                        {currentProject.folders?.map((folder) => (
                          <SelectItem key={folder.id} value={folder.path}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button className="w-full gap-2">
                          <Plus className="h-3.5 w-3.5" />
                          New Assistant
                          <ChevronDown className="h-3 w-3 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="center">
                        {assistantOptions.filter(a => a.installed).length > 0 ? (
                          assistantOptions.filter(a => a.installed).map((assistant) => (
                            <DropdownMenuItem
                              key={assistant.id}
                              onClick={() => {
                                const folder = pendingEmptyStateFolder || currentProject.folders?.[0]?.path;
                                if (folder) doCreateTerminalTab(folder, assistant.id);
                              }}
                            >
                              {assistant.name}
                            </DropdownMenuItem>
                          ))
                        ) : (
                          <DropdownMenuItem disabled>
                            No assistants installed
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : (
                  /* Single folder: just assistant dropdown */
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2">
                        <Plus className="h-3.5 w-3.5" />
                        New Assistant
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center">
                      {assistantOptions.filter(a => a.installed).length > 0 ? (
                        assistantOptions.filter(a => a.installed).map((assistant) => (
                          <DropdownMenuItem
                            key={assistant.id}
                            onClick={() => currentProject && createNewTab(currentProject.path, assistant.id)}
                          >
                            {assistant.name}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <DropdownMenuItem disabled>
                          No assistants installed
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
        {/* Resize handle for shell panel - only show when assistant is visible */}
        {showShellPanel && showAssistantPanel && (
          <div
            className="w-1.5 shrink-0 cursor-col-resize"
            onMouseDown={(e) => handleResizeStart(e, 'shell')}
          />
        )}

        {/* Right sidebar - Utility terminal */}
        <div
          ref={shellPanelRef}
          role="region"
          aria-label="Shell panel"
          className={cn(
            "h-full flex flex-col overflow-hidden",
            panelShellClass,
            !showShellPanel && "hidden",
            !showAssistantPanel && "flex-1 min-w-0"
          )}
          style={showAssistantPanel ? { flex: `0 1 ${shellPanelWidth}px`, minWidth: 280 } : undefined}
          onDragOver={handlePanelDragOver}
          onDrop={handleShellPanelDrop}
        >
          {/* Header */}
          <div className="flex h-10 items-center justify-between px-3 text-muted-foreground/60">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {shellCwd && (
                <DropdownMenu onOpenChange={(open) => open && loadShellDirectories(shellCwd)}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2.5 rounded-full text-xs font-normal text-inherit hover:text-foreground min-w-0"
                    >
                      <Folder className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[120px]">
                        {shellCwd.split(/[/\\]/).pop() || "/"}
                      </span>
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-64 overflow-auto">
                    {shellDirs.map((dir) => (
                      <DropdownMenuItem
                        key={dir}
                        onClick={() => handleShellCd(dir)}
                        className="flex items-center gap-2"
                      >
                        <Folder className="h-3 w-3" />
                        <span className="truncate">{dir}</span>
                      </DropdownMenuItem>
                    ))}
                    {shellDirs.length === 0 && (
                      <DropdownMenuItem disabled>No subdirectories</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="flex items-center gap-1">
              {utilityTerminalId !== "closed" && (
                <>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Natural language terminal"
                        className={cn(
                          "h-7 w-7 shrink-0 text-inherit hover:text-foreground",
                          showNlt && "!text-primary"
                        )}
                        onClick={() => setShowNlt(!showNlt)}
                      >
                        <Sparkles className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Natural Language Terminal</TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Search history"
                        className="h-7 w-7 shrink-0 text-inherit hover:text-foreground"
                        onClick={() => {
                          loadShellHistory();
                          setShowHistorySearch(true);
                        }}
                      >
                        <Search className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Search history (Ctrl+R)</TooltipContent>
                  </Tooltip>
                </>
              )}
              {utilityTerminalId !== "closed" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Kill shell"
                  className="h-7 w-7 shrink-0"
                  onClick={() => {
                    if (utilityTerminalId) {
                      invoke("kill_terminal", { id: utilityTerminalId });
                    }
                    setUtilityTerminalId("closed");
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {/* Utility terminal content with AI */}
          <div
            className="flex-1 overflow-hidden"
            style={{ backgroundColor: terminalBg }}
          >
            {utilityTerminalId === "closed" ? (
              /* Shell was explicitly closed */
              currentProject.folders && currentProject.folders.length > 1 ? (
                /* Multi-folder: show folder picker to reopen */
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <div className="flex flex-col items-center text-center max-w-[200px]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-4">
                      <TerminalIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Shell closed
                    </p>
                    <p className="text-xs text-muted-foreground/70 mb-4">
                      Select a folder to reopen the shell
                    </p>
                    <div className="flex flex-col gap-2 w-44">
                      <Select
                        value={pendingShellFolder || currentProject.folders?.[0]?.path || ""}
                        onValueChange={(value) => setPendingShellFolder(value)}
                      >
                        <SelectTrigger>
                          <Folder className="h-3.5 w-3.5 mr-2 shrink-0" />
                          <SelectValue placeholder="Select a folder" />
                        </SelectTrigger>
                        <SelectContent>
                          {currentProject.folders?.map((folder) => (
                            <SelectItem key={folder.id} value={folder.path}>
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => {
                          const folder = pendingShellFolder || currentProject.folders?.[0]?.path;
                          if (folder) {
                            setShellCwd(folder);
                            setUtilityTerminalId(null);
                          }
                        }}
                        className="w-full"
                      >
                        Open Shell
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Single folder: simple reopen */
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <div className="flex flex-col items-center text-center max-w-[200px]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-4">
                      <TerminalIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Shell closed
                    </p>
                    <p className="text-xs text-muted-foreground/70 mb-4">
                      Run commands, scripts, and interact with your project
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUtilityTerminalId(null)}
                      className="gap-2"
                    >
                      <TerminalIcon className="h-3.5 w-3.5" />
                      Open Shell
                    </Button>
                  </div>
                </div>
              )
            ) : !shellCwd && currentProject.folders && currentProject.folders.length > 1 ? (
              /* Multi-folder project needs folder selection first */
                <div className="flex h-full flex-col items-center justify-center p-8">
                  <div className="flex flex-col items-center text-center max-w-[280px]">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted/30 mb-4">
                      <TerminalIcon className="h-7 w-7 text-muted-foreground/70" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Start Shell
                    </p>
                    <p className="text-xs text-muted-foreground/60 mb-4">
                      Select a working directory and start the shell
                    </p>
                    <div className="flex flex-col gap-2 w-48">
                      <Select
                        value={pendingShellFolder || currentProject.folders?.[0]?.path || ""}
                        onValueChange={(value) => setPendingShellFolder(value)}
                      >
                        <SelectTrigger>
                          <Folder className="h-3.5 w-3.5 mr-2 shrink-0" />
                          <SelectValue placeholder="Select a folder" />
                        </SelectTrigger>
                        <SelectContent>
                          {currentProject.folders?.map((folder) => (
                            <SelectItem key={folder.id} value={folder.path}>
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={() => {
                          const folder = pendingShellFolder || currentProject.folders?.[0]?.path;
                          if (folder) setShellCwd(folder);
                        }}
                        className="w-full"
                      >
                        Start Shell
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <SmartShell
                  key={currentProject.path}
                  cwd={shellCwd || currentProject.path}
                  terminalId={utilityTerminalId}
                  onTerminalReady={(id) => setUtilityTerminalId(id)}
                  onCwdChange={handleShellCwdChange}
                  visible={showShellPanel}
                  showNlt={showNlt}
                  onNltVisibilityChange={setShowNlt}
                />
              )}
          </div>
        </div>

        {/* Resize handle for notes panel */}
        {showNotesPanel && (
          <div
            className="w-1.5 shrink-0 cursor-col-resize"
            onMouseDown={(e) => handleResizeStart(e, 'notes')}
          />
        )}

        {/* Notes Panel */}
        <div
          role="region"
          aria-label="Notes panel"
          className={cn(
            "h-full flex flex-col overflow-hidden",
            panelShellClass,
            !showNotesPanel && "hidden"
          )}
          style={{ flex: `0 1 ${notesPanelWidth}px`, minWidth: 250 }}
        >
          <NotesPanel projectPath={currentProject.path} onNoteDropAtPosition={handleNoteDropAtPosition} />
        </div>

        {/* Resize handle for markdown panel */}
        {showMarkdownPanel && (
          <div
            className="w-1.5 shrink-0 cursor-col-resize"
            onMouseDown={(e) => handleResizeStart(e, 'markdown')}
          />
        )}

        {/* Right-most panel - Markdown Editor */}
        <div
          className={cn(
            "h-full flex flex-col overflow-hidden",
            panelShellClass,
            !showMarkdownPanel && "hidden",
            !showAssistantPanel && !showShellPanel && "flex-1 min-w-0"
          )}
          style={showAssistantPanel || showShellPanel ? { flex: `0 1 ${markdownPanelWidth}px`, minWidth: 300 } : undefined}
        >
          {/* Header */}
          <div className="relative flex h-10 items-center justify-between px-3 text-muted-foreground/60">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-xs truncate">
                {markdownFile?.path.split(/[/\\]/).pop() || 'No file'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {markdownFile && markdownFile.path.endsWith('.md') && (
                <>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={markdownEditMode ? "Preview" : "Edit"}
                        className={cn("h-7 w-7 text-inherit hover:text-foreground", markdownEditMode && "!text-primary")}
                        onClick={() => setMarkdownEditMode(!markdownEditMode)}
                      >
                        {markdownEditMode ? <Eye className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{markdownEditMode ? "Preview" : "Edit"}</TooltipContent>
                  </Tooltip>
                  {markdownEditMode && (
                    <Tooltip delayDuration={0}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Save"
                          className="h-7 w-7 text-inherit hover:text-foreground"
                          onClick={handleSaveMarkdown}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Save</TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
              {/* Show save button for non-markdown files */}
              {markdownFile && !markdownFile.path.endsWith('.md') && (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Save"
                      className="h-7 w-7 text-inherit hover:text-foreground"
                      onClick={handleSaveMarkdown}
                    >
                      <Save className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Save</TooltipContent>
                </Tooltip>
              )}
              {/* Show search button when Monaco editor is visible */}
              {markdownFile && (markdownEditMode || !markdownFile.path.endsWith('.md')) && (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Find"
                      className="h-7 w-7 text-inherit hover:text-foreground"
                      onClick={handleEditorFind}
                    >
                      <Search className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Find (⌘F)</TooltipContent>
                </Tooltip>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close file panel"
                className="h-7 w-7 text-inherit hover:text-foreground"
                onClick={handleCloseMarkdownPanel}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {markdownFile ? (
              markdownEditMode ? (
                <Editor
                  height="100%"
                  language={getMonacoLanguage(markdownFile.path)}
                  value={markdownFile.content}
                  onChange={(value) => setMarkdownFile({ ...markdownFile, content: value || '' })}
                  beforeMount={(monaco) => defineMonacoThemes(monaco, customTheme)}
                  theme={getMonacoTheme(theme)}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fixedOverflowWidgets: true,
                  }}
                />
              ) : markdownFile.path.endsWith('.md') ? (
                <article className="prose prose-sm max-w-none p-4 overflow-auto h-full">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {markdownFile.content}
                  </ReactMarkdown>
                </article>
              ) : (
                <Editor
                  height="100%"
                  language={getMonacoLanguage(markdownFile.path)}
                  value={markdownFile.content}
                  onChange={(value) => setMarkdownFile({ ...markdownFile, content: value || '' })}
                  beforeMount={(monaco) => defineMonacoThemes(monaco, customTheme)}
                  theme={getMonacoTheme(theme)}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fixedOverflowWidgets: true,
                  }}
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                No file open
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Settings Sheet */}
      <SettingsSheet
        open={showSettings}
        onOpenChange={(open) => {
          setShowSettings(open);
          if (!open) {
            setActiveSidebarItem("terminal");
          }
        }}
      />

      {/* Shell History Search */}
      <CommandDialog open={showHistorySearch} onOpenChange={setShowHistorySearch}>
        <CommandInput placeholder="Search shell history..." />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="Recent Commands">
            {shellHistory.map((cmd, index) => (
              <CommandItem
                key={`${cmd}-${index}`}
                value={cmd}
                onSelect={() => handleHistorySelect(cmd)}
                className="font-mono text-xs"
              >
                {cmd}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {/* Global File Search */}
      <CommandDialog open={showFileSearch} onOpenChange={(open) => {
        if (!open) handleCloseFileSearch();
        else setShowFileSearch(true);
      }}>
        <CommandInput
          placeholder="Search files and content..."
          value={fileSearchQuery}
          onValueChange={handleFileSearchChange}
        />
        <CommandList className="max-h-[400px]">
          <CommandEmpty>
            {isSearchingContent ? "Searching..." : "No results found."}
          </CommandEmpty>
          {fileNameMatches.length > 0 && (
            <CommandGroup heading={fileSearchQuery.trim() ? "File Names" : "Files"}>
              {fileNameMatches.map((match, index) => (
                <CommandItem
                  key={`file-${match.path}-${index}`}
                  value={`file:${match.path}`}
                  onSelect={() => handleFileSearchResultClick(match)}
                  className="flex items-center gap-2"
                >
                  {match.isDir ? (
                    <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate">{match.name}</span>
                  <span className="text-xs text-muted-foreground truncate ml-auto">
                    {match.path}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {contentSearchResults.length > 0 && (
            <CommandGroup heading={`Content Matches${contentSearchTruncated ? " (50+)" : ""}`}>
              {contentSearchResults.map((match, index) => (
                <CommandItem
                  key={`content-${match.absolutePath}-${match.lineNumber}-${index}`}
                  value={`content:${match.absolutePath}:${match.lineNumber}`}
                  onSelect={() => handleContentMatchClick(match)}
                  className="flex flex-col items-start gap-0.5"
                >
                  <div className="flex items-center gap-2 w-full">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate">{match.path}</span>
                    <span className="text-xs text-muted-foreground">:{match.lineNumber}</span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate w-full pl-6 font-mono">
                    {match.line.trim()}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {isSearchingContent && fileSearchQuery.length >= 2 && (
            <div className="py-2 px-4 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Searching content...
            </div>
          )}
        </CommandList>
      </CommandDialog>

      {/* New Branch Dialog */}
      <Dialog open={showBranchDialog} onOpenChange={setShowBranchDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create new branch</DialogTitle>
            <DialogDescription>
              Create a new branch from {currentBranch?.name || "current branch"}
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Branch name"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newBranchName.trim()) {
                handleCreateBranch();
              }
            }}
          />
          <DialogFooter>
            <Button onClick={handleCreateBranch} disabled={!newBranchName.trim() || isCreatingBranch}>
              {isCreatingBranch ? "Creating..." : "Create branch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Onboarding */}
      {!hasSeenOnboarding && (
        <Onboarding onComplete={() => setHasSeenOnboarding(true)} />
      )}
    </div>
  );
}
