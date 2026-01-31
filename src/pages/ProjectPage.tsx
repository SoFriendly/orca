import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  Settings,
  Terminal as TerminalIcon,
  X,
  HelpCircle,
  Plus,
  Bot,
  GitBranch,
  PanelRightClose,
  Folder,
  ChevronDown,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import GitPanel from "@/components/GitPanel";
import SettingsSheet from "@/components/SettingsSheet";
import { useProjectStore } from "@/stores/projectStore";
import { useGitStore } from "@/stores/gitStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import type { Project, GitStatus, FileDiff, Branch, Commit } from "@/types";

interface TerminalTab {
  id: string;
  name: string;
  command: string;  // Command to run (empty for shell)
  terminalId: string | null;  // Set by Terminal component after spawning
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
  const { projects, openTab } = useProjectStore();
  const { setStatus, setDiffs, setBranches, setHistory, setLoading } = useGitStore();
  const { assistantArgs, defaultAssistant, autoFetchRemote, theme } = useSettingsStore();

  // Terminal background colors per theme
  const terminalBgColors: Record<string, string> = {
    dark: "#0d0d0d",
    tokyo: "#1a1b26",
    light: "#fafafa",
  };
  const terminalBg = terminalBgColors[theme] || terminalBgColors.dark;
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
  const [showAssistantPanel, setShowAssistantPanel] = useState(true);
  const [showShellPanel, setShowShellPanel] = useState(true);
  const [shellCwd, setShellCwd] = useState<string>("");
  const [shellDirs, setShellDirs] = useState<string[]>([]);
  const [showHistorySearch, setShowHistorySearch] = useState(false);
  const [shellHistory, setShellHistory] = useState<string[]>([]);

  // Count visible panels - must always have at least one
  const visiblePanelCount = [showGitPanel, showAssistantPanel, showShellPanel].filter(Boolean).length;

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

