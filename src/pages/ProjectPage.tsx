import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Home,
  Settings,
  Terminal as TerminalIcon,
  X,
  GitBranch,
  HelpCircle,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { projects, openTab } = useProjectStore();
  const { setStatus, setDiffs, setBranches, setHistory, setLoading } = useGitStore();
  const { assistantArgs } = useSettingsStore();
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [utilityTerminalId, setUtilityTerminalId] = useState<string | null>(null);
  const [activeSidebarItem, setActiveSidebarItem] = useState<"terminal" | "settings">("terminal");
  const terminalsStarted = useRef(false);
  const tabCounter = useRef(1);

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

  // Auto-start terminals when project loads
  useEffect(() => {
    if (currentProject && !terminalsStarted.current) {
      terminalsStarted.current = true;
      startTerminals(currentProject.path);
    }
  }, [currentProject]);

  const getAssistantCommand = async (): Promise<{ command: string; name: string }> => {
    const installed = await invoke<string[]>("check_installed_assistants");

    if (installed.includes("claude")) {
      let command = "claude";
      const args = assistantArgs["claude-code"] || "";
      if (args) command = `${command} ${args}`;
      return { command, name: "Claude Code" };
    } else if (installed.includes("aider")) {
      let command = "aider";
      const args = assistantArgs["aider"] || "";
      if (args) command = `${command} ${args}`;
      return { command, name: "Aider" };
    }

    return { command: "", name: "Shell" };
  };

  const createNewTab = async (projectPath: string) => {
    try {
      const { command, name } = await getAssistantCommand();
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

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading project...</p>
      </div>
    );
  }

  const currentBranch = useGitStore.getState().branches.find((b) => b.isHead);

  return (
    <div className="flex h-full bg-background">
      {/* Left icon sidebar */}
      <div className="flex w-12 flex-col items-center border-r border-border bg-background py-3">
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

        {/* Bottom icons */}
        <div className="flex flex-col items-center gap-1">
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

      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Left sidebar - Git panel */}
          <ResizablePanel defaultSize={22} minSize={18} maxSize={35}>
            <div className="flex h-full flex-col">
              {/* Project header */}
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Home className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-sm font-semibold">{currentProject.name}</h1>
                  {currentBranch && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {currentBranch.name}
                    </p>
                  )}
                </div>
              </div>

              {/* Git panel */}
              <GitPanel
                projectPath={currentProject.path}
                onRefresh={refreshGitData}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border" />

          {/* Center - Terminal area */}
          <ResizablePanel defaultSize={56} minSize={35}>
            <div className="flex h-full flex-col">
              {/* Tab bar */}
              <div className="flex items-center border-b border-border">
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
                      <span className="truncate max-w-[120px]">{tab.name}</span>
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
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => currentProject && createNewTab(currentProject.path)}
                      className="flex h-full items-center px-3 py-2 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>New AI Terminal</TooltipContent>
                </Tooltip>
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
                  <div className="flex-1 overflow-hidden bg-[#0d0d0d]">
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
                <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#0d0d0d]">
                  <TerminalIcon className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Starting AI assistant...</p>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border" />

          {/* Right sidebar - Utility terminal */}
          <ResizablePanel defaultSize={22} minSize={15} maxSize={40}>
            <div className="flex h-full flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
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
              <div className="flex-1 overflow-hidden bg-[#0d0d0d]">
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
        </ResizablePanelGroup>
      </div>

      {/* Settings Sheet */}
      <SettingsSheet open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
