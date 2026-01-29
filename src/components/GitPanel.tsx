import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  GitCommit,
  RefreshCw,
  Undo2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  GitBranch,
  Plus,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useGitStore } from "@/stores/gitStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import type { FileDiff, DiffHunk } from "@/types";

// Groq API key for AI commit messages
const GROQ_API_KEY = "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";

interface GitPanelProps {
  projectPath: string;
  projectName: string;
  onRefresh: () => void;
}

interface CommitSuggestion {
  subject: string;
  description: string;
}

interface HunkToDiscard {
  filePath: string;
  hunk: DiffHunk;
}

export default function GitPanel({ projectPath, projectName, onRefresh }: GitPanelProps) {
  const { diffs, branches, loading, status } = useGitStore();
  const { autoCommitMessage } = useSettingsStore();
  const [commitSubject, setCommitSubject] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showDiscardSelectedDialog, setShowDiscardSelectedDialog] = useState(false);
  const [isDiscardingSelected, setIsDiscardingSelected] = useState(false);
  const lastDiffsHash = useRef<string>("");
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasGeneratedInitialMessage = useRef(false);
  const lastClickedIndex = useRef<number>(-1);

  const currentBranch = branches.find((b) => b.isHead);
  const localBranches = branches.filter((b) => !b.isRemote);

  // Separate staged and unstaged changes (for now, treating all as unstaged)
  const unstagedChanges = diffs;
  const stagedChanges: FileDiff[] = [];

  // Auto-refresh git status every 2 seconds for real-time updates
  useEffect(() => {
    refreshIntervalRef.current = setInterval(() => {
      onRefresh();
    }, 2000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [onRefresh]);

  // Auto-generate commit message only when the set of changed files changes
  useEffect(() => {
    const diffsHash = JSON.stringify(diffs.map(d => d.path + d.status).sort());

    if (diffs.length === 0) {
      // Reset when no changes
      setCommitSubject("");
      setCommitDescription("");
      setSelectedFiles(new Set());
      lastDiffsHash.current = "";
      hasGeneratedInitialMessage.current = false;
    } else if (diffsHash !== lastDiffsHash.current) {
      // Files changed - generate new message
      const previousHash = lastDiffsHash.current;
      lastDiffsHash.current = diffsHash;

      // Clear selection of files that no longer exist
      const currentPaths = new Set(diffs.map(d => d.path));
      setSelectedFiles(prev => {
        const next = new Set<string>();
        prev.forEach(path => {
          if (currentPaths.has(path)) next.add(path);
        });
        return next;
      });

      // Only auto-generate on first load or when files actually change (if enabled)
      if (autoCommitMessage && (!previousHash || !hasGeneratedInitialMessage.current)) {
        hasGeneratedInitialMessage.current = true;
        generateCommitMessage();
      }
    }
  }, [diffs]);

  const generateCommitMessage = async () => {
    if (diffs.length === 0) return;

    setIsGenerating(true);
    try {
      const suggestion = await invoke<CommitSuggestion>("generate_commit_message", {
        diffs,
        apiKey: GROQ_API_KEY,
      });
      setCommitSubject(suggestion.subject);
      setCommitDescription(suggestion.description);
    } catch (error) {
      console.error("Failed to generate commit message:", error);
      // Fallback to a simple message
      const fileNames = diffs.map(d => d.path.split('/').pop()).join(', ');
      setCommitSubject(`Update ${fileNames}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (!commitSubject.trim()) {
      toast.error("Please enter a commit message");
      return;
    }
    setIsCommitting(true);
    try {
      const fullMessage = commitDescription.trim()
        ? `${commitSubject}\n\n${commitDescription}`
        : commitSubject;
      await invoke("commit", { repoPath: projectPath, message: fullMessage });
      toast.success("Changes committed");
      setCommitSubject("");
      setCommitDescription("");
      onRefresh();
    } catch (error) {
      toast.error("Failed to commit");
      console.error(error);
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePull = async () => {
    setIsPulling(true);
    try {
      await invoke("pull_remote", { repoPath: projectPath, remote: "origin" });
      toast.success("Pulled from remote");
      onRefresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes("merge required")) {
        toast.error("Cannot fast-forward. Merge or rebase required.");
      } else {
        toast.error("Failed to pull");
      }
      console.error(error);
    } finally {
      setIsPulling(false);
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    try {
      await invoke("push_remote", { repoPath: projectPath, remote: "origin" });
      toast.success("Pushed to remote");
      onRefresh();
    } catch (error) {
      toast.error("Failed to push");
      console.error(error);
    } finally {
      setIsPushing(false);
    }
  };

  const handleDiscardFile = async (filePath: string) => {
    try {
      await invoke("discard_file", { repoPath: projectPath, filePath });
      toast.success("Changes discarded");
      setSelectedFiles(prev => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
      onRefresh();
    } catch (error) {
      toast.error("Failed to discard changes");
      console.error(error);
    }
  };

  const handleDiscardSelected = async () => {
    if (selectedFiles.size === 0) return;
    setIsDiscardingSelected(true);
    try {
      const filesToDiscard = Array.from(selectedFiles);
      for (const filePath of filesToDiscard) {
        await invoke("discard_file", { repoPath: projectPath, filePath });
      }
      toast.success(`Discarded changes to ${filesToDiscard.length} file${filesToDiscard.length > 1 ? 's' : ''}`);
      setSelectedFiles(new Set());
      setShowDiscardSelectedDialog(false);
      onRefresh();
    } catch (error) {
      toast.error("Failed to discard some changes");
      console.error(error);
    } finally {
      setIsDiscardingSelected(false);
    }
  };

  const handleFileClick = (filePath: string, index: number, e: React.MouseEvent) => {
    e.stopPropagation();

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isMultiSelectKey = isMac ? e.metaKey : e.ctrlKey;
    const isRangeSelectKey = e.shiftKey;

    // Only handle selection with modifier keys, otherwise expand/collapse
    if (isRangeSelectKey || isMultiSelectKey) {
      setSelectedFiles(prev => {
        const next = new Set(prev);

        if (isRangeSelectKey && lastClickedIndex.current >= 0) {
          // Shift-click: select range
          const start = Math.min(lastClickedIndex.current, index);
          const end = Math.max(lastClickedIndex.current, index);
          for (let i = start; i <= end; i++) {
            next.add(diffs[i].path);
          }
        } else if (isMultiSelectKey) {
          // Cmd/Ctrl-click: toggle individual selection
          if (next.has(filePath)) {
            next.delete(filePath);
          } else {
            next.add(filePath);
          }
        }

        return next;
      });
      lastClickedIndex.current = index;
    } else {
      // Plain click: expand/collapse the file diff
      toggleFileExpanded(filePath);
    }
  };

  const clearSelection = () => {
    setSelectedFiles(new Set());
    lastClickedIndex.current = -1;
  };

  const handleCreateBranch = async () => {
    if (!newBranchName) return;
    setIsCreatingBranch(true);
    try {
      await invoke("create_branch", { repoPath: projectPath, name: newBranchName });
      toast.success(`Created branch ${newBranchName}`);
      // Automatically switch to the new branch
      await invoke("checkout_branch", { repoPath: projectPath, branch: newBranchName });
      toast.success(`Switched to ${newBranchName}`);
      setShowBranchDialog(false);
      setNewBranchName("");
      onRefresh();
    } catch (error) {
      toast.error("Failed to create branch");
      console.error(error);
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const handleSwitchBranch = async (branchName: string) => {
    if (branchName === currentBranch?.name) return;
    setIsSwitchingBranch(true);
    try {
      await invoke("checkout_branch", { repoPath: projectPath, branch: branchName });
      toast.success(`Switched to ${branchName}`);
      onRefresh();
    } catch (error) {
      toast.error("Failed to switch branch");
      console.error(error);
    } finally {
      setIsSwitchingBranch(false);
    }
  };

  const toggleFileExpanded = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "added":
        return "bg-green-500";
      case "deleted":
        return "bg-red-500";
      default:
        return "bg-portal-orange";
    }
  };

  const [fileToDiscard, setFileToDiscard] = useState<string | null>(null);
  const [hunkToDiscard, setHunkToDiscard] = useState<HunkToDiscard | null>(null);

  const handleDiscardHunk = async (filePath: string, hunk: DiffHunk) => {
    try {
      // Convert hunk lines to the format expected by the backend
      const lines = hunk.lines.map(line => {
        const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
        return prefix + line.content;
      });

      await invoke("discard_hunk", {
        repoPath: projectPath,
        filePath,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines,
      });
      toast.success("Hunk discarded");
      onRefresh();
    } catch (error) {
      toast.error(`Failed to discard hunk: ${error}`);
    }
  };

  const FileItem = ({ diff, index }: { diff: FileDiff; index: number }) => {
    const isSelected = selectedFiles.has(diff.path);
    const isExpanded = expandedFiles.has(diff.path);

    return (
      <div className="group">
        {/* File row with context menu */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors",
                isSelected ? "bg-portal-orange/20" : "hover:bg-muted/50"
              )}
              onClick={(e) => handleFileClick(diff.path, index, e)}
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className={cn("h-2 w-2 shrink-0 rounded-sm", getStatusColor(diff.status))} />
              <div className="flex-1 overflow-x-auto scrollbar-none">
                <span className="whitespace-nowrap font-mono text-xs">{diff.path}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-5 w-5 shrink-0",
                  isExpanded ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setFileToDiscard(diff.path);
                }}
              >
                <Undo2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setFileToDiscard(diff.path)}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Discard changes
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Inline diff view with per-hunk context menus */}
        {isExpanded && (
          <div className="ml-5 mt-1 overflow-hidden rounded bg-[#0d0d0d]">
            <div className="overflow-x-auto p-2">
              <div className="font-mono text-[10px] leading-relaxed">
                {diff.hunks.map((hunk, hi) => (
                  <ContextMenu key={hi}>
                    <ContextMenuTrigger asChild>
                      <div className="rounded hover:bg-white/5 -mx-1 px-1">
                        <div className="text-muted-foreground whitespace-nowrap">
                          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                        </div>
                        {hunk.lines.map((line, li) => (
                          <div
                            key={li}
                            className={cn(
                              "whitespace-pre",
                              line.type === "addition" && "bg-green-500/10 text-green-400",
                              line.type === "deletion" && "bg-red-500/10 text-red-400",
                              line.type === "context" && "text-muted-foreground"
                            )}
                          >
                            {line.type === "addition" && "+"}
                            {line.type === "deletion" && "-"}
                            {line.type === "context" && " "}
                            {line.content}
                          </div>
                        ))}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setHunkToDiscard({ filePath: diff.path, hunk })}
                      >
                        <Undo2 className="mr-2 h-4 w-4" />
                        Discard this change
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setFileToDiscard(diff.path)}
                      >
                        <Undo2 className="mr-2 h-4 w-4" />
                        Discard all changes to file
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header with actions only */}
      <div className="flex h-10 items-center justify-end gap-1 px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7 relative", isPulling && "text-portal-orange")}
                onClick={handlePull}
                disabled={isPulling}
              >
                {isPulling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                )}
                {!isPulling && status && status.behind > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-medium text-white">
                    {status.behind}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPulling ? "Pulling..." : status && status.behind > 0 ? `Pull (${status.behind} behind)` : "Pull"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-7 w-7 relative", isPushing && "text-portal-orange")}
                onClick={handlePush}
                disabled={isPushing}
              >
                {isPushing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="h-3.5 w-3.5" />
                )}
                {!isPushing && status && status.ahead > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-portal-orange px-1 text-[9px] font-medium text-white">
                    {status.ahead}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPushing ? "Pushing..." : status && status.ahead > 0 ? `Push (${status.ahead} ahead)` : "Push"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onRefresh}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-4 pb-4 pt-4">
          {/* Project name and branch */}
          <div className="flex items-center gap-1.5 mb-4">
            <span className="text-sm font-medium truncate">{projectName}</span>
            <span className="text-muted-foreground">/</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                  disabled={isSwitchingBranch}
                >
                  <GitBranch className="h-3 w-3" />
                  <span className="max-w-[100px] truncate">{currentBranch?.name || "main"}</span>
                  {isSwitchingBranch ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                {localBranches.map((branch) => (
                  <DropdownMenuItem
                    key={branch.name}
                    onClick={() => handleSwitchBranch(branch.name)}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{branch.name}</span>
                    {branch.isHead && <Check className="h-3 w-3 text-portal-orange" />}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowBranchDialog(true)}>
                  <Plus className="mr-2 h-3 w-3" />
                  New branch
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Selection actions */}
          {selectedFiles.size > 0 && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-2">
              <button
                onClick={clearSelection}
                className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <span className="flex-1 text-xs text-muted-foreground">
                {selectedFiles.size} file{selectedFiles.size > 1 ? 's' : ''} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => setShowDiscardSelectedDialog(true)}
              >
                <Undo2 className="mr-1 h-3 w-3" />
                Discard
              </Button>
            </div>
          )}

          {/* Unstaged Changes */}
          {unstagedChanges.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Unstaged Changes
              </h3>
              <div className="space-y-0.5">
                {unstagedChanges.map((diff, index) => (
                  <FileItem key={diff.path} diff={diff} index={index} />
                ))}
              </div>
            </div>
          )}

          {/* Staged Changes */}
          {stagedChanges.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Staged Changes
              </h3>
              <div className="space-y-0.5">
                {stagedChanges.map((diff, index) => (
                  <FileItem key={diff.path} diff={diff} index={unstagedChanges.length + index} />
                ))}
              </div>
            </div>
          )}

          {/* No changes message */}
          {diffs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <GitCommit className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No changes</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Commit section - fixed at bottom */}
      <div className="border-t border-border p-4 space-y-3">
        {/* Subject line */}
        <div className="relative">
          <Input
            placeholder="Summary (required)"
            value={commitSubject}
            onChange={(e) => setCommitSubject(e.target.value)}
            className="bg-muted/50 text-sm pr-8"
            disabled={isGenerating}
          />
          {isGenerating && (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-portal-orange" />
          )}
        </div>

        {/* Description */}
        <Textarea
          placeholder="Description (optional)"
          value={commitDescription}
          onChange={(e) => setCommitDescription(e.target.value)}
          className="bg-muted/50 text-sm min-h-[60px] resize-none"
          disabled={isGenerating}
        />

        {/* Regenerate button */}
        {diffs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground hover:text-foreground"
            onClick={generateCommitMessage}
            disabled={isGenerating}
          >
            <Sparkles className="mr-1.5 h-3 w-3" />
            {isGenerating ? "Generating..." : "Regenerate with AI"}
          </Button>
        )}

        {/* Commit button */}
        <Button
          className="w-full bg-portal-orange hover:bg-portal-orange/90 text-white font-medium"
          onClick={handleCommit}
          disabled={isCommitting || !commitSubject.trim() || diffs.length === 0}
        >
          {isCommitting ? "Committing..." : `Commit to ${currentBranch?.name || "main"}`}
        </Button>
      </div>

      {/* Create branch dialog */}
      <Dialog open={showBranchDialog} onOpenChange={setShowBranchDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Branch</DialogTitle>
            <DialogDescription>
              Create a new branch from the current HEAD and switch to it
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
            <Button variant="outline" onClick={() => setShowBranchDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateBranch} disabled={!newBranchName.trim() || isCreatingBranch}>
              {isCreatingBranch ? "Creating..." : "Create & Switch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard selected files dialog */}
      <AlertDialog open={showDiscardSelectedDialog} onOpenChange={setShowDiscardSelectedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes to {selectedFiles.size} file{selectedFiles.size > 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard all changes to the following files. This cannot be undone.
              <ul className="mt-2 max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-xs">
                {Array.from(selectedFiles).map(file => (
                  <li key={file} className="truncate">{file}</li>
                ))}
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDiscardingSelected}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscardSelected}
              disabled={isDiscardingSelected}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDiscardingSelected ? "Discarding..." : "Discard All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard single file dialog (from context menu) */}
      <AlertDialog open={!!fileToDiscard} onOpenChange={(open) => !open && setFileToDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard all changes to <span className="font-mono">{fileToDiscard}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (fileToDiscard) {
                  handleDiscardFile(fileToDiscard);
                  setFileToDiscard(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard single hunk dialog (from context menu) */}
      <AlertDialog open={!!hunkToDiscard} onOpenChange={(open) => !open && setHunkToDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this change?</AlertDialogTitle>
            <AlertDialogDescription>
              This will discard the selected change in <span className="font-mono">{hunkToDiscard?.filePath}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (hunkToDiscard) {
                  handleDiscardHunk(hunkToDiscard.filePath, hunkToDiscard.hunk);
                  setHunkToDiscard(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
