import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Settings,
  Terminal as TerminalIcon,
  X,
  HelpCircle,
  Plus,
  Bot,
  GitBranch,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
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
  terminalId: string | null;
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

  // Count visible panels - must always have at least one
  const visiblePanelCount = [showGitPanel, showAssistantPanel, showShellPanel].filter(Boolean).length;

  // Toggle handlers that prevent hiding the last panel
  const toggleGitPanel = () => {
    if (showGitPanel && visiblePanelCount <= 1) return;
    setShowGitPanel(!showGitPanel);
  };

  const toggleAssistantPanel = () => {
    if (showAssistantPanel && visiblePanelCount <= 1) return;
    setShowAssistantPanel(!showAssistantPanel);
  };

  const toggleShellPanel = () => {
    if (showShellPanel && visiblePanelCount <= 1) return;
    setShowShellPanel(!showShellPanel);
  };
  const terminalsStarted = useRef(false);
  const tabCounter = useRef(1);
  const editInputRef = useRef<HTMLInputElement>(null);

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

  const createNewTab = async (projectPath: string, assistantId?: string) => {
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
            if (args) command = `${command} ${args}`;
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

      const terminalId = await invoke<string>("spawn_terminal", {
        shell: command,
        cwd: projectPath,
      });

      const tabId = `tab-${Date.now()}`;
      const tabNumber = tabCounter.current++;
      const newTab: TerminalTab = {
        id: tabId,
        name: tabNumber === 1 ? name : `${name} ${tabNumber}`,
        terminalId,
      };

      setTerminalTabs(prev => [...prev, newTab]);
      setActiveTabId(tabId);

      if (command) {
        toast.success(`${newTab.name} started`);
      }

      return newTab;
    } catch (error) {
      console.error("Failed to create terminal tab:", error);
      return null;
    }
  };

  const closeTab = async (tabId: string) => {
    const tab = terminalTabs.find(t => t.id === tabId);
    if (tab?.terminalId) {
      await invoke("kill_terminal", { id: tab.terminalId });
    }

    setTerminalTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      // If we closed the active tab, switch to the last remaining tab
      if (activeTabId === tabId && newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });
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
      // Start utility terminal (plain shell)
      const utilityId = await invoke<string>("spawn_terminal", {
        shell: "",
        cwd: projectPath,
      });
      setUtilityTerminalId(utilityId);

      // Create the first AI terminal tab
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

  const currentBranch = useGitStore.getState().branches.find((b) => b.isHead);
  const assistantOptions = getAssistantOptions();

  return (
    <div className="relative flex h-full bg-background">
      {/* Single horizontal divider line spanning full width */}
      <div className="absolute left-0 right-0 top-10 h-px bg-border" />
      {/* Vertical divider for sidebar */}
      <div className="absolute left-12 top-10 bottom-0 w-px bg-border" />

      {/* Left icon sidebar */}
      <div
        data-tauri-drag-region
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
                    ? "bg-portal-orange/20 text-portal-orange"
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
                onClick={() => navigate("/")}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New Project</TooltipContent>
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
                    ? "bg-portal-orange/20 text-portal-orange"
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
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Left sidebar - Git panel */}
          {showGitPanel && (
            <>
              <ResizablePanel defaultSize={22} minSize={18} maxSize={35}>
                <div className="flex h-full flex-col">
                  <GitPanel
                    projectPath={currentProject.path}
                    projectName={currentProject.name}
                    onRefresh={refreshGitData}
                  />
                </div>
              </ResizablePanel>

              <ResizableHandle className="w-px bg-border" />
            </>
          )}

          {/* Center - Terminal area */}
          {showAssistantPanel && (
            <>
              <ResizablePanel defaultSize={showGitPanel && showShellPanel ? 56 : showGitPanel || showShellPanel ? 78 : 100} minSize={35}>
                <div className="flex h-full flex-col">
                  {/* Tab bar */}
                  <div className="flex h-10 items-center">
                    <div className="flex flex-1 items-center overflow-x-auto">
                      {terminalTabs.map((tab) => (
                        <div
                          key={tab.id}
                          className={cn(
                            "group flex items-center gap-1 border-r border-border px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                            activeTabId === tab.id
                              ? "border-b-2 border-b-portal-orange bg-muted/50 text-foreground"
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
                              className="truncate max-w-[120px] cursor-text"
                              onClick={(e) => {
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
                  {terminalTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={cn(
                        "flex flex-1 flex-col overflow-hidden",
                        activeTabId !== tab.id && "hidden"
                      )}
                    >
                      <div className="flex-1 overflow-hidden" style={{ backgroundColor: terminalBg }}>
                        {tab.terminalId ? (
                          <Terminal id={tab.terminalId} cwd={currentProject.path} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <p className="text-sm text-muted-foreground">
                              Starting terminal...
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Empty state when no tabs */}
                  {terminalTabs.length === 0 && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3" style={{ backgroundColor: terminalBg }}>
                      <TerminalIcon className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Starting AI assistant...</p>
                    </div>
                  )}
                </div>
              </ResizablePanel>

              {showShellPanel && <ResizableHandle className="w-px bg-border" />}
            </>
          )}

          {/* Right sidebar - Utility terminal */}
          {showShellPanel && (
            <ResizablePanel defaultSize={showGitPanel && showAssistantPanel ? 22 : showGitPanel || showAssistantPanel ? 50 : 100} minSize={15} maxSize={showAssistantPanel ? 40 : 100}>
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex h-10 items-center justify-between px-4">
                <div className="flex items-center gap-2">
                  <TerminalIcon className="h-4 w-4 text-portal-orange" />
                  <span className="text-sm font-medium">Shell</span>
                </div>
                {utilityTerminalId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => {
                      invoke("kill_terminal", { id: utilityTerminalId });
                      setUtilityTerminalId(null);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>

              {/* Utility terminal content */}
              <div className="flex-1 overflow-hidden" style={{ backgroundColor: terminalBg }}>
                {utilityTerminalId ? (
                  <Terminal id={utilityTerminalId} cwd={currentProject.path} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3">
                    <TerminalIcon className="h-6 w-6 text-muted-foreground" />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const id = await invoke<string>("spawn_terminal", {
                          shell: "",
                          cwd: currentProject.path,
                        });
                        setUtilityTerminalId(id);
                      }}
                    >
                      Start Shell
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>
          )}
        </ResizablePanelGroup>
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
    </div>
  );
}
