import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
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
  HelpCircle,
  Search,
  X,
} from "lucide-react";
import { ChellIcon } from "@/components/icons/ChellIcon";
import ChellLogo from "@/components/ChellLogo";
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
import type { Project, ProjectFileData } from "@/types";
import SettingsSheet from "@/components/SettingsSheet";
import Onboarding from "@/components/Onboarding";

export default function HomePage() {
  const navigate = useNavigate();
  const { projects, addProject, removeProject, updateProject } = useProjectStore();
  const { defaultClonePath, hasSeenOnboarding, setHasSeenOnboarding } = useSettingsStore();
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

  const handleNewWindow = async () => {
    try {
      const webview = new WebviewWindow(`chell-${Date.now()}`, {
        url: "/",
        title: "Chell",
        width: 1200,
        height: 800,
        minWidth: 600,
        minHeight: 600,
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

  // Open a .chell project file (Issue #6)
  const handleOpenProjectFile = async () => {
    try {
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
          toast.success(`Opened project: ${projectData.name}`);
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
          toast.success(`Opened project: ${projectData.name}`);
        }
      }
    } catch (error) {
      toast.error("Failed to open project file");
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
      toast.error("Failed to clone repository");
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

  const handleOpenInFinder = async (path: string) => {
    try {
      await invoke("open_in_finder", { path });
    } catch (error) {
      toast.error("Failed to open in Finder");
      console.error(error);
    }
  };

  const handleProjectClick = (project: Project) => {
    // Update last opened
    addProject({ ...project, lastOpened: new Date().toISOString() });
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

  return (
    <div
      className="relative flex h-full bg-background"
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
      <div
        className="flex w-12 flex-col items-center bg-background pt-8 pb-3"
      >
        {/* Top icons */}
          <div className="flex flex-col items-center gap-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveSidebarItem("home")}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  activeSidebarItem === "home"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <ChellIcon className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Home</TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={handleNewWindow}
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
                onClick={handleOpenProjectFile}
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

        {/* Bottom icons */}
        <div className="flex flex-col items-center gap-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setHasSeenOnboarding(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <HelpCircle className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Show Tour</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden px-6 py-8">
          <div className="mx-auto w-full max-w-md flex flex-col flex-1 overflow-hidden">
            {/* Hero */}
            <div className="text-center shrink-0">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/30">
                <ChellLogo size={36} />
              </div>
              <h2 className="text-xl font-semibold">Welcome to Chell</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Think in changes, not commands.
              </p>
            </div>

            {/* Quick actions */}
            <div className="space-y-3 mt-8 shrink-0">
              <button
                onClick={() => setShowCloneDialog(true)}
                className="group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Download className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
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
                className="group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <FolderOpen className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
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
                className="group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/50 hover:bg-muted/50"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
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
            {projects.length > 0 && (
              <div className="flex flex-col mt-8 flex-1 min-h-0 overflow-hidden">
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
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        onClick={() => {
                          setShowProjectSearch(false);
                          setProjectSearch("");
                        }}
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
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Search className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-none space-y-1">
                  {sortedProjects.length === 0 && projectSearch ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No projects match "{projectSearch}"</p>
                  ) : sortedProjects.map((project) => (
                    <ContextMenu key={project.id}>
                      <ContextMenuTrigger>
                        <button
                          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
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
                        <ContextMenuItem onClick={() => handleOpenInFinder(project.path)}>
                          <FolderOpen className="mr-2 h-4 w-4" />
                          Open in Finder
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
            )}

          </div>
        </div>
      </div>

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
            />
            <div className="flex gap-2">
              <Input
                placeholder="Local path"
                value={clonePath}
                onChange={(e) => setClonePath(e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleSelectClonePath}
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
              {isCloning ? "Cloning..." : "Clone"}
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
            />
            <div className="flex gap-2">
              <Input
                placeholder="Parent directory"
                value={newRepoPath}
                onChange={(e) => setNewRepoPath(e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleSelectCreatePath}
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
