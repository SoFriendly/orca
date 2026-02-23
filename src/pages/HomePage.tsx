import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderGit2,
  Plus,
  Download,
  Settings,
  Trash2,
  FolderOpen,
  ArrowRight,
  Search,
  X,
  HelpCircle,
} from "lucide-react";
import OrcaLogo from "@/components/OrcaLogo";
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
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProjectStore, ensureFolders } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import { hslToHex, THEME_DEFAULTS } from "@/lib/colorUtils";
import type { Project } from "@/types";
import SettingsSheet from "@/components/SettingsSheet";
import Onboarding from "@/components/Onboarding";

export default function HomePage() {
  const navigate = useNavigate();
  const { projects, addProject, removeProject } = useProjectStore();
  const { defaultClonePath, hasSeenOnboarding, setHasSeenOnboarding, theme, customTheme } = useSettingsStore();
  const [cloneUrl, setCloneUrl] = useState("");
  const [clonePath, setClonePath] = useState("");
  const [isCloning, setIsCloning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoPath, setNewRepoPath] = useState("");
  const [activeSidebarItem, setActiveSidebarItem] = useState<"home" | "settings">("home");
  const [projectSearch, setProjectSearch] = useState("");
  const [showProjectSearch, setShowProjectSearch] = useState(false);
  const sidebarNavRef = useRef<HTMLElement | null>(null);

  // Sort and filter projects
  const sortedProjects = [...projects]
    .sort((a, b) => new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime())
    .filter(p => !projectSearch || p.name.toLowerCase().includes(projectSearch.toLowerCase()) || p.path.toLowerCase().includes(projectSearch.toLowerCase()));

  useEffect(() => {
    if (showCloneDialog && defaultClonePath && !clonePath) {
      setClonePath(defaultClonePath);
    }
  }, [showCloneDialog, defaultClonePath]);

  useEffect(() => {
    if (showCreateDialog && defaultClonePath && !newRepoPath) {
      setNewRepoPath(defaultClonePath);
    }
  }, [showCreateDialog, defaultClonePath]);

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

  // App background colors per theme (computed from CSS --background values)
  const appBgColor =
    theme === "custom" && customTheme
      ? customTheme.colors.background
      : hslToHex(THEME_DEFAULTS[theme as keyof typeof THEME_DEFAULTS]?.background || THEME_DEFAULTS.dark.background);

  // Keep webview background aligned with app background to avoid edge tint differences
  useEffect(() => {
    getCurrentWebview().setBackgroundColor(appBgColor).catch(() => {});
  }, [appBgColor]);

  const handleNewWindow = async () => {
    try {
      const webview = new WebviewWindow(`orca-${Date.now()}`, {
        url: "/",
        title: "Orca",
        width: 1200,
        height: 800,
        minWidth: 600,
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

  const handleOpenProject = async () => {
    try {
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
    } catch (error) {
      toast.error("Failed to open project");
      console.error(error);
    }
  };

  const handleSelectClonePath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Clone Location",
        defaultPath: clonePath || defaultClonePath || undefined,
      });

      if (selected && typeof selected === "string") {
        const repoName = cloneUrl
          .split("/")
          .pop()
          ?.replace(/\.git$/, "") || "repo";
        setClonePath(`${selected}/${repoName}`);
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  const handleSelectCreatePath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Parent Directory",
        defaultPath: newRepoPath || defaultClonePath || undefined,
      });

      if (selected && typeof selected === "string") {
        setNewRepoPath(selected);
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  const handleCloneRepo = async () => {
    if (!cloneUrl || !clonePath) {
      toast.error("Please fill in all fields");
      return;
    }
    setIsCloning(true);
    try {
      const result = await invoke<string>("clone_repo", {
        url: cloneUrl,
        path: clonePath,
      });
      const name = clonePath.split(/[/\\]/).pop() || "Cloned Repo";
      const project: Project = ensureFolders({
        id: crypto.randomUUID(),
        name,
        path: result,
        lastOpened: new Date().toISOString(),
      });
      addProject(project);
      await invoke("add_project", { project });
      toast.success("Repository cloned successfully");
      setShowCloneDialog(false);
      setCloneUrl("");
      setClonePath("");
      navigate(`/project/${project.id}`);
    } catch (error) {
      toast.error(`Failed to clone repository: ${error}`);
      console.error(error);
    } finally {
      setIsCloning(false);
    }
  };

  const handleCreateRepo = async () => {
    if (!newRepoName || !newRepoPath) {
      toast.error("Please fill in all fields");
      return;
    }
    try {
      const fullPath = `${newRepoPath}/${newRepoName}`;
      await invoke("init_repo", { path: fullPath });
      const project: Project = ensureFolders({
        id: crypto.randomUUID(),
        name: newRepoName,
        path: fullPath,
        lastOpened: new Date().toISOString(),
      });
      addProject(project);
      await invoke("add_project", { project });
      toast.success("Repository created successfully");
      setShowCreateDialog(false);
      setNewRepoName("");
      setNewRepoPath("");
      navigate(`/project/${project.id}`);
    } catch (error) {
      toast.error("Failed to create repository");
      console.error(error);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    try {
      removeProject(project.id);
      await invoke("remove_project", { id: project.id });
      toast.success("Project removed");
    } catch (error) {
      toast.error("Failed to remove project");
      console.error(error);
    }
  };

  const getRevealLabel = () => {
    const platform = navigator.platform.toUpperCase();
    if (platform.indexOf('MAC') >= 0) return 'Open in Finder';
    if (platform.indexOf('WIN') >= 0) return 'Show in Explorer';
    return 'Open in File Manager';
  };

  const handleRevealInFileManager = async (path: string) => {
    try {
      await invoke("open_in_finder", { path });
    } catch (error) {
      toast.error("Failed to open file manager");
      console.error(error);
    }
  };

  const handleProjectClick = async (project: Project) => {
    // Update last opened in both zustand store and database
    const updated = { ...project, lastOpened: new Date().toISOString() };
    addProject(updated);
    await invoke("add_project", { project: updated });
    navigate(`/project/${project.id}`);
  };

  const handleCloneDialogChange = (open: boolean) => {
    setShowCloneDialog(open);
    if (!open) {
      setCloneUrl("");
      setClonePath("");
    }
  };

  const handleCreateDialogChange = (open: boolean) => {
    setShowCreateDialog(open);
    if (!open) {
      setNewRepoName("");
      setNewRepoPath("");
    }
  };

  const getRelativeTime = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diff = now.getTime() - then.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  const navButtonBase =
    "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/50 transition-all duration-200";
  const panelShellClass =
    "rounded-2xl bg-card shadow-[var(--panel-shadow)]";

  return (
    <div
      className="relative flex h-full"
      onMouseDown={(e) => {
        // Only start dragging if clicking in the top 32px and not on interactive elements
        if (e.clientY <= 32) {
          const target = e.target as HTMLElement;
          if (!target.closest('button, a, input, [role="button"]')) {
            getCurrentWindow().startDragging();
          }
        }
      }}
    >
      {/* Left icon sidebar */}
      <nav
        ref={sidebarNavRef}
        aria-label="Main navigation"
        className="relative z-20 flex w-14 flex-col pl-2 pb-2 pt-9 backdrop-blur-sm"
      >
        {/* Top icon container */}
        <div className="flex flex-col items-center gap-1.5 px-3 py-1">
          <div className="flex flex-col items-center gap-1.5">
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
                onClick={handleOpenProject}
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
                    : "hover:text-foreground/70 hover:bg-muted/20"
                )}
              >
                <Settings className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom icon container */}
        <div className="flex flex-col items-center gap-1.5 px-3 py-2">
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setHasSeenOnboarding(false)}
                  aria-label="Show tour"
                  className={cn(navButtonBase, "hover:text-foreground/70 hover:bg-muted/20")}
                >
                  <HelpCircle className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Show Tour</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="relative z-10 flex flex-1 flex-col overflow-hidden px-3 pb-3 pt-9">
        <div className={cn("flex flex-1 flex-col overflow-hidden", panelShellClass)}>
        <div className="flex flex-1 flex-col overflow-hidden px-6 py-8">
          <div className="mx-auto w-full max-w-md flex flex-col flex-1 overflow-hidden">
            {/* Hero */}
            <div className="text-center shrink-0">
              <div className="mb-4 flex justify-center">
                <OrcaLogo size={128} />
              </div>
              <h1 className="text-xl font-semibold">Welcome to Orca</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Think in changes, not chats.
              </p>
            </div>

            {/* Quick actions */}
            <div className="space-y-3 mt-8 shrink-0">
              <button
                onClick={() => setShowCloneDialog(true)}
                className="group flex w-full items-center gap-4 rounded-xl p-4 text-left transition-all hover:bg-primary/[0.06]"
              >
                <div className="flex h-10 w-10 items-center justify-center">
                  <Download className="h-5 w-5 text-primary/70 group-hover:text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Clone repository</p>
                  <p className="text-xs text-muted-foreground">
                    Clone from GitHub, GitLab, or any URL
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>

              <button
                onClick={handleOpenProject}
                className="group flex w-full items-center gap-4 rounded-xl p-4 text-left transition-all hover:bg-primary/[0.06]"
              >
                <div className="flex h-10 w-10 items-center justify-center">
                  <FolderOpen className="h-5 w-5 text-primary/70 group-hover:text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Open existing folder</p>
                  <p className="text-xs text-muted-foreground">
                    Browse to a local project folder
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>

              <button
                onClick={() => setShowCreateDialog(true)}
                className="group flex w-full items-center gap-4 rounded-xl p-4 text-left transition-all hover:bg-primary/[0.06]"
              >
                <div className="flex h-10 w-10 items-center justify-center">
                  <Plus className="h-5 w-5 text-primary/70 group-hover:text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Create new repository</p>
                  <p className="text-xs text-muted-foreground">
                    Initialize a new git repository
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </div>

            {/* Recent projects */}
            <div className="mt-8 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl p-2">
              <div className="flex items-center justify-between px-1 mb-3 shrink-0">
                {showProjectSearch ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="text"
                      placeholder="Search projects..."
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      autoFocus
                      data-no-focus-ring
                      aria-label="Search projects"
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      onClick={() => {
                        setShowProjectSearch(false);
                        setProjectSearch("");
                      }}
                      aria-label="Close search"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Recent Projects
                    </h2>
                    <button
                      onClick={() => setShowProjectSearch(true)}
                      aria-label="Search projects"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Search className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-none space-y-1">
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No recent projects</p>
                ) : sortedProjects.length === 0 && projectSearch ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No projects match "{projectSearch}"</p>
                ) : sortedProjects.map((project) => (
                  <ContextMenu key={project.id}>
                    <ContextMenuTrigger>
                      <button
                        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.08]"
                        onClick={() => handleProjectClick(project)}
                      >
                        <FolderGit2 className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{project.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground font-mono">
                            {project.path}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {getRelativeTime(project.lastOpened)}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => handleRevealInFileManager(project.path)}>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        {getRevealLabel()}
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-destructive"
                        onClick={() => handleDeleteProject(project)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove from list
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            </div>

          </div>
        </div>
        </div>
      </main>

      {/* Clone Dialog */}
      <Dialog open={showCloneDialog} onOpenChange={handleCloneDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone Repository</DialogTitle>
            <DialogDescription>
              Enter the URL of the repository to clone
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              placeholder="https://github.com/user/repo.git"
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              aria-label="Repository URL"
            />
            <div className="flex gap-2">
              <Input
                placeholder="Local path"
                value={clonePath}
                onChange={(e) => setClonePath(e.target.value)}
                aria-label="Clone path"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleSelectClonePath}
                aria-label="Browse folder"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {defaultClonePath && (
              <p className="text-xs text-muted-foreground">
                Default: {defaultClonePath}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleCloneRepo}
              disabled={isCloning}
              className="bg-primary hover:bg-primary/90"
            >
              <span aria-live="polite">{isCloning ? "Cloning..." : "Clone"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={handleCreateDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Repository</DialogTitle>
            <DialogDescription>
              Initialize a new git repository
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              placeholder="Repository name"
              value={newRepoName}
              onChange={(e) => setNewRepoName(e.target.value)}
              aria-label="Repository name"
            />
            <div className="flex gap-2">
              <Input
                placeholder="Parent directory"
                value={newRepoPath}
                onChange={(e) => setNewRepoPath(e.target.value)}
                aria-label="Parent directory"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleSelectCreatePath}
                aria-label="Browse folder"
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {defaultClonePath && (
              <p className="text-xs text-muted-foreground">
                Default: {defaultClonePath}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreateRepo}
              className="bg-primary hover:bg-primary/90"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Sheet */}
      <SettingsSheet
        open={showSettings}
        onOpenChange={(open) => {
          setShowSettings(open);
          if (!open) {
            setActiveSidebarItem("home");
          }
        }}
      />

      {/* Onboarding */}
      {!hasSeenOnboarding && (
        <Onboarding onComplete={() => setHasSeenOnboarding(true)} />
      )}
    </div>
  );
}
