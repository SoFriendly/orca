import { useEffect, useState, useRef, useCallback, type WheelEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Settings,
  Terminal as TerminalIcon,
  X,
  HelpCircle,
  Plus,
  Bot,
  GitBranch,
  Folder,
  FolderOpen,
  ChevronDown,
  Search,
  Sparkles,
  FileText,
  Pencil,
  Save,
  Eye,
  StickyNote,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { ChellIcon } from "@/components/icons/ChellIcon";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import NotesPanel from "@/components/NotesPanel";
import SettingsSheet from "@/components/SettingsSheet";
import { useProjectStore, ensureFolders } from "@/stores/projectStore";
import { useGitStore } from "@/stores/gitStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import { getAllAssistants, getAllAssistantCommands } from "@/lib/assistants";
import type { Project, GitStatus, FileDiff, Branch, Commit, CustomThemeColors, ProjectFolder, ProjectFileData } from "@/types";

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

// Define custom Monaco themes matching app themes
const defineMonacoThemes = (
  monaco: Parameters<NonNullable<Parameters<typeof Editor>[0]['beforeMount']>>[0],
  customTheme?: CustomThemeColors
) => {
  // Dark theme (matches app dark theme)
  monaco.editor.defineTheme('chell-dark', {
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
      'editor.background': '#0d0d0d',
      'editor.foreground': '#e0e0e0',
      'editor.lineHighlightBackground': '#1a1a1a',
      'editor.selectionBackground': '#FF6B0040',
      'editorCursor.foreground': '#FF6B00',
      'editorLineNumber.foreground': '#6272a4',
      'editorLineNumber.activeForeground': '#f8f8f2',
      'editor.findMatchBackground': '#FF6B0060',
      'editor.findMatchHighlightBackground': '#FF6B0030',
    },
  });

  // Tokyo Night theme
  monaco.editor.defineTheme('chell-tokyo', {
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
      'editor.background': '#1a1b26',
      'editor.foreground': '#c0caf5',
      'editor.lineHighlightBackground': '#24283b',
      'editor.selectionBackground': '#7aa2f740',
      'editorCursor.foreground': '#7aa2f7',
      'editorLineNumber.foreground': '#414868',
      'editorLineNumber.activeForeground': '#c0caf5',
      'editor.findMatchBackground': '#7aa2f760',
      'editor.findMatchHighlightBackground': '#7aa2f730',
    },
  });

  // Light theme
  monaco.editor.defineTheme('chell-light', {
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
      'editor.background': '#fafafa',
      'editor.foreground': '#383a42',
      'editor.lineHighlightBackground': '#f0f0f0',
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

    monaco.editor.defineTheme('chell-custom', {
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
    case 'tokyo': return 'chell-tokyo';
    case 'light': return 'chell-light';
    case 'custom': return 'chell-custom';
    default: return 'chell-dark';
  }
};

interface TerminalTab {
  id: string;
  name: string;
  command: string;  // Command to run (empty for shell)
  terminalId: string | null;  // Set by Terminal component after spawning
  cwd?: string;  // Working directory for this terminal - empty means needs selection (Issue #6)
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
  const { projects, openTab, addFolderToProject, updateProject, addProject } = useProjectStore();
  const { setStatus, setDiffs, setBranches, setHistory, setLoading } = useGitStore();
  const { assistantArgs, defaultAssistant, autoFetchRemote, theme, customTheme, customAssistants, hiddenAssistantIds } = useSettingsStore();

  // Terminal background colors per theme
  const terminalBgColors: Record<string, string> = {
    dark: "#0d0d0d",
    tokyo: "#1a1b26",
    light: "#fafafa",
  };
  const terminalBg = terminalBgColors[theme] || terminalBgColors.dark;

  // Set webview background color to match theme (prevents white flash on resize)
  useEffect(() => {
    const bgColor = terminalBgColors[theme] || terminalBgColors.dark;
    getCurrentWebview().setBackgroundColor(bgColor).catch(() => {});
  }, [theme]);

  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [utilityTerminalId, setUtilityTerminalId] = useState<string | null>(null);
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
  const [markdownFile, setMarkdownFile] = useState<{ path: string; content: string } | null>(null);
  const [markdownEditMode, setMarkdownEditMode] = useState(false);
  const [shellCwd, setShellCwd] = useState<string>("");
  const [shellDirs, setShellDirs] = useState<string[]>([]);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  const [showNlt, setShowNlt] = useState(false);
  // Track selected folders for tabs pending folder selection (Issue #6)
  const [pendingTabFolders, setPendingTabFolders] = useState<Record<string, string>>({});
  const [pendingShellFolder, setPendingShellFolder] = useState<string>("");
  const [pendingEmptyStateFolder, setPendingEmptyStateFolder] = useState<string>("");
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Count visible panels - must always have at least one
  const visiblePanelCount = [showGitPanel, showAssistantPanel, showShellPanel, showNotesPanel, showMarkdownPanel].filter(Boolean).length;

  // Toggle handlers
  const toggleGitPanel = () => {
    if (showGitPanel && visiblePanelCount <= 1) return;
    if (showGitPanel) {
      savedGitWidth.current = gitPanelWidth;
      setGitPanelWidth(0);
    } else {
      setGitPanelWidth(savedGitWidth.current);
    }
    setShowGitPanel(!showGitPanel);
  };

  const toggleAssistantPanel = () => {
    if (showAssistantPanel && visiblePanelCount <= 1) return;
    setShowAssistantPanel(!showAssistantPanel);
  };

  const toggleShellPanel = () => {
    if (showShellPanel && visiblePanelCount <= 1) return;
    if (showShellPanel) {
      savedShellWidth.current = shellPanelWidth;
      setShellPanelWidth(0);
    } else {
      setShellPanelWidth(savedShellWidth.current);
    }
    setShowShellPanel(!showShellPanel);
  };

  const toggleNotesPanel = () => {
    if (showNotesPanel && visiblePanelCount <= 1) return;
    if (showNotesPanel) {
      savedNotesWidth.current = notesPanelWidth;
      setNotesPanelWidth(0);
    } else {
      setNotesPanelWidth(savedNotesWidth.current);
    }
    setShowNotesPanel(!showNotesPanel);
  };

  // Markdown panel handlers
  const handleOpenMarkdownInPanel = async (filePath: string) => {
    try {
      const content = await invoke<string>("read_text_file", { path: filePath });
      setMarkdownFile({ path: filePath, content });

      // Expand window to accommodate the panel if not already showing
      if (!showMarkdownPanel) {
        const window = getCurrentWindow();
        const scaleFactor = await window.scaleFactor();
        const physicalSize = await window.innerSize();
        const logicalWidth = physicalSize.width / scaleFactor;
        const logicalHeight = physicalSize.height / scaleFactor;
        const panelWidth = savedMarkdownWidth.current + 5; // +5 for resize handle
        await window.setSize(new LogicalSize(logicalWidth + panelWidth, logicalHeight));
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
    try {
      await invoke("write_text_file", {
        path: markdownFile.path,
        content: markdownFile.content
      });
      toast.success("File saved");
      setMarkdownEditMode(false);
    } catch (err) {
      toast.error(`Failed to save: ${err}`);
    }
  };

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor, monaco: typeof import("monaco-editor")) => {
    editorRef.current = editor;

    // Add Cmd/Ctrl+S keyboard shortcut for save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveMarkdown();
    });
  };

  const handleEditorFind = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      editorRef.current.trigger('keyboard', 'actions.find', null);
    }
  };

  const handleCloseMarkdownPanel = async () => {
    // Save width and close panel first
    savedMarkdownWidth.current = markdownPanelWidth;
    setMarkdownFile(null);
    setShowMarkdownPanel(false);

    // Then shrink window (don't block on this)
    try {
      const window = getCurrentWindow();
      const scaleFactor = await window.scaleFactor();
      const physicalSize = await window.innerSize();
      const logicalWidth = physicalSize.width / scaleFactor;
      const logicalHeight = physicalSize.height / scaleFactor;
      const panelWidth = markdownPanelWidth + 5; // +5 for resize handle
      await window.setSize(new LogicalSize(logicalWidth - panelWidth, logicalHeight));
    } catch (err) {
      console.error("Failed to resize window:", err);
    }
  };

  // Navigate to home screen
  const handleGoHome = () => {
    navigate("/");
  };

  // Resize handle drag handler
  const handleResizeStart = (e: React.MouseEvent, panel: 'git' | 'shell' | 'notes' | 'markdown') => {
    e.preventDefault();
    const startX = e.clientX;
    const startGitWidth = gitPanelWidth;
    const startAssistantWidth = assistantPanelWidth;
    const startShellWidth = shellPanelWidth;
    const startNotesWidth = notesPanelWidth;
    const startMarkdownWidth = markdownPanelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      if (panel === 'git') {
        // Git resize: adjust git and assistant panels
        const newGitWidth = Math.max(150, Math.min(500, startGitWidth + delta));
        const newAssistantWidth = Math.max(200, startAssistantWidth - (newGitWidth - startGitWidth));
        setGitPanelWidth(newGitWidth);
        setAssistantPanelWidth(newAssistantWidth);
      } else if (panel === 'shell') {
        // Shell resize: adjust shell and assistant panels
        const newShellWidth = Math.max(150, Math.min(600, startShellWidth - delta));
        const newAssistantWidth = Math.max(200, startAssistantWidth + (startShellWidth - newShellWidth));
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
    }
  };

  // Handle drops on the shell panel (utility terminal)
  const handleShellPanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const filePath = e.dataTransfer.getData("text/plain");
    if (!filePath) return;

    if (utilityTerminalId && utilityTerminalId !== "closed") {
      invoke("write_terminal", { id: utilityTerminalId, data: filePath + " " });
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
      }
    } else if (shellRect && x >= shellRect.left && x <= shellRect.right &&
               y >= shellRect.top && y <= shellRect.bottom) {
      if (utilityTerminalId && utilityTerminalId !== "closed") {
        invoke("write_terminal", { id: utilityTerminalId, data: text });
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
          }
        } else if (shellRect && position.x >= shellRect.left && position.x <= shellRect.right &&
                   position.y >= shellRect.top && position.y <= shellRect.bottom) {
          // Dropped on shell panel
          if (utilityTerminalId && utilityTerminalId !== "closed") {
            invoke("write_terminal", { id: utilityTerminalId, data: escapedPaths });
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
  const [notesPanelWidth, setNotesPanelWidth] = useState(320);
  const savedGitWidth = useRef(280);
  const savedAssistantWidth = useRef(520);
  const savedShellWidth = useRef(400);
  const savedMarkdownWidth = useRef(400);
  const savedNotesWidth = useRef(320);
  const lastContainerWidth = useRef<number | null>(null);

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

      // Only adjust if width changed significantly
      if (Math.abs(newWidth - oldWidth) > 5) {
        const ratio = newWidth / oldWidth;

        // Proportionally adjust all panel widths
        setGitPanelWidth(prev => Math.max(150, Math.round(prev * ratio)));
        setAssistantPanelWidth(prev => Math.max(200, Math.round(prev * ratio)));
        setShellPanelWidth(prev => Math.max(150, Math.round(prev * ratio)));
        setNotesPanelWidth(prev => Math.max(250, Math.round(prev * ratio)));
        setMarkdownPanelWidth(prev => Math.max(150, Math.round(prev * ratio)));

        // Update saved widths too
        savedGitWidth.current = Math.max(150, Math.round(savedGitWidth.current * ratio));
        savedAssistantWidth.current = Math.max(200, Math.round(savedAssistantWidth.current * ratio));
        savedShellWidth.current = Math.max(150, Math.round(savedShellWidth.current * ratio));
        savedNotesWidth.current = Math.max(250, Math.round(savedNotesWidth.current * ratio));
        savedMarkdownWidth.current = Math.max(150, Math.round(savedMarkdownWidth.current * ratio));

        lastContainerWidth.current = newWidth;
      }
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  // Trigger terminal resize when panel visibility changes
  useEffect(() => {
    // Small delay to let the layout settle, then trigger resize
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showGitPanel, showAssistantPanel, showShellPanel, showNotesPanel]);

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

  // Check installed assistants on mount
  useEffect(() => {
    const checkAssistants = async () => {
      const commands = getAllAssistantCommands(customAssistants);
      const installed = await invoke<string[]>("check_commands_installed", { commands });
      setInstalledAssistants(installed);
    };
    checkAssistants();
  }, [customAssistants]);

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
    try {
      const history = await invoke<string[]>("get_shell_history", { limit: 500 });
      setShellHistory(history.reverse()); // Most recent first
    } catch (error) {
      console.error("Failed to load shell history:", error);
      setShellHistory([]);
    }
  };

  const handleHistorySelect = (command: string) => {
    if (!utilityTerminalId || utilityTerminalId === "closed") return;
    invoke("write_terminal", { id: utilityTerminalId, data: command });
    setShowHistorySearch(false);
  };

  const handleShellCd = async (dirName: string) => {
    if (!utilityTerminalId || utilityTerminalId === "closed") return;

    let newPath: string;
    if (dirName === "..") {
      // Go up one directory
      const parts = shellCwd.split("/").filter(Boolean);
      parts.pop();
      newPath = "/" + parts.join("/");
    } else {
      newPath = `${shellCwd}/${dirName}`;
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

  // Save project as .chell file (Issue #6)
  const handleSaveProject = async () => {
    if (!currentProject) return;

    const filePath = await save({
      defaultPath: `${currentProject.name}.chell`,
      filters: [{ name: "Chell Project", extensions: ["chell"] }],
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
      const newTab: TerminalTab = {
        id: tabId,
        name,
        command,  // Store command, Terminal will spawn with correct dimensions
        terminalId: null,  // Will be set by Terminal component
        cwd,  // Working directory for this terminal
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

      const [status, diffs, branches, history] = await Promise.all([
        invoke<GitStatus>("get_status", { repoPath: path }),
        invoke<FileDiff[]>("get_diff", { repoPath: path }),
        invoke<Branch[]>("get_branches", { repoPath: path }),
        invoke<Commit[]>("get_history", { repoPath: path, limit: 50 }),
      ]);
      setStatus(status);
      setDiffs(diffs);
      setBranches(branches);
      setHistory(history);
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

  const refreshGitData = useCallback(async () => {
    const path = currentProjectPathRef.current;
    if (path) {
      // Fetch from remote first to get new branches
      try {
        await invoke("fetch_remote", { repoPath: path, remote: "origin" });
      } catch {
        // Silently continue - fetch may fail if no remote configured
      }
      loadGitData(path);
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
      {/* Single horizontal divider line spanning full width */}
      <div className="absolute left-0 right-0 top-10 h-px bg-border" />
      {/* Vertical divider for sidebar */}
      <div className="absolute left-12 top-10 bottom-0 w-px bg-border" />

      {/* Left icon sidebar */}
      <div
        className="flex w-12 flex-col bg-background pt-8 pb-3"
      >
        {/* Inner container */}
        <div className="flex flex-1 flex-col items-center mt-[9px] pt-3">
          {/* Top icons */}
          <div className="flex flex-col items-center gap-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveSidebarItem("terminal")}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  activeSidebarItem === "terminal"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <ChellIcon className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{currentProject?.name}</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleGoHome}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                    directory: false,
                    multiple: false,
                    title: "Open Workspace",
                    filters: [{ name: "Chell Project", extensions: ["chell"] }],
                  });
                  if (selected && typeof selected === "string") {
                    const projectData = await invoke<ProjectFileData>("load_project_file", { path: selected });
                    const primaryPath = projectData.folders[0]?.path || "";
                    if (!primaryPath) {
                      toast.error("Project file has no folders");
                      return;
                    }
                    // Check if project with this path already exists
                    const existingProject = projects.find(p => p.path === primaryPath);
                    if (existingProject) {
                      // Update existing project with new folders from .chell file
                      const updatedProject = {
                        ...existingProject,
                        name: projectData.name,
                        folders: projectData.folders,
                        lastOpened: new Date().toISOString(),
                      };
                      updateProject(existingProject.id, updatedProject);
                      await invoke("add_project", { project: updatedProject });
                      navigate(`/project/${existingProject.id}`);
                    } else {
                      // Create new project
                      const project: Project = {
                        id: crypto.randomUUID(),
                        name: projectData.name,
                        path: primaryPath,
                        folders: projectData.folders,
                        lastOpened: new Date().toISOString(),
                      };
                      addProject(project);
                      await invoke("add_project", { project });
                      navigate(`/project/${project.id}`);
                    }
                  }
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FolderOpen className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open Workspace</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  setActiveSidebarItem("settings");
                  setShowSettings(true);
                }}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  activeSidebarItem === "settings"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
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

        {/* Panel toggle icons */}
        <div className="flex flex-col items-center gap-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={toggleGitPanel}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  showGitPanel
                    ? "text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground",
                  // Dim the button if it's the last visible panel
                  showGitPanel && visiblePanelCount <= 1 && "opacity-50 cursor-not-allowed"
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
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  showAssistantPanel
                    ? "text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground",
                  showAssistantPanel && visiblePanelCount <= 1 && "opacity-50 cursor-not-allowed"
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
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  showShellPanel
                    ? "text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground",
                  showShellPanel && visiblePanelCount <= 1 && "opacity-50 cursor-not-allowed"
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
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  showNotesPanel
                    ? "text-foreground"
                    : "text-muted-foreground/50 hover:text-muted-foreground",
                  showNotesPanel && visiblePanelCount <= 1 && "opacity-50 cursor-not-allowed"
                )}
              >
                <StickyNote className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {showNotesPanel && visiblePanelCount <= 1
                ? "Can't hide last panel"
                : showNotesPanel ? "Hide Notes" : "Show Notes"}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Bottom icons */}
        <div className="flex flex-col items-center gap-1 mt-2">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <HelpCircle className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Help</TooltipContent>
          </Tooltip>
        </div>
        </div>
      </div>

      {/* Main content area */}
      <div
        ref={containerRef}
        className="flex-1 flex overflow-hidden"
      >
        {/* Left sidebar - Git panel */}
        <div
          className={cn("h-full flex flex-col overflow-hidden", !showGitPanel && "hidden")}
          style={{ width: gitPanelWidth, minWidth: 200 }}
        >
          <GitPanel
            projectPath={currentProject.path}
            projectName={currentProject.name}
            isGitRepo={isGitRepo}
            onRefresh={refreshGitData}
            onInitRepo={initGitRepo}
            onOpenMarkdown={handleOpenMarkdownInPanel}
            shellCwd={shellCwd}
            folders={currentProject.folders}
            onAddFolder={handleAddFolder}
            workspaceName={currentProject.name}
            onRenameWorkspace={handleRenameWorkspace}
            onSaveWorkspace={handleSaveProject}
          />
        </div>
        {/* Resize handle for git panel */}
        {showGitPanel && (
          <div
            className="w-1 bg-border hover:bg-primary/50 cursor-col-resize shrink-0"
            onMouseDown={(e) => handleResizeStart(e, 'git')}
          />
        )}

        {/* Center - Terminal area */}
        <div
          ref={assistantPanelRef}
          className={cn(
            "h-full overflow-hidden",
            !showAssistantPanel && "hidden"
          )}
          style={{ flex: `1 1 ${assistantPanelWidth}px`, minWidth: 200 }}
          onDragOver={handlePanelDragOver}
          onDrop={handleAssistantPanelDrop}
        >
          <div className="flex h-full flex-col select-none overflow-hidden">
          {/* Tab bar */}
          <div className="flex h-10 items-center border-b border-border">
            <div
              ref={tabListRef}
              className="tab-scroll flex flex-1 items-center"
              onWheel={handleTabWheel}
            >
              <div className="flex min-w-max items-center">
                {terminalTabs.map((tab) => (
                  <div
                    key={tab.id}
                    data-tab-item
                    ref={(el) => {
                      if (el) tabRefs.current.set(tab.id, el);
                      else tabRefs.current.delete(tab.id);
                    }}
                    className={cn(
                      "group flex items-center gap-1 border-r border-border px-3 py-2 text-sm font-medium transition-colors cursor-grab shrink-0",
                      activeTabId === tab.id
                        ? "border-b-2 border-b-primary bg-muted/50 text-foreground"
                        : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                      draggingTabId === tab.id && "opacity-60 cursor-grabbing",
                      dragOverTabId === tab.id && draggingTabId !== tab.id && "bg-muted/40"
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
                    className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
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
                  className="flex h-full items-center px-3 py-2 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
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
          {[...terminalTabs].sort((a, b) => a.id.localeCompare(b.id)).map((tab) => (
            <div
              key={tab.id}
              className={cn(
                "flex flex-1 flex-col overflow-hidden",
                activeTabId !== tab.id && "hidden"
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
        {/* Resize handle for shell panel */}
        {showShellPanel && (
          <div
            className="w-1 bg-border hover:bg-primary/50 cursor-col-resize shrink-0"
            onMouseDown={(e) => handleResizeStart(e, 'shell')}
          />
        )}

        {/* Right sidebar - Utility terminal */}
        <div
          ref={shellPanelRef}
          className={cn(
            "h-full flex flex-col overflow-hidden",
            !showShellPanel && "hidden",
            !showAssistantPanel && "flex-1 min-w-0"
          )}
          style={showAssistantPanel ? { width: shellPanelWidth, minWidth: 200 } : undefined}
          onDragOver={handlePanelDragOver}
          onDrop={handleShellPanelDrop}
        >
          {/* Header */}
          <div className="flex h-10 items-center justify-between px-2 border-b border-border">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <TerminalIcon className="h-4 w-4 shrink-0 text-primary" />
              {shellCwd && (
                <DropdownMenu onOpenChange={(open) => open && loadShellDirectories(shellCwd)}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground min-w-0"
                    >
                      <Folder className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[120px]">
                        {shellCwd.split("/").pop() || "/"}
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
              {utilityTerminalId && utilityTerminalId !== "closed" && (
                <>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "h-6 w-6 shrink-0",
                          showNlt && "text-primary"
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
                        className="h-6 w-6 shrink-0"
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
                  className="h-6 w-6 shrink-0"
                  onClick={() => {
                    if (utilityTerminalId) {
                      invoke("kill_terminal", { id: utilityTerminalId });
                    }
                    setUtilityTerminalId("closed");
                  }}
                >
                  <X className="h-3 w-3" />
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
            className="w-1 bg-border hover:bg-primary/50 cursor-col-resize shrink-0"
            onMouseDown={(e) => handleResizeStart(e, 'notes')}
          />
        )}

        {/* Notes Panel */}
        <div
          className={cn(
            "h-full flex flex-col overflow-hidden shrink-0",
            !showNotesPanel && "hidden"
          )}
          style={{ width: notesPanelWidth, minWidth: 250 }}
        >
          <NotesPanel projectPath={currentProject.path} onNoteDropAtPosition={handleNoteDropAtPosition} />
        </div>

        {/* Resize handle for markdown panel */}
        {showMarkdownPanel && (
          <div
            className="w-1 bg-border hover:bg-primary/50 cursor-col-resize shrink-0"
            onMouseDown={(e) => handleResizeStart(e, 'markdown')}
          />
        )}

        {/* Right-most panel - Markdown Editor */}
        <div
          className={cn(
            "h-full flex flex-col overflow-hidden shrink-0",
            !showMarkdownPanel && "hidden"
          )}
          style={{ width: markdownPanelWidth }}
        >
          {/* Header */}
          <div className="flex h-10 items-center justify-between px-2 border-b border-border">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span className="text-xs truncate">
                {markdownFile?.path.split('/').pop() || 'No file'}
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
                        className={cn("h-6 w-6", markdownEditMode && "text-primary hover:text-primary")}
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
                          className="h-6 w-6"
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
                      className="h-6 w-6"
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
                      className="h-6 w-6"
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
                className="h-6 w-6"
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
      </div>

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
    </div>
  );
}