  // Open new window for another project
  const openNewWindow = async () => {
    try {
      const webview = new WebviewWindow(`chell-${Date.now()}`, {
        url: "/",
        title: "Chell",
        width: 1400,
        height: 900,
        center: true,
        titleBarStyle: "overlay",
        hiddenTitle: true,
        visible: false,
        backgroundColor: "#121212",
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
  const handleResizeStart = (e: React.MouseEvent, panel: 'git' | 'shell') => {
    e.preventDefault();
    const startX = e.clientX;
    const startGitWidth = gitPanelWidth;
    const startShellWidth = shellPanelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      if (panel === 'git') {
        const newWidth = Math.max(200, Math.min(500, startGitWidth + delta));
        setGitPanelWidth(newWidth);
      } else {
        const newWidth = Math.max(200, Math.min(600, startShellWidth - delta));
        setShellPanelWidth(newWidth);
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


  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const draggedFilePath = useRef<string | null>(null);

  // Use document-level listeners for more reliable drop handling
  useEffect(() => {
    const handleDrop = (e: DragEvent) => {
      if (!isDraggingFile || !draggedFilePath.current) return;

      e.preventDefault();
      const filePath = draggedFilePath.current;

      // Check which panel the drop occurred in
      const assistantRect = assistantPanelRef.current?.getBoundingClientRect();
      const shellRect = shellPanelRef.current?.getBoundingClientRect();

      if (assistantRect && showAssistantPanel &&
          e.clientX >= assistantRect.left && e.clientX <= assistantRect.right &&
          e.clientY >= assistantRect.top && e.clientY <= assistantRect.bottom) {
        const activeTab = terminalTabs.find(t => t.id === activeTabId);
        if (activeTab?.terminalId) {
          invoke("write_terminal", { id: activeTab.terminalId, data: filePath + " " });
        }
      } else if (shellRect && showShellPanel &&
          e.clientX >= shellRect.left && e.clientX <= shellRect.right &&
          e.clientY >= shellRect.top && e.clientY <= shellRect.bottom) {
        if (utilityTerminalId && utilityTerminalId !== "closed") {
          invoke("write_terminal", { id: utilityTerminalId, data: filePath + " " });
        }
      }

      setIsDraggingFile(false);
      draggedFilePath.current = null;
    };

    const handleDragOver = (e: DragEvent) => {
      if (isDraggingFile) {
        e.preventDefault();
      }
    };

    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragover', handleDragOver);

    return () => {
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('dragover', handleDragOver);
    };
  }, [isDraggingFile, terminalTabs, activeTabId, utilityTerminalId, showAssistantPanel, showShellPanel]);

  const handleFileDragStart = (filePath: string) => {
    setIsDraggingFile(true);
    draggedFilePath.current = filePath;
  };

  const handleFileDragEnd = () => {
    setIsDraggingFile(false);
    draggedFilePath.current = null;
  };

  const terminalsStarted = useRef(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const assistantPanelRef = useRef<HTMLDivElement>(null);
  const shellPanelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Panel widths in pixels (null means use flex)
  const [gitPanelWidth, setGitPanelWidth] = useState(280);
  const [shellPanelWidth, setShellPanelWidth] = useState(400);
  const savedGitWidth = useRef(280);
  const savedShellWidth = useRef(400);

  // Trigger terminal resize when panel visibility changes
  useEffect(() => {
    // Small delay to let the layout settle, then trigger resize
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [showGitPanel, showAssistantPanel, showShellPanel]);

  useEffect(() => {
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setCurrentProject(project);
      openTab(project);
      loadGitData(project.path);
    } else {
      loadProjectFromBackend();
    }
  }, [projectId, projects]);

  // Check installed assistants on mount
  useEffect(() => {
    const checkAssistants = async () => {
      const installed = await invoke<string[]>("check_installed_assistants");
      setInstalledAssistants(installed);
    };
    checkAssistants();
  }, []);

  // Auto-start terminals when project loads
  useEffect(() => {
    if (currentProject && !terminalsStarted.current) {
      terminalsStarted.current = true;
      startTerminals(currentProject.path);
    }
  }, [currentProject]);

  // Initialize shell cwd when project loads
  useEffect(() => {
    if (currentProject) {
      setShellCwd(currentProject.path);
      loadShellDirectories(currentProject.path);
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

  // Handle file drag and drop into terminals
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

  // Focus input when editing starts
  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  const getAssistantOptions = (): AssistantOption[] => {
    return [
      {
        id: "claude",
        name: "Claude Code",
        command: "claude",
        icon: <Bot className="h-4 w-4" />,
        installed: installedAssistants.includes("claude"),
      },
      {
        id: "aider",
        name: "Aider",
        command: "aider",
        icon: <Bot className="h-4 w-4" />,
        installed: installedAssistants.includes("aider"),
      },
      {
        id: "gemini",
        name: "Gemini CLI",
        command: "gemini",
        icon: <Bot className="h-4 w-4" />,
        installed: installedAssistants.includes("gemini"),
      },
      {
        id: "codex",
        name: "OpenAI Codex",
        command: "codex",
        icon: <Bot className="h-4 w-4" />,
        installed: installedAssistants.includes("codex"),
      },
      {
        id: "shell",
        name: "Shell",
        command: "",
        icon: <TerminalIcon className="h-4 w-4" />,
        installed: true,
      },
    ];
  };

  // Callback when Terminal component spawns its PTY
  const handleTerminalReady = (tabId: string, newTerminalId: string) => {
    setTerminalTabs(prev =>
      prev.map(tab =>
        tab.id === tabId ? { ...tab, terminalId: newTerminalId } : tab
      )
    );
  };

  const createNewTab = async (_projectPath: string, assistantId?: string) => {
    try {
      // Check installed assistants fresh (don't rely on stale state)
      const currentInstalled = await invoke<string[]>("check_installed_assistants");

      let command = "";
      let name = "Shell";

      // Use provided assistantId, or fall back to default from settings
      const targetAssistant = assistantId || defaultAssistant;

      if (targetAssistant && targetAssistant !== "shell") {
        const isInstalled = currentInstalled.includes(targetAssistant);

        if (isInstalled) {
          // Use the target assistant
          const options = getAssistantOptions();
          const assistant = options.find(a => a.id === targetAssistant);
          if (assistant) {
            command = assistant.command;
            name = assistant.name;
            const argsKey = targetAssistant === "claude" ? "claude-code" : targetAssistant;
            const args = assistantArgs[argsKey] || "";
            invoke("debug_log", { message: `createNewTab - argsKey: ${argsKey}, args: "${args}"` });
            if (args) command = `${command} ${args}`;
            invoke("debug_log", { message: `createNewTab - final command: "${command}"` });
          }
        } else {
          // Fall back to first installed assistant if default isn't installed
          const fallbackId = currentInstalled.find(id => id !== "shell");
          if (fallbackId) {
            const options = getAssistantOptions();
            const assistant = options.find(a => a.id === fallbackId);
            if (assistant) {
              command = assistant.command;
              name = assistant.name;
              const argsKey = fallbackId === "claude" ? "claude-code" : fallbackId;
              const args = assistantArgs[argsKey] || "";
              if (args) command = `${command} ${args}`;
            }
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
        setCurrentProject(project);
        openTab(project);
        loadGitData(project.path);
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

  const refreshGitData = useCallback(() => {
    if (currentProject) {
      loadGitData(currentProject.path);
    }
  }, [currentProject]);

  useEffect(() => {
    const unlisten = listen("git-refresh", () => {
      refreshGitData();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [currentProject]);

  // Auto-fetch remote when enabled (every 60 seconds)
  useEffect(() => {
    if (!autoFetchRemote || !currentProject) return;

    const fetchRemote = async () => {
      try {
        await invoke("fetch_remote", { repoPath: currentProject.path, remote: "origin" });
        refreshGitData();
      } catch (error) {
        // Silently fail - this is background operation
        console.error("Auto-fetch failed:", error);
      }
    };

    // Initial fetch
    fetchRemote();

    // Set up interval for periodic fetching
    const interval = setInterval(fetchRemote, 60000);

    return () => clearInterval(interval);
  }, [autoFetchRemote, currentProject, refreshGitData]);

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
          if (!target.closest('button, a, input, [role="button"]')) {
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
                <TerminalIcon className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Terminal</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={openNewWindow}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open New Window</TooltipContent>
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
                <PanelRightClose className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {showShellPanel && visiblePanelCount <= 1
                ? "Can't hide last panel"
                : showShellPanel ? "Hide Shell" : "Show Shell"}
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
          className={cn("h-full flex flex-col overflow-hidden shrink-0", !showGitPanel && "hidden")}
          style={{ width: gitPanelWidth }}
        >
          <GitPanel
            projectPath={currentProject.path}
            projectName={currentProject.name}
            onRefresh={refreshGitData}
            onFileDragStart={handleFileDragStart}
            onFileDragEnd={handleFileDragEnd}
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
            "flex-1 h-full overflow-hidden min-w-0",
            !showAssistantPanel && "hidden",
            isDraggingFile && "ring-2 ring-primary ring-inset"
          )}
        >
          <div className="flex h-full flex-col select-none overflow-hidden">
          {/* Tab bar */}
          <div className="flex h-10 items-center border-b border-border">
            <div className="flex flex-1 items-center overflow-x-auto">
              {terminalTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={cn(
                    "group flex items-center gap-1 border-r border-border px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                    activeTabId === tab.id
                      ? "border-b-2 border-b-primary bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                  )}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
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

          {/* Tab content - keep all terminals mounted, hide with CSS */}
          {terminalTabs.map((tab, index) => (
            <div
              key={tab.id}
              className={cn(
                "flex flex-1 flex-col overflow-hidden",
                // Show this tab if it's active, or if no tab is active show the first one
                !(activeTabId === tab.id || (activeTabId === null && index === 0)) && "hidden"
              )}
            >
              <div
                className={cn("flex-1 overflow-hidden", isDraggingFile && "pointer-events-none")}
                style={{ backgroundColor: terminalBg }}
              >
                <Terminal
                  id={tab.terminalId || undefined}
                  command={tab.command}
                  cwd={currentProject.path}
                  onTerminalReady={(terminalId) => handleTerminalReady(tab.id, terminalId)}
                  visible={showAssistantPanel && activeTabId === tab.id}
                  autoFocusOnWindowFocus
                />
              </div>
            </div>
          ))}

          {/* Empty state when no tabs */}
          {terminalTabs.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ backgroundColor: terminalBg }}>
              <TerminalIcon className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Create a new assistant tab to start coding...</p>
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
            !showAssistantPanel ? "flex-1 min-w-0" : "shrink-0",
            isDraggingFile && "ring-2 ring-primary ring-inset"
          )}
          style={showAssistantPanel ? { width: shellPanelWidth } : undefined}
        >
          {/* Header */}
          <div className="flex h-10 items-center justify-between px-2 border-b border-border">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <TerminalIcon className="h-4 w-4 shrink-0 text-primary" />
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
            </div>
            <div className="flex items-center gap-1">
              {utilityTerminalId && utilityTerminalId !== "closed" && (
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

          {/* Utility terminal content */}
          <div
            className={cn("flex-1 overflow-hidden", isDraggingFile && "pointer-events-none")}
            style={{ backgroundColor: terminalBg }}
          >
            {utilityTerminalId !== "closed" ? (
              <Terminal
                id={utilityTerminalId || undefined}
                command=""
                cwd={currentProject.path}
                onTerminalReady={(id) => setUtilityTerminalId(id)}
                visible={showShellPanel}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <TerminalIcon className="h-6 w-6 text-muted-foreground" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUtilityTerminalId(null)}
                >
                  Start Shell
                </Button>
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
