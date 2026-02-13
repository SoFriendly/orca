import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
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
  ImageIcon,
  FileIcon,
  History,
  RotateCcw,
  FolderTree,
  Folder,
  File,
  Trash2,
  Pencil,
  Copy,
  FolderOpen,
  FolderMinus,
  EyeOff,
  ExternalLink,
  SquareTerminal,
  MoreHorizontal,
  Save,
  Search,
  FilePlus,
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
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useGitStore } from "@/stores/gitStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn, formatTimestamp } from "@/lib/utils";
import type { FileDiff, DiffHunk, ProjectFolder } from "@/types";


interface GitPanelProps {
  projectPath: string;
  projectName: string;
  isGitRepo: boolean;
  onRefresh: (path?: string) => void;
  onInitRepo: () => Promise<void>;
  onOpenMarkdown?: (filePath: string, lineNumber?: number) => void;
  shellCwd?: string; // Current working directory from terminal (Issue #7)
  folders?: ProjectFolder[]; // All folders in the project (Issue #6)
  onAddFolder?: () => void; // Callback to add a new folder
  onRemoveFolder?: (folderId: string) => void; // Callback to remove a folder from workspace
  workspaceName?: string; // Custom workspace name (Issue #6)
  onRenameWorkspace?: (name: string) => void; // Callback to rename workspace
  onSaveWorkspace?: () => void; // Callback to save workspace file
}

interface CommitSuggestion {
  subject: string;
  description: string;
}

interface HunkToDiscard {
  filePath: string;
  hunk: DiffHunk;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
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

interface FileNameMatch {
  name: string;
  path: string;
  isDir: boolean;
  basePath: string;
}

// Binary file extensions that should NOT be opened in the text editor
const binaryExtensions = [
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.tif', '.psd', '.ai',
  // Video/Audio
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.xz', '.dmg', '.iso',
  // Executables/Libraries
  '.exe', '.dll', '.so', '.dylib', '.bin', '.app', '.deb', '.rpm', '.msi',
  // Documents (binary formats)
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Other binary
  '.sqlite', '.db', '.pyc', '.class', '.o', '.a', '.wasm',
];

const isPreviewable = (path: string): boolean => {
  const lower = path.toLowerCase();
  return !binaryExtensions.some(ext => lower.endsWith(ext));
};

export default function GitPanel({ projectPath, projectName, isGitRepo, onRefresh, onInitRepo, onOpenMarkdown, shellCwd, folders, onAddFolder, onRemoveFolder, workspaceName, onRenameWorkspace, onSaveWorkspace }: GitPanelProps) {
  const { diffs, branches, loading, status, history } = useGitStore();
  const { autoCommitMessage, groqApiKey, preferredEditor, showHiddenFiles } = useSettingsStore();
  // Track the current root path for the file tree (can be changed by cd command)
  const [fileTreeRoot, setFileTreeRoot] = useState(projectPath);
  // Workspace name editing state (Issue #6)
  const [isEditingWorkspaceName, setIsEditingWorkspaceName] = useState(false);
  const [editedWorkspaceName, setEditedWorkspaceName] = useState(workspaceName || "My Workspace");
  // Track the active folder for git operations (Issue #6)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(folders?.[0]?.id ?? null);
  const activeFolder = folders?.find(f => f.id === activeFolderId) ?? folders?.[0];
  // Use active folder path for git operations, falling back to projectPath
  const gitRepoPath = activeFolder?.path ?? projectPath;
  const [commitSubject, setCommitSubject] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [filesToCommit, setFilesToCommit] = useState<Set<string>>(new Set());
  const [showDiscardSelectedDialog, setShowDiscardSelectedDialog] = useState(false);
  const [isDiscardingSelected, setIsDiscardingSelected] = useState(false);
  const [viewMode, setViewMode] = useState<"changes" | "history" | "files">("changes");
  // Expandable commit history state
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitDiffs, setCommitDiffs] = useState<Map<string, FileDiff[]>>(new Map());
  const [expandedCommitFiles, setExpandedCommitFiles] = useState<Set<string>>(new Set());
  const [loadingCommitDiffs, setLoadingCommitDiffs] = useState<Set<string>>(new Set());
  const [commitToReset, setCommitToReset] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [fileTrees, setFileTrees] = useState<Record<string, FileTreeNode[]>>({}); // File trees per folder (Issue #6)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set()); // Which root folders are expanded (Issue #6)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingFileInDir, setCreatingFileInDir] = useState<string | null>(null);
  const [newFileValue, setNewFileValue] = useState("");
  const [draggingFile, setDraggingFile] = useState<{ name: string; x: number; y: number; isDir: boolean } | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  // File tree search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [fileNameMatches, setFileNameMatches] = useState<FileNameMatch[]>([]);
  const [contentSearchResults, setContentSearchResults] = useState<ContentMatch[]>([]);
  const [isSearchingContent, setIsSearchingContent] = useState(false);
  const [contentSearchTruncated, setContentSearchTruncated] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDiffsHash = useRef<string>("");
  const hasGeneratedInitialMessage = useRef(false);
  const pendingAutoGenerate = useRef(false);
  const lastClickedIndex = useRef<number>(-1);
  const justDraggedRef = useRef(false);

  const currentBranch = branches.find((b) => b.isHead);
  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote && !b.name.includes("HEAD"));

  // Separate staged and unstaged changes (for now, treating all as unstaged)
  const unstagedChanges = diffs;
  const stagedChanges: FileDiff[] = [];

  // Auto-refresh disabled to avoid UI jank during terminal use
  // User can manually refresh with the refresh button or after git operations

  // Auto-generate commit message only when the set of changed files changes
  useEffect(() => {
    const diffsHash = JSON.stringify(diffs.map(d => d.path + d.status).sort());

    if (diffs.length === 0) {
      // Reset when no changes
      setCommitSubject("");
      setCommitDescription("");
      setSelectedFiles(new Set());
      setFilesToCommit(new Set());
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

      // Initialize filesToCommit with all current files (checked by default)
      // Keep existing selections that still exist, add new files
      setFilesToCommit(prev => {
        const next = new Set<string>();
        // Add all current files - new files default to checked
        currentPaths.forEach(path => {
          // If we had a previous hash and this file existed before, keep its selection state
          // Otherwise (new file or first load), default to checked
          if (previousHash && prev.has(path)) {
            next.add(path);
          } else if (!previousHash || !prev.size) {
            // First load or empty previous selection - check all
            next.add(path);
          } else {
            // New file - default to checked
            next.add(path);
          }
        });
        return next;
      });

      // Mark for auto-generation on first load (if enabled)
      // We can't call generateCommitMessage() here because filesToCommit won't be updated yet
      if (autoCommitMessage && (!previousHash || !hasGeneratedInitialMessage.current)) {
        pendingAutoGenerate.current = true;
      }
    }
  }, [diffs]);

  // Auto-generate commit message when filesToCommit is populated and pending
  useEffect(() => {
    if (pendingAutoGenerate.current && filesToCommit.size > 0 && autoCommitMessage) {
      pendingAutoGenerate.current = false;
      hasGeneratedInitialMessage.current = true;
      generateCommitMessage();
    }
  }, [filesToCommit, autoCommitMessage]);

  // Default to files view when not a git repo
  useEffect(() => {
    if (!isGitRepo) {
      setViewMode("files");
    }
  }, [isGitRepo]);

  // Load file tree when switching to files view
  useEffect(() => {
    if (viewMode === "files") {
      if (folders && folders.length > 0) {
        // Multi-folder mode: load all folder trees
        const missingTrees = folders.filter(f => !fileTrees[f.id]);
        if (missingTrees.length > 0) {
          loadAllFolderTrees();
        }
        // Expand all folders by default
        if (expandedFolders.size === 0) {
          setExpandedFolders(new Set(folders.map(f => f.id)));
        }
      } else if (fileTree.length === 0) {
        // Single folder mode (backward compat)
        loadFileTree();
      }
    }
  }, [viewMode, folders]);

  // Reload file tree when showHiddenFiles setting changes
  useEffect(() => {
    if (viewMode === "files") {
      if (folders && folders.length > 0) {
        loadAllFolderTrees();
      } else {
        loadFileTree();
      }
    }
  }, [showHiddenFiles]);

  // Watch for file system changes and auto-refresh file tree (Issue #8)
  useEffect(() => {
    // Multi-folder mode: watch all folders
    if (folders && folders.length > 0) {
      // Start watchers for all folders
      folders.forEach(folder => {
        invoke("watch_project_files", { projectPath: folder.path }).catch((err) => {
          console.error(`Failed to start file watcher for ${folder.path}:`, err);
        });
      });

      const unlisten = listen<string>("fs-files-changed", (event) => {
        if (viewMode === "files") {
          // Find which folder changed and reload its tree
          const changedFolder = folders.find(f => f.path === event.payload);
          if (changedFolder) {
            loadFolderTree(changedFolder.id, changedFolder.path);
          }
        }
      });

      return () => {
        folders.forEach(folder => {
          invoke("unwatch_project_files", { projectPath: folder.path }).catch(() => {});
        });
        unlisten.then((fn) => fn());
      };
    }

    // Single folder mode (backward compat)
    if (!fileTreeRoot) return;

    invoke("watch_project_files", { projectPath: fileTreeRoot }).catch((err) => {
      console.error("Failed to start file watcher:", err);
    });

    const unlisten = listen<string>("fs-files-changed", (event) => {
      if (event.payload === fileTreeRoot && viewMode === "files") {
        loadFileTree();
      }
    });

    return () => {
      invoke("unwatch_project_files", { projectPath: fileTreeRoot }).catch(() => {});
      unlisten.then((fn) => fn());
    };
  }, [fileTreeRoot, viewMode, folders]);

  // Update file tree root when shell cwd changes (Issue #7)
  useEffect(() => {
    if (shellCwd && shellCwd !== fileTreeRoot) {
      setFileTreeRoot(shellCwd);
      // Clear expanded dirs when changing root
      setExpandedDirs(new Set());
    }
  }, [shellCwd]);

  // Reset file tree root when project path changes
  useEffect(() => {
    setFileTreeRoot(projectPath);
  }, [projectPath]);

  // Refresh git data when active folder changes in multi-folder workspace
  useEffect(() => {
    if (activeFolderId && folders && folders.length > 1) {
      onRefresh(gitRepoPath);
    }
  }, [activeFolderId]);

  // Reload file tree when fileTreeRoot changes (due to cd or project change)
  useEffect(() => {
    if (viewMode === "files") {
      loadFileTree();
    }
  }, [fileTreeRoot]);

  const loadFileTree = async () => {
    setIsLoadingFiles(true);
    try {
      const tree = await invoke<FileTreeNode[]>("get_file_tree", { path: fileTreeRoot, showHidden: showHiddenFiles });
      setFileTree(tree);
    } catch (error) {
      console.error("Failed to load file tree:", error);
      toast.error("Failed to load files");
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Load file tree for a specific folder (Issue #6)
  const loadFolderTree = async (folderId: string, folderPath: string) => {
    try {
      const tree = await invoke<FileTreeNode[]>("get_file_tree", { path: folderPath, showHidden: showHiddenFiles });
      setFileTrees(prev => ({ ...prev, [folderId]: tree }));
    } catch (error) {
      console.error(`Failed to load file tree for ${folderPath}:`, error);
    }
  };

  // Load all folder trees (Issue #6)
  const loadAllFolderTrees = async () => {
    if (!folders || folders.length === 0) return;
    setIsLoadingFiles(true);
    try {
      await Promise.all(folders.map(folder => loadFolderTree(folder.id, folder.path)));
    } finally {
      setIsLoadingFiles(false);
    }
  };

  // Toggle root folder expansion (Issue #6)
  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // File tree search logic
  const collectFileNameMatches = (query: string): FileNameMatch[] => {
    const queryLower = query.toLowerCase();
    const results: FileNameMatch[] = [];

    const walkTree = (nodes: FileTreeNode[], basePath: string) => {
      for (const node of nodes) {
        if (node.name.toLowerCase().includes(queryLower)) {
          results.push({
            name: node.name,
            path: node.path,
            isDir: node.isDir,
            basePath,
          });
        }
        if (node.children) {
          walkTree(node.children, basePath);
        }
      }
    };

    if (folders && folders.length > 0) {
      for (const folder of folders) {
        const tree = fileTrees[folder.id];
        if (tree) {
          walkTree(tree, folder.path);
        }
      }
    } else {
      walkTree(fileTree, fileTreeRoot);
    }

    return results;
  };

  const triggerContentSearch = async (query: string) => {
    if (query.length < 2) {
      setContentSearchResults([]);
      setContentSearchTruncated(false);
      setIsSearchingContent(false);
      return;
    }

    setIsSearchingContent(true);
    try {
      const folderPaths = folders && folders.length > 0
        ? folders.map(f => f.path)
        : [fileTreeRoot];

      let allMatches: ContentMatch[] = [];
      let anyTruncated = false;

      for (const folderPath of folderPaths) {
        const remaining = 100 - allMatches.length;
        if (remaining <= 0) {
          anyTruncated = true;
          break;
        }
        const result = await invoke<ContentSearchResult>("search_file_contents", {
          path: folderPath,
          query,
          showHidden: showHiddenFiles,
          maxResults: remaining,
        });
        allMatches = allMatches.concat(result.matches);
        if (result.truncated) anyTruncated = true;
      }

      setContentSearchResults(allMatches.slice(0, 100));
      setContentSearchTruncated(anyTruncated || allMatches.length > 100);
    } catch (error) {
      console.error("Content search failed:", error);
    } finally {
      setIsSearchingContent(false);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);

    // Immediate file name search
    if (value.trim()) {
      setFileNameMatches(collectFileNameMatches(value.trim()));
    } else {
      setFileNameMatches([]);
    }

    // Debounced content search
    if (contentSearchTimeoutRef.current) {
      clearTimeout(contentSearchTimeoutRef.current);
    }
    if (value.trim().length >= 2) {
      setIsSearchingContent(true);
      contentSearchTimeoutRef.current = setTimeout(() => {
        triggerContentSearch(value.trim());
      }, 300);
    } else {
      setContentSearchResults([]);
      setContentSearchTruncated(false);
      setIsSearchingContent(false);
    }
  };

  const handleCloseSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setFileNameMatches([]);
    setContentSearchResults([]);
    setContentSearchTruncated(false);
    setIsSearchingContent(false);
    if (contentSearchTimeoutRef.current) {
      clearTimeout(contentSearchTimeoutRef.current);
    }
  };

  const handleSearchResultClick = (match: FileNameMatch) => {
    if (match.isDir) {
      // Expand to this directory in the tree and close search
      setExpandedDirs(prev => {
        const next = new Set(prev);
        // Expand all parent dirs
        const parts = match.path.split("/");
        let current = "";
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          next.add(current);
        }
        return next;
      });
      handleCloseSearch();
    } else {
      // Open the file
      const absolutePath = `${match.basePath}/${match.path}`;
      if (isPreviewable(match.path) && onOpenMarkdown) {
        onOpenMarkdown(absolutePath);
      }
    }
  };

  const handleContentMatchClick = (match: ContentMatch) => {
    if (isPreviewable(match.path) && onOpenMarkdown) {
      onOpenMarkdown(match.absolutePath, match.lineNumber);
    }
  };

  // Cleanup search timeout on unmount
  useEffect(() => {
    return () => {
      if (contentSearchTimeoutRef.current) {
        clearTimeout(contentSearchTimeoutRef.current);
      }
    };
  }, []);

  // Reset search state when switching away from files view
  useEffect(() => {
    if (viewMode !== "files") {
      handleCloseSearch();
    }
  }, [viewMode]);

  const handleInitRepo = async () => {
    setIsInitializing(true);
    try {
      await onInitRepo();
    } finally {
      setIsInitializing(false);
    }
  };

  // Custom drag using mouse events (bypasses Tauri's drop interception)
  const handleFileDragStart = (e: React.MouseEvent, filePath: string, isDir = false, basePath?: string) => {
    // Only start drag on left mouse button
    if (e.button !== 0) return;

    // Ignore if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button, input, [role="menuitem"]')) return;

    const effectivePath = basePath || projectPath;
    const fullPath = filePath ? `"${effectivePath}/${filePath}"` : `"${effectivePath}"`;
    const fileName = filePath ? (filePath.split("/").pop() || filePath) : (effectivePath.split("/").pop() || effectivePath);
    const startX = e.clientX;
    const startY = e.clientY;
    const DRAG_THRESHOLD = 5; // pixels before drag starts
    let isDragging = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Only start drag after moving past threshold (allows double-click to work)
      if (!isDragging) {
        const deltaX = Math.abs(moveEvent.clientX - startX);
        const deltaY = Math.abs(moveEvent.clientY - startY);
        if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
          isDragging = true;
          (window as unknown as { __draggedFilePath?: string }).__draggedFilePath = fullPath;
          document.body.style.cursor = "grabbing";
        }
      }

      if (isDragging) {
        setDraggingFile({ name: fileName, x: moveEvent.clientX, y: moveEvent.clientY, isDir });
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        document.body.style.cursor = "";
        setDraggingFile(null);
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 100);
        // Don't clear path immediately - let terminal clear it after writing
        // Just clean up after a delay as fallback
        setTimeout(() => {
          (window as unknown as { __draggedFilePath?: string }).__draggedFilePath = undefined;
        }, 200);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleCopyPath = (filePath: string, basePath?: string) => {
    const fullPath = `${basePath || projectPath}/${filePath}`;
    navigator.clipboard.writeText(fullPath);
    toast.success("Path copied to clipboard");
  };

  const handleDeleteFile = async (filePath: string, basePath?: string) => {
    try {
      await invoke("delete_file", { path: `${basePath || projectPath}/${filePath}` });
      toast.success("File deleted");
      loadFileTree();
      onRefresh();
    } catch (error) {
      toast.error("Failed to delete file");
      console.error(error);
    }
  };

  const handleStartRename = (filePath: string, currentName: string) => {
    setRenamingFile(filePath);
    setRenameValue(currentName);
  };

  const handleFinishRename = async (oldPath: string, newName: string, basePath?: string) => {
    if (!newName.trim() || newName === oldPath.split('/').pop()) {
      setRenamingFile(null);
      return;
    }

    const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) : '';
    const newPath = dir + newName;
    const effectivePath = basePath || projectPath;

    try {
      await invoke("rename_file", {
        oldPath: `${effectivePath}/${oldPath}`,
        newPath: `${effectivePath}/${newPath}`
      });
      toast.success("File renamed");
      setRenamingFile(null);
      loadFileTree();
      onRefresh();
    } catch (error) {
      toast.error("Failed to rename file");
      console.error(error);
    }
  };

  const handleStartCreateFile = (dirPath: string) => {
    setCreatingFileInDir(dirPath);
    setNewFileValue("");
    if (dirPath) {
      setExpandedDirs(prev => new Set([...prev, dirPath]));
    }
    if (viewMode !== "files") {
      setViewMode("files");
    }
  };

  const handleFinishCreateFile = async (dirPath: string, fileName: string, basePath?: string) => {
    if (!fileName.trim()) {
      setCreatingFileInDir(null);
      return;
    }

    const effectivePath = basePath || projectPath;
    const fullPath = dirPath ? `${effectivePath}/${dirPath}/${fileName}` : `${effectivePath}/${fileName}`;

    try {
      await invoke("write_text_file", { path: fullPath, content: "" });
      toast.success(`Created ${fileName}`);
      setCreatingFileInDir(null);
      setNewFileValue("");
      loadFileTree();
      onRefresh();
    } catch (error) {
      toast.error("Failed to create file");
      console.error(error);
      setCreatingFileInDir(null);
    }
  };

  const handleOpenFile = (filePath: string, basePath?: string) => {
    invoke("open_in_finder", { path: `${basePath || projectPath}/${filePath}` });
  };

  const handleRevealInFileManager = (filePath: string, basePath?: string) => {
    invoke("reveal_in_file_manager", { path: `${basePath || projectPath}/${filePath}` });
  };

  // Platform-specific label for revealing files in file manager
  const getRevealLabel = () => {
    const platform = navigator.platform.toUpperCase();
    if (platform.indexOf('MAC') >= 0) return 'Reveal in Finder';
    if (platform.indexOf('WIN') >= 0) return 'Show in Explorer';
    return 'Show in File Manager';
  };

  const handleOpenInTerminalEditor = async (filePath: string, basePath?: string) => {
    if (!preferredEditor) {
      toast.error("No preferred editor set. Configure it in Settings.");
      return;
    }

    const effectivePath = basePath || projectPath;
    const fullPath = `${effectivePath}/${filePath}`;
    const fileName = filePath.split("/").pop() || filePath;
    const title = `${preferredEditor} - ${fileName}`;

    try {
      const params = new URLSearchParams({
        editor: preferredEditor,
        file: fullPath,
        cwd: effectivePath,
        title,
      });

      const webview = new WebviewWindow(`editor-${Date.now()}`, {
        url: `/terminal?${params.toString()}`,
        title,
        width: 900,
        height: 600,
        center: true,
        titleBarStyle: "overlay",
        hiddenTitle: true,
        visible: true,
      });

      webview.once("tauri://error", (e) => {
        console.error("Failed to create editor window:", e);
        toast.error(`Failed to open ${preferredEditor}`);
      });
    } catch (err) {
      toast.error(`Failed to open ${preferredEditor}: ${err}`);
    }
  };

  const openFileInEditorOrDefault = (absolutePath: string, basePath: string) => {
    if (preferredEditor) {
      const fileName = absolutePath.split("/").pop() || absolutePath;
      const title = `${preferredEditor} - ${fileName}`;

      try {
        const params = new URLSearchParams({
          editor: preferredEditor,
          file: absolutePath,
          cwd: basePath,
          title,
        });

        const webview = new WebviewWindow(`editor-${Date.now()}`, {
          url: `/terminal?${params.toString()}`,
          title,
          width: 900,
          height: 600,
          center: true,
          titleBarStyle: "overlay",
          hiddenTitle: true,
          visible: true,
        });

        webview.once("tauri://error", (e) => {
          console.error("Failed to create editor window:", e);
          toast.error(`Failed to open ${preferredEditor}`);
        });
      } catch (err) {
        toast.error(`Failed to open ${preferredEditor}: ${err}`);
      }
    } else {
      invoke("open_in_finder", { path: absolutePath });
    }
  };

  const refreshTreeForBasePath = (basePath: string) => {
    if (folders && folders.length > 0) {
      const folder = folders.find(f => f.path === basePath);
      if (folder) {
        loadFolderTree(folder.id, folder.path);
        setExpandedFolders(prev => {
          const next = new Set(prev);
          next.add(folder.id);
          return next;
        });
        return;
      }
    }
    loadFileTree();
  };

  const expandToPath = (path: string, basePath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      const parts = path.split("/");
      let current = "";
      for (const part of parts.slice(0, -1)) {
        current = current ? `${current}/${part}` : part;
        next.add(current);
      }
      return next;
    });
    if (folders && folders.length > 0) {
      const folder = folders.find(f => f.path === basePath);
      if (folder) {
        setExpandedFolders(prev => {
          const next = new Set(prev);
          next.add(folder.id);
          return next;
        });
      }
    }
  };

  const handleRenameFromSearch = (filePath: string, name: string, basePath: string) => {
    handleCloseSearch();
    expandToPath(filePath, basePath);
    setRenamingFile(filePath);
    setRenameValue(name);
  };

  const handleDeleteFileAbsolute = async (absolutePath: string, basePath: string) => {
    try {
      await invoke("delete_file", { path: absolutePath });
      toast.success("File deleted");
      refreshTreeForBasePath(basePath);
      onRefresh();
    } catch (error) {
      toast.error("Failed to delete file");
      console.error(error);
    }
  };

  const handleCopyPathAbsolute = (absolutePath: string) => {
    navigator.clipboard.writeText(absolutePath);
    toast.success("Path copied to clipboard");
  };

  const handleRevealAbsolute = (absolutePath: string) => {
    invoke("reveal_in_file_manager", { path: absolutePath });
  };

  const handleOpenAbsolute = (absolutePath: string) => {
    invoke("open_in_finder", { path: absolutePath });
  };

  const handleAddToGitignoreForBase = async (filePath: string, basePath: string) => {
    try {
      await invoke("add_to_gitignore", { repoPath: basePath, pattern: filePath });
      toast.success(`Added ${filePath} to .gitignore`);
      onRefresh();
    } catch (error) {
      toast.error("Failed to add to .gitignore");
      console.error(error);
    }
  };

  const getBasePathForContentMatch = (match: ContentMatch) => {
    const suffix = `/${match.path}`;
    if (match.absolutePath.endsWith(suffix)) {
      return match.absolutePath.slice(0, match.absolutePath.length - suffix.length);
    }
    return projectPath;
  };

  const generateCommitMessage = async () => {
    // Filter diffs to only include selected files
    const selectedDiffs = diffs.filter(d => filesToCommit.has(d.path));
    if (selectedDiffs.length === 0) return;

    if (!groqApiKey) {
      toast.error("Please set your Groq API key in Settings to generate AI commit messages.");
      // Fallback to a simple message
      const fileNames = selectedDiffs.map(d => d.path.split('/').pop()).join(', ');
      setCommitSubject(`Update ${fileNames}`);
      return;
    }

    setIsGenerating(true);
    try {
      const suggestion = await invoke<CommitSuggestion>("generate_commit_message", {
        diffs: selectedDiffs,
        apiKey: groqApiKey,
      });
      setCommitSubject(suggestion.subject);
      setCommitDescription(suggestion.description);
    } catch (error) {
      console.error("Failed to generate commit message:", error);
      // Fallback to a simple message
      const fileNames = selectedDiffs.map(d => d.path.split('/').pop()).join(', ');
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
    if (filesToCommit.size === 0) {
      toast.error("Please select at least one file to commit");
      return;
    }
    setIsCommitting(true);
    try {
      const fullMessage = commitDescription.trim()
        ? `${commitSubject}\n\n${commitDescription}`
        : commitSubject;
      const files = Array.from(filesToCommit);
      await invoke("commit", { repoPath: gitRepoPath, message: fullMessage, files });
      toast.success("Changes committed");
      setCommitSubject("");
      setCommitDescription("");
      onRefresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(errorMsg || "Failed to commit");
      console.error("Commit failed:", error);
    } finally {
      setIsCommitting(false);
    }
  };

  const handleUndoCommit = async () => {
    if (history.length < 2) {
      toast.error("No commit to undo");
      return;
    }
    setIsUndoing(true);
    try {
      const parentCommitId = history[1].id;
      await invoke("reset_to_commit", {
        repoPath: gitRepoPath,
        commitId: parentCommitId,
        mode: "soft"
      });
      toast.success("Commit undone");
      onRefresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(errorMsg || "Failed to undo commit");
      console.error("Undo commit failed:", error);
    } finally {
      setIsUndoing(false);
    }
  };

  const handlePull = async () => {
    setIsPulling(true);
    // Double RAF + timeout to ensure UI updates before blocking operation
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 10))));
    try {
      await invoke("pull_remote", { repoPath: gitRepoPath, remote: "origin" });
      toast.success("Pulled from remote");
      onRefresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(errorMsg || "Failed to pull");
      console.error(error);
    } finally {
      setIsPulling(false);
    }
  };

  const handlePush = async () => {
    setIsPushing(true);
    // Double RAF + timeout to ensure UI updates before blocking operation
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 10))));
    try {
      await invoke("push_remote", { repoPath: gitRepoPath, remote: "origin" });
      toast.success("Pushed to remote");
      onRefresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === "NO_UPSTREAM") {
        setShowPublishDialog(true);
      } else {
        toast.error(errorMsg || "Failed to push");
        console.error(error);
      }
    } finally {
      setIsPushing(false);
    }
  };

  const handlePublishBranch = async () => {
    setShowPublishDialog(false);
    setIsPushing(true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 10))));
    try {
      await invoke("publish_branch", { repoPath: gitRepoPath, remote: "origin" });
      toast.success("Branch published to remote");
      onRefresh();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      toast.error(errorMsg || "Failed to publish branch");
      console.error(error);
    } finally {
      setIsPushing(false);
    }
  };

  const handleResetToCommit = async (commitId: string, mode: "soft" | "hard") => {
    setIsResetting(true);
    try {
      await invoke("reset_to_commit", { repoPath: gitRepoPath, commitId, mode });
      toast.success(mode === "hard" ? "Reset to commit (hard)" : "Reset to commit (soft)");
      setCommitToReset(null);
      onRefresh();
    } catch (error) {
      toast.error("Failed to reset");
      console.error(error);
    } finally {
      setIsResetting(false);
    }
  };

  const handleRevertCommit = async (commitId: string) => {
    try {
      await invoke("revert_commit", { repoPath: gitRepoPath, commitId });
      toast.success("Commit reverted");
      onRefresh();
    } catch (error) {
      toast.error("Failed to revert commit");
      console.error(error);
    }
  };

  const toggleCommitExpand = async (commitId: string) => {
    const next = new Set(expandedCommits);
    if (next.has(commitId)) {
      next.delete(commitId);
    } else {
      next.add(commitId);
      // Fetch diff if not cached
      if (!commitDiffs.has(commitId)) {
        setLoadingCommitDiffs(prev => new Set(prev).add(commitId));
        try {
          const diffs = await invoke<FileDiff[]>("get_commit_diff", {
            repoPath: gitRepoPath,
            commitId,
          });
          setCommitDiffs(prev => new Map(prev).set(commitId, diffs));
        } catch (error) {
          toast.error("Failed to load commit diff");
          console.error(error);
          next.delete(commitId);
        } finally {
          setLoadingCommitDiffs(prev => {
            const s = new Set(prev);
            s.delete(commitId);
            return s;
          });
        }
      }
    }
    setExpandedCommits(next);
  };

  const toggleCommitFile = (commitId: string, filePath: string) => {
    const key = `${commitId}:${filePath}`;
    setExpandedCommitFiles(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDiscardFile = async (filePath: string) => {
    try {
      await invoke("discard_file", { repoPath: gitRepoPath, filePath });
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

  const handleAddToGitignore = async (filePath: string, basePath?: string) => {
    try {
      await invoke("add_to_gitignore", { repoPath: basePath || gitRepoPath, pattern: filePath });
      toast.success(`Added ${filePath} to .gitignore`);
      onRefresh();
    } catch (error) {
      toast.error("Failed to add to .gitignore");
      console.error(error);
    }
  };

  const handleOpenRemoteUrl = async () => {
    try {
      const url = await invoke<string>("get_remote_url", { repoPath: gitRepoPath });
      await openUrl(url);
    } catch (error) {
      toast.error("Failed to open remote URL");
      console.error(error);
    }
  };

  const handleDiscardSelected = async () => {
    if (selectedFiles.size === 0) return;
    setIsDiscardingSelected(true);
    try {
      const filesToDiscard = Array.from(selectedFiles);
      for (const filePath of filesToDiscard) {
        await invoke("discard_file", { repoPath: gitRepoPath, filePath });
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
      await invoke("create_branch", { repoPath: gitRepoPath, name: newBranchName });
      toast.success(`Created branch ${newBranchName}`);
      // Automatically switch to the new branch
      await invoke("checkout_branch", { repoPath: gitRepoPath, branch: newBranchName });
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
      await invoke("checkout_branch", { repoPath: gitRepoPath, branch: branchName });
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

  const toggleFileToCommit = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFilesToCommit((prev) => {
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
        return "bg-primary";
    }
  };

  const [fileToDiscard, setFileToDiscard] = useState<string | null>(null);
  const [hunkToDiscard, setHunkToDiscard] = useState<HunkToDiscard | null>(null);
  const [editingLine, setEditingLine] = useState<{ filePath: string; lineNo: number; content: string } | null>(null);

  const handleEditLine = async (filePath: string, lineNo: number, newContent: string) => {
    try {
      const fullPath = `${projectPath}/${filePath}`;
      await invoke("edit_file_line", {
        filePath: fullPath,
        lineNumber: lineNo,
        newContent,
      });
      setEditingLine(null);
      onRefresh();
    } catch (error) {
      toast.error(`Failed to edit line: ${error}`);
    }
  };

  const handleDiscardHunk = async (filePath: string, hunk: DiffHunk) => {
    try {
      // Convert hunk lines to the format expected by the backend
      const lines = hunk.lines.map(line => {
        const prefix = line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' ';
        return prefix + line.content;
      });

      await invoke("discard_hunk", {
        repoPath: gitRepoPath,
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

    // Check if file is an image
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'];
    const isImage = imageExtensions.some(ext => diff.path.toLowerCase().endsWith(ext));

    // Check if file has diff content (non-binary)
    const hasDiff = diff.hunks.length > 0;

    // Can expand if it's an image or has diff content
    const canExpand = isImage || hasDiff;

    return (
      <div
        className="group cursor-grab active:cursor-grabbing"
        onMouseDown={(e) => handleFileDragStart(e, diff.path)}
      >
        {/* File row with context menu */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              tabIndex={0}
              role="button"
              className={cn(
                "relative flex items-center gap-2 rounded pr-8 py-1.5 transition-colors cursor-grab active:cursor-grabbing",
                isSelected ? "bg-primary/20" : "hover:bg-muted/50"
              )}
              onClick={(e) => handleFileClick(diff.path, index, e)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleFileExpanded(diff.path);
                }
              }}
              onDoubleClick={() => {
                if (isPreviewable(diff.path) && onOpenMarkdown) {
                  onOpenMarkdown(`${projectPath}/${diff.path}`);
                }
              }}
            >
              {canExpand ? (
                isExpanded ? (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                )
              ) : (
                <span className="h-3 w-3 shrink-0" /> // Placeholder for alignment
              )}
              <button
                role="checkbox"
                aria-checked={filesToCommit.has(diff.path)}
                aria-label={`Stage ${diff.path} for commit`}
                onClick={(e) => toggleFileToCommit(diff.path, e)}
                className={cn(
                  "h-3.5 w-3.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors",
                  filesToCommit.has(diff.path)
                    ? cn(getStatusColor(diff.status), "border-transparent")
                    : "border-muted-foreground/50 bg-transparent"
                )}
              >
                {filesToCommit.has(diff.path) && (
                  <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                )}
              </button>
              <span className="sr-only">
                {diff.status === "added" ? "New file" : diff.status === "deleted" ? "Deleted" : "Modified"}
              </span>
              <div className="flex-1 min-w-0">
                <span className="block break-all font-mono text-xs">{diff.path}</span>
              </div>
              {/* Discard button - shows on hover, positioned over content on right */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Discard changes to ${diff.path}`}
                className="absolute right-5 top-1/2 -translate-y-1/2 h-5 w-5 opacity-0 group-hover:opacity-100 bg-background/80 hover:bg-muted"
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
            <ContextMenuItem onClick={() => handleOpenFile(diff.path)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open
            </ContextMenuItem>
            {isPreviewable(diff.path) && onOpenMarkdown && (
              <ContextMenuItem onClick={() => onOpenMarkdown(`${projectPath}/${diff.path}`)}>
                <FileIcon className="mr-2 h-4 w-4" />
                Open Here
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => handleRevealInFileManager(diff.path)}>
              <FolderOpen className="mr-2 h-4 w-4" />
              {getRevealLabel()}
            </ContextMenuItem>
            {preferredEditor && (
              <ContextMenuItem onClick={() => handleOpenInTerminalEditor(diff.path)}>
                <SquareTerminal className="mr-2 h-4 w-4" />
                Open in {preferredEditor}
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={() => handleStartCreateFile("")}>
              <FilePlus className="mr-2 h-4 w-4" />
              New File
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setFileToDiscard(diff.path)}
            >
              <Undo2 className="mr-2 h-4 w-4" />
              Discard changes
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => handleAddToGitignore(diff.path)}>
              <EyeOff className="mr-2 h-4 w-4" />
              Add to .gitignore
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Inline diff view / image preview / binary indicator */}
        {isExpanded && (
          <div className="ml-5 mt-1 overflow-hidden rounded bg-[#0d0d0d]">
            <div className="p-2 select-text">
              {isImage ? (
                /* Image preview */
                <div className="flex flex-col items-center gap-2 py-2">
                  <img
                    src={`asset://localhost/${projectPath}/${diff.path}`}
                    alt={diff.path}
                    className="max-w-full max-h-48 rounded border border-border object-contain"
                    onError={(e) => {
                      // Hide broken image and show placeholder
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                  <div className="hidden flex-col items-center gap-1 text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-xs">Image preview unavailable</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {diff.status === "added" ? "New image" : diff.status === "deleted" ? "Deleted image" : "Modified image"}
                  </span>
                </div>
              ) : hasDiff ? (
                /* Text diff */
                <div className="font-mono text-[10px] leading-relaxed">
                  {diff.hunks.map((hunk, hi) => (
                    <ContextMenu key={hi}>
                      <ContextMenuTrigger asChild>
                        <div className="rounded hover:bg-white/5 -mx-1 px-1">
                          <div className="text-muted-foreground">
                            @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                          </div>
                          {hunk.lines.map((line, li) => {
                            const isEditable = line.type !== "deletion" && line.newLineNo;
                            const isEditing = editingLine?.filePath === diff.path && editingLine?.lineNo === line.newLineNo;

                            return (
                              <div
                                key={li}
                                className={cn(
                                  "whitespace-pre-wrap break-words group/line",
                                  line.type === "addition" && "bg-green-500/10 text-green-400",
                                  line.type === "deletion" && "bg-red-500/10 text-red-400 cursor-not-allowed",
                                  line.type === "context" && "text-muted-foreground",
                                  isEditable && !isEditing && "cursor-text hover:bg-white/5"
                                )}
                                onClick={() => {
                                  if (isEditable && !isEditing && line.newLineNo) {
                                    setEditingLine({ filePath: diff.path, lineNo: line.newLineNo, content: line.content });
                                  }
                                }}
                              >
                                {line.type === "addition" && <><span className="sr-only">Added: </span>+</>}
                                {line.type === "deletion" && <><span className="sr-only">Removed: </span>-</>}
                                {line.type === "context" && " "}
                                {isEditing ? (
                                  <input
                                    type="text"
                                    autoFocus
                                    defaultValue={line.content}
                                    className="bg-blue-500/20 border-none outline-none ring-1 ring-blue-500/50 rounded px-1 -mx-1 w-full text-inherit font-mono"
                                    style={{ fontSize: 'inherit' }}
                                    onBlur={(e) => handleEditLine(diff.path, line.newLineNo!, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleEditLine(diff.path, line.newLineNo!, e.currentTarget.value);
                                      } else if (e.key === "Escape") {
                                        setEditingLine(null);
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                ) : (
                                  line.content
                                )}
                              </div>
                            );
                          })}
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
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => handleAddToGitignore(diff.path)}>
                          <EyeOff className="mr-2 h-4 w-4" />
                          Add to .gitignore
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              ) : (
                /* Binary file with no diff */
                <div className="flex items-center gap-2 py-2 text-muted-foreground">
                  <FileIcon className="h-4 w-4" />
                  <span className="text-xs">Binary file changed</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // File tree recursive component
  const FileTreeView = ({
    nodes,
    expandedDirs,
    onToggleDir,
    projectPath,
    depth = 0
  }: {
    nodes: FileTreeNode[];
    expandedDirs: Set<string>;
    onToggleDir: (path: string) => void;
    projectPath: string;
    depth?: number;
  }) => (
    <div className={cn(depth > 0 && "ml-3 border-l border-border/50 pl-2")}>
      {nodes.map((node) => (
        <div key={node.path}>
          {node.isDir ? (
            <>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-muted/50 cursor-grab active:cursor-grabbing"
                    onMouseDown={(e) => handleFileDragStart(e, node.path, true, projectPath)}
                    onClick={() => { if (!justDraggedRef.current) onToggleDir(node.path); }}
                  >
                    {expandedDirs.has(node.path) ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs truncate">{node.name}</span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => handleStartCreateFile(node.path)}>
                    <FilePlus className="mr-2 h-4 w-4" />
                    New File
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleRevealInFileManager(node.path, projectPath)}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    {getRevealLabel()}
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleCopyPath(node.path, projectPath)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Path
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleAddToGitignore(node.path, projectPath)}>
                    <EyeOff className="mr-2 h-4 w-4" />
                    Add to .gitignore
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {expandedDirs.has(node.path) && (
                <div className={cn(depth >= 0 && "ml-3 border-l border-border/50 pl-2")}>
                  {creatingFileInDir === node.path && (
                    <div className="flex items-center gap-1.5 py-1 px-1 pl-5">
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        value={newFileValue}
                        onChange={(e) => setNewFileValue(e.target.value)}
                        onBlur={() => handleFinishCreateFile(node.path, newFileValue, projectPath)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishCreateFile(node.path, newFileValue, projectPath);
                          if (e.key === "Escape") setCreatingFileInDir(null);
                        }}
                        autoFocus
                        placeholder="filename"
                        className="text-xs bg-muted border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary w-full"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  {node.children && (
                    <FileTreeView
                      nodes={node.children}
                      expandedDirs={expandedDirs}
                      onToggleDir={onToggleDir}
                      projectPath={projectPath}
                      depth={depth + 1}
                    />
                  )}
                </div>
              )}
            </>
          ) : (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  className="flex items-center gap-1.5 py-1 px-1 pl-5 rounded hover:bg-muted/50 cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => renamingFile !== node.path && handleFileDragStart(e, node.path, false, projectPath)}
                  onDoubleClick={() => {
                    if (isPreviewable(node.path) && onOpenMarkdown) {
                      onOpenMarkdown(`${projectPath}/${node.path}`);
                    }
                  }}
                >
                  <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {renamingFile === node.path ? (
                    <input
                      type="text"
                      defaultValue={renameValue}
                      onBlur={(e) => handleFinishRename(node.path, e.target.value, projectPath)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleFinishRename(node.path, e.currentTarget.value, projectPath);
                        if (e.key === "Escape") setRenamingFile(null);
                      }}
                      autoFocus
                      className="text-xs bg-muted border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary w-full"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="text-xs truncate">{node.name}</span>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => handleOpenFile(node.path, projectPath)}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open
                </ContextMenuItem>
                {isPreviewable(node.path) && onOpenMarkdown && (
                  <ContextMenuItem onClick={() => onOpenMarkdown(`${projectPath}/${node.path}`)}>
                    <FileIcon className="mr-2 h-4 w-4" />
                    Open Here
                  </ContextMenuItem>
                )}
                <ContextMenuItem onClick={() => handleRevealInFileManager(node.path, projectPath)}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {getRevealLabel()}
                </ContextMenuItem>
                {preferredEditor && (
                  <ContextMenuItem onClick={() => handleOpenInTerminalEditor(node.path, projectPath)}>
                    <SquareTerminal className="mr-2 h-4 w-4" />
                    Open in {preferredEditor}
                  </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => handleCopyPath(node.path, projectPath)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Path
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  const parentDir = node.path.includes('/') ? node.path.substring(0, node.path.lastIndexOf('/')) : '';
                  handleStartCreateFile(parentDir);
                }}>
                  <FilePlus className="mr-2 h-4 w-4" />
                  New File
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleStartRename(node.path, node.name)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleAddToGitignore(node.path, projectPath)}>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Add to .gitignore
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => handleDeleteFile(node.path, projectPath)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden select-none">
      <h2 className="sr-only">Git Panel</h2>
      {/* Aria-live region for git operation status */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {isPulling && "Pulling from remote..."}
        {isPushing && "Pushing to remote..."}
        {isCommitting && "Committing changes..."}
        {loading && "Refreshing git status..."}
      </div>
      {/* Floating drag indicator */}
      {draggingFile && (
        <div
          className="fixed pointer-events-none z-50 flex items-center gap-2 px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium shadow-lg"
          style={{
            left: draggingFile.x + 12,
            top: draggingFile.y + 12,
          }}
        >
          {draggingFile.isDir ? <Folder className="h-3.5 w-3.5" /> : <File className="h-3.5 w-3.5" />}
          {draggingFile.name}
        </div>
      )}

      {/* Header with actions only */}
      <div className="flex h-10 items-center justify-end gap-1 px-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={isPulling ? "Pulling..." : status && status.behind > 0 ? `Pull (${status.behind} behind)` : "Pull"}
                className={cn("h-7 w-7 relative", isPulling && "text-primary")}
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
                    {status.behind}<span className="sr-only"> commits behind</span>
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
                aria-label={isPushing ? "Pushing..." : status && status.ahead > 0 ? `Push (${status.ahead} ahead)` : "Push"}
                className={cn("h-7 w-7 relative", isPushing && "text-primary")}
                onClick={handlePush}
                disabled={isPushing}
              >
                {isPushing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="h-3.5 w-3.5" />
                )}
                {!isPushing && status && status.ahead > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium text-primary-foreground">
                    {status.ahead}<span className="sr-only"> commits ahead</span>
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
                aria-label="Refresh"
                className="h-7 w-7"
                onClick={() => onRefresh(gitRepoPath)}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={viewMode === "history" ? "Show changes" : "Show history"}
                className={cn("h-7 w-7", viewMode === "history" && "bg-muted text-foreground")}
                onClick={() => setViewMode(viewMode === "history" ? "changes" : "history")}
              >
                <History className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{viewMode === "history" ? "Show Changes" : "Show History"}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={viewMode === "files" ? "Show changes" : "Browse files"}
                className={cn("h-7 w-7", viewMode === "files" && "bg-muted text-foreground")}
                onClick={() => setViewMode(viewMode === "files" ? "changes" : "files")}
              >
                <FolderTree className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{viewMode === "files" ? "Show Changes" : "Browse Files"}</TooltipContent>
          </Tooltip>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-4 pb-4 pt-4">
          {/* Project name (with folder selector chevron if multiple folders) and branch - hidden in files view */}
          {viewMode !== "files" && (
            <div className="flex items-center gap-1.5 mb-4 flex-wrap">
              {folders && folders.length > 1 ? (
                /* Multi-folder: active folder name with chevron dropdown */
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-1.5 text-sm font-medium hover:bg-muted/50 max-w-[120px]"
                          >
                            <span className="truncate">{activeFolder?.name || projectName}</span>
                            <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto">
                          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                            Folders
                          </div>
                          {folders.map((folder) => (
                            <DropdownMenuItem
                              key={folder.id}
                              onClick={() => setActiveFolderId(folder.id)}
                              className="flex items-center justify-between"
                            >
                              <span className="truncate">{folder.name}</span>
                              {folder.id === activeFolderId && <Check className="h-3 w-3 text-primary" />}
                            </DropdownMenuItem>
                          ))}
                          {onAddFolder && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={onAddFolder}>
                                <Plus className="mr-2 h-3 w-3" />
                                Add Folder to Workspace
                              </DropdownMenuItem>
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
              ) : (
                /* Single folder: just show project name */
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <span className="text-sm font-medium truncate">{projectName}</span>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={handleOpenRemoteUrl}>
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      Open Remote URL
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )}
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
                <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto">
                  {localBranches.length > 0 && (
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Local
                    </div>
                  )}
                  {localBranches.map((branch) => (
                    <DropdownMenuItem
                      key={branch.name}
                      onClick={() => handleSwitchBranch(branch.name)}
                      className="flex items-center justify-between"
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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowBranchDialog(true)}>
                    <Plus className="mr-2 h-3 w-3" />
                    New branch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Changes View */}
          {viewMode === "changes" && (
            <>
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

              {/* No changes message or not a git repo */}
              {diffs.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <div className="flex flex-col items-center text-center max-w-[200px]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-4">
                      <GitCommit className="h-6 w-6 text-muted-foreground" />
                    </div>
                    {isGitRepo ? (
                      <>
                        <p className="text-sm font-medium text-muted-foreground mb-1">
                          No changes
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          Your working directory is clean
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-muted-foreground mb-1">
                          No git repo detected
                        </p>
                        <p className="text-xs text-muted-foreground/70 mb-4">
                          Initialize a repository to track changes
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleInitRepo}
                          disabled={isInitializing}
                          className="gap-2"
                        >
                          {isInitializing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <GitBranch className="h-3.5 w-3.5" />
                          )}
                          {isInitializing ? "Initializing..." : "Initialize Git Repo"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* History View */}
          {viewMode === "history" && (
            <div className="space-y-1">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Commit History
              </h3>
              {history.length > 0 ? (
                history.map((commit) => {
                  const isExpanded = expandedCommits.has(commit.id);
                  const isLoading = loadingCommitDiffs.has(commit.id);
                  const fileDiffs = commitDiffs.get(commit.id);

                  return (
                    <div key={commit.id}>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div
                            className={cn(
                              "group flex items-start gap-2 rounded px-2 py-2 hover:bg-muted/50 cursor-pointer overflow-hidden",
                              isExpanded && "bg-muted/30"
                            )}
                            onClick={() => toggleCommitExpand(commit.id)}
                          >
                            <div className="pt-0.5 shrink-0">
                              {isLoading ? (
                                <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
                              ) : isExpanded ? (
                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-xs font-medium leading-snug break-words">{commit.message.split('\n')[0]}</span>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <GitCommit className="h-3 w-3 shrink-0" />
                                <span className="truncate">{commit.author}</span>
                                <span className="shrink-0">·</span>
                                <span className="shrink-0">{formatTimestamp(commit.timestamp)}</span>
                              </div>
                            </div>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => {
                            navigator.clipboard.writeText(commit.id);
                            toast.success("SHA copied to clipboard");
                          }}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy SHA
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => handleRevertCommit(commit.id)}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Revert this commit
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => setCommitToReset(commit.id)}>
                            <Undo2 className="mr-2 h-4 w-4" />
                            Reset to this commit...
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>

                      {/* Expanded commit file list */}
                      {isExpanded && fileDiffs && (
                        <div className="ml-5 mt-1 mb-2 space-y-0.5">
                          {fileDiffs.length === 0 ? (
                            <div className="text-[10px] text-muted-foreground px-2 py-1">No file changes</div>
                          ) : (
                            fileDiffs.map((diff) => {
                              const fileKey = `${commit.id}:${diff.path}`;
                              const isFileExpanded = expandedCommitFiles.has(fileKey);

                              const fileExists = diff.status !== "deleted";

                              return (
                                <div key={diff.path}>
                                  <ContextMenu>
                                    <ContextMenuTrigger asChild>
                                      <div
                                        className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50 cursor-pointer"
                                        onClick={() => toggleCommitFile(commit.id, diff.path)}
                                      >
                                        {diff.hunks.length > 0 ? (
                                          isFileExpanded ? (
                                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                                          ) : (
                                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                          )
                                        ) : (
                                          <span className="h-3 w-3 shrink-0" />
                                        )}
                                        <span className={cn(
                                          "h-2 w-2 shrink-0 rounded-full",
                                          getStatusColor(diff.status)
                                        )} />
                                        <span className="font-mono text-[10px] break-all min-w-0">{diff.path}</span>
                                      </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                      {fileExists && (
                                        <ContextMenuItem onClick={() => handleOpenFile(diff.path)}>
                                          <ExternalLink className="mr-2 h-4 w-4" />
                                          Open
                                        </ContextMenuItem>
                                      )}
                                      {fileExists && isPreviewable(diff.path) && onOpenMarkdown && (
                                        <ContextMenuItem onClick={() => onOpenMarkdown(`${projectPath}/${diff.path}`)}>
                                          <FileIcon className="mr-2 h-4 w-4" />
                                          Open Here
                                        </ContextMenuItem>
                                      )}
                                      {fileExists && (
                                        <ContextMenuItem onClick={() => handleRevealInFileManager(diff.path)}>
                                          <FolderOpen className="mr-2 h-4 w-4" />
                                          {getRevealLabel()}
                                        </ContextMenuItem>
                                      )}
                                      {fileExists && preferredEditor && (
                                        <ContextMenuItem onClick={() => handleOpenInTerminalEditor(diff.path)}>
                                          <SquareTerminal className="mr-2 h-4 w-4" />
                                          Open in {preferredEditor}
                                        </ContextMenuItem>
                                      )}
                                      {fileExists && <ContextMenuSeparator />}
                                      <ContextMenuItem onClick={() => handleCopyPath(diff.path)}>
                                        <Copy className="mr-2 h-4 w-4" />
                                        Copy Path
                                      </ContextMenuItem>
                                    </ContextMenuContent>
                                  </ContextMenu>

                                  {/* Inline diff for expanded file */}
                                  {isFileExpanded && diff.hunks.length > 0 && (
                                    <div className="ml-5 mt-1 overflow-hidden rounded bg-[#0d0d0d]">
                                      <div className="p-2 select-text">
                                        <div className="font-mono text-[10px] leading-relaxed">
                                          {diff.hunks.map((hunk, hi) => (
                                            <div key={hi}>
                                              <div className="text-muted-foreground">
                                                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
                                              </div>
                                              {hunk.lines.map((line, li) => (
                                                <div
                                                  key={li}
                                                  className={cn(
                                                    "whitespace-pre-wrap break-words",
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
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <div className="flex flex-col items-center text-center max-w-[200px]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-4">
                      <History className="h-6 w-6 text-muted-foreground" />
                    </div>
                    {isGitRepo ? (
                      <>
                        <p className="text-sm font-medium text-muted-foreground mb-1">
                          No commit history
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          Make your first commit to start tracking
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-muted-foreground mb-1">
                          No git repo detected
                        </p>
                        <p className="text-xs text-muted-foreground/70 mb-4">
                          Initialize a repository to track changes
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleInitRepo}
                          disabled={isInitializing}
                          className="gap-2"
                        >
                          {isInitializing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <GitBranch className="h-3.5 w-3.5" />
                          )}
                          {isInitializing ? "Initializing..." : "Initialize Git Repo"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Files View */}
          {viewMode === "files" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between mb-2">
                {folders && folders.length > 1 ? (
                  /* Multi-folder workspace header */
                  isEditingWorkspaceName ? (
                    <input
                      type="text"
                      value={editedWorkspaceName}
                      onChange={(e) => setEditedWorkspaceName(e.target.value)}
                      onBlur={() => {
                        setIsEditingWorkspaceName(false);
                        if (editedWorkspaceName.trim() && onRenameWorkspace) {
                          onRenameWorkspace(editedWorkspaceName.trim());
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setIsEditingWorkspaceName(false);
                          if (editedWorkspaceName.trim() && onRenameWorkspace) {
                            onRenameWorkspace(editedWorkspaceName.trim());
                          }
                        } else if (e.key === "Escape") {
                          setIsEditingWorkspaceName(false);
                          setEditedWorkspaceName(workspaceName || "My Workspace");
                        }
                      }}
                      autoFocus
                      className="text-sm font-medium bg-muted border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary w-32"
                    />
                  ) : (
                    <span className="text-sm font-medium">{workspaceName || "My Workspace"}</span>
                  )
                ) : (
                  /* Single folder header */
                  <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Project Files
                  </h3>
                )}
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={isSearchOpen ? "Close search" : "Search files"}
                    className={cn("h-5 w-5", isSearchOpen && "text-primary")}
                    onClick={() => {
                      if (isSearchOpen) {
                        handleCloseSearch();
                      } else {
                        setIsSearchOpen(true);
                        setTimeout(() => searchInputRef.current?.focus(), 50);
                      }
                    }}
                  >
                    <Search className="h-3 w-3 text-muted-foreground" />
                  </Button>
                  {folders && folders.length > 0 ? (
                    /* Ellipsis menu with all options */
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-5 w-5">
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => {
                          if (folders && folders.length > 0) {
                            loadAllFolderTrees();
                          } else {
                            loadFileTree();
                          }
                        }}>
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          Refresh
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {onAddFolder && (
                          <DropdownMenuItem onClick={onAddFolder}>
                            <Plus className="mr-2 h-3.5 w-3.5" />
                            Add Folder
                          </DropdownMenuItem>
                        )}
                        {folders && folders.length > 1 && (
                          <>
                            <DropdownMenuItem onClick={() => {
                              setEditedWorkspaceName(workspaceName || "My Workspace");
                              setIsEditingWorkspaceName(true);
                            }}>
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Rename Workspace
                            </DropdownMenuItem>
                            {onSaveWorkspace && (
                              <DropdownMenuItem onClick={onSaveWorkspace}>
                                <Save className="mr-2 h-3.5 w-3.5" />
                                Save Workspace
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    /* Single folder: just refresh button */
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Refresh files"
                      className="h-5 w-5"
                      onClick={() => loadFileTree()}
                      disabled={isLoadingFiles}
                    >
                      <RefreshCw className={cn("h-3 w-3", isLoadingFiles && "animate-spin")} />
                    </Button>
                  )}
                </div>
              </div>
              {/* Search input panel */}
              {isSearchOpen && (
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") handleCloseSearch();
                    }}
                    placeholder="Search files and content..."
                    aria-label="Search files"
                    className="w-full text-xs bg-muted border border-border rounded pl-7 pr-7 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                  />
                  {isSearchingContent && (
                    <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
              )}
              {/* Search results (replaces file tree when query is active) */}
              {isSearchOpen && searchQuery.trim() ? (
                <div className="space-y-3">
                  {/* File Name matches */}
                  {fileNameMatches.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                        File Names ({fileNameMatches.length})
                      </h4>
                      <div className="space-y-0.5">
                        {fileNameMatches.map((match, i) => (
                          <ContextMenu key={`fn-${i}`}>
                            <ContextMenuTrigger asChild>
                              <div
                                className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer"
                                onClick={(e) => {
                                  if (e.detail > 1) return;
                                  handleSearchResultClick(match);
                                }}
                                onDoubleClick={() => {
                                  if (!match.isDir && isPreviewable(match.path) && onOpenMarkdown) {
                                    onOpenMarkdown(`${match.basePath}/${match.path}`);
                                  }
                                }}
                              >
                                {match.isDir ? (
                                  <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                                ) : (
                                  <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                )}
                                <span className="text-xs font-medium truncate">{match.name}</span>
                                <span className="text-[10px] text-muted-foreground truncate ml-auto">{match.path}</span>
                              </div>
                            </ContextMenuTrigger>
                            {match.isDir ? (
                              <ContextMenuContent>
                                <ContextMenuItem onClick={() => handleRevealAbsolute(`${match.basePath}/${match.path}`)}>
                                  <FolderOpen className="mr-2 h-4 w-4" />
                                  {getRevealLabel()}
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => handleCopyPathAbsolute(`${match.basePath}/${match.path}`)}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copy Path
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem onClick={() => handleAddToGitignoreForBase(match.path, match.basePath)}>
                                  <EyeOff className="mr-2 h-4 w-4" />
                                  Add to .gitignore
                                </ContextMenuItem>
                              </ContextMenuContent>
                            ) : (
                              <ContextMenuContent>
                                <ContextMenuItem onClick={() => handleOpenAbsolute(`${match.basePath}/${match.path}`)}>
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Open
                                </ContextMenuItem>
                                {isPreviewable(match.path) && onOpenMarkdown && (
                                  <ContextMenuItem onClick={() => onOpenMarkdown(`${match.basePath}/${match.path}`)}>
                                    <FileIcon className="mr-2 h-4 w-4" />
                                    Open Here
                                  </ContextMenuItem>
                                )}
                                <ContextMenuItem onClick={() => handleRevealAbsolute(`${match.basePath}/${match.path}`)}>
                                  <FolderOpen className="mr-2 h-4 w-4" />
                                  {getRevealLabel()}
                                </ContextMenuItem>
                                {preferredEditor && (
                                  <ContextMenuItem onClick={() => openFileInEditorOrDefault(`${match.basePath}/${match.path}`, match.basePath)}>
                                    <SquareTerminal className="mr-2 h-4 w-4" />
                                    Open in {preferredEditor}
                                  </ContextMenuItem>
                                )}
                                <ContextMenuSeparator />
                                <ContextMenuItem onClick={() => handleCopyPathAbsolute(`${match.basePath}/${match.path}`)}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copy Path
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => handleRenameFromSearch(match.path, match.name, match.basePath)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Rename
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => handleAddToGitignoreForBase(match.path, match.basePath)}>
                                  <EyeOff className="mr-2 h-4 w-4" />
                                  Add to .gitignore
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onClick={() => handleDeleteFileAbsolute(`${match.basePath}/${match.path}`, match.basePath)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </ContextMenuItem>
                              </ContextMenuContent>
                            )}
                          </ContextMenu>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Content matches */}
                  {contentSearchResults.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                        Content Matches ({contentSearchResults.length}{contentSearchTruncated ? "+" : ""})
                      </h4>
                      <div className="space-y-0.5">
                        {contentSearchResults.map((match, i) => (
                          <ContextMenu key={`cm-${i}`}>
                            <ContextMenuTrigger asChild>
                              <div
                                className="flex flex-col gap-0.5 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer"
                                onClick={(e) => {
                                  if (e.detail > 1) return;
                                  handleContentMatchClick(match);
                                }}
                                onDoubleClick={() => {
                                  if (isPreviewable(match.path) && onOpenMarkdown) {
                                    onOpenMarkdown(match.absolutePath, match.lineNumber);
                                  }
                                }}
                              >
                                <div className="flex items-center gap-1.5">
                                  <File className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className="text-[11px] text-muted-foreground truncate">
                                    {match.path}:{match.lineNumber}
                                  </span>
                                </div>
                                <span className="text-[11px] font-mono text-foreground/80 truncate pl-[18px]">
                                  {match.line.trim()}
                                </span>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => handleOpenAbsolute(match.absolutePath)}>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Open
                              </ContextMenuItem>
                              {isPreviewable(match.path) && onOpenMarkdown && (
                                <ContextMenuItem onClick={() => onOpenMarkdown(match.absolutePath, match.lineNumber)}>
                                  <FileIcon className="mr-2 h-4 w-4" />
                                  Open Here
                                </ContextMenuItem>
                              )}
                              <ContextMenuItem onClick={() => handleRevealAbsolute(match.absolutePath)}>
                                <FolderOpen className="mr-2 h-4 w-4" />
                                {getRevealLabel()}
                              </ContextMenuItem>
                              {preferredEditor && (
                                <ContextMenuItem onClick={() => openFileInEditorOrDefault(match.absolutePath, getBasePathForContentMatch(match))}>
                                  <SquareTerminal className="mr-2 h-4 w-4" />
                                  Open in {preferredEditor}
                                </ContextMenuItem>
                              )}
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={() => handleCopyPathAbsolute(match.absolutePath)}>
                                <Copy className="mr-2 h-4 w-4" />
                                Copy Path
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => handleRenameFromSearch(match.path, match.path.split("/").pop() || match.path, getBasePathForContentMatch(match))}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Rename
                              </ContextMenuItem>
                              <ContextMenuItem onClick={() => handleAddToGitignoreForBase(match.path, getBasePathForContentMatch(match))}>
                                <EyeOff className="mr-2 h-4 w-4" />
                                Add to .gitignore
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => handleDeleteFileAbsolute(match.absolutePath, getBasePathForContentMatch(match))}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Empty state */}
                  {fileNameMatches.length === 0 && contentSearchResults.length === 0 && !isSearchingContent && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <Search className="mb-2 h-6 w-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No results found</p>
                    </div>
                  )}
                </div>
              ) : isLoadingFiles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : folders && folders.length > 0 ? (
                /* Multi-folder view - show all folders as collapsible roots (Issue #6) */
                <div className="space-y-1">
                  {folders.map((folder) => (
                    <div key={folder.id}>
                      {/* Folder header - collapsible + draggable */}
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div
                            className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-muted/50 cursor-grab active:cursor-grabbing"
                            onMouseDown={(e) => handleFileDragStart(e, '', true, folder.path)}
                            onClick={() => { if (!justDraggedRef.current) toggleFolderExpanded(folder.id); }}
                          >
                            {expandedFolders.has(folder.id) ? (
                              <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                            )}
                            <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="text-xs font-medium truncate">{folder.name}</span>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => invoke("reveal_in_file_manager", { path: folder.path })}>
                            <FolderOpen className="mr-2 h-4 w-4" />
                            {getRevealLabel()}
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => { navigator.clipboard.writeText(folder.path); toast.success("Path copied to clipboard"); }}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Path
                          </ContextMenuItem>
                          {onRemoveFolder && folders && folders.length > 1 && (
                            <>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => onRemoveFolder(folder.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                <FolderMinus className="mr-2 h-4 w-4" />
                                Remove from Workspace
                              </ContextMenuItem>
                            </>
                          )}
                        </ContextMenuContent>
                      </ContextMenu>
                      {/* Folder contents */}
                      {expandedFolders.has(folder.id) && (
                        <div className="ml-3 border-l border-border/50 pl-2">
                          {fileTrees[folder.id] ? (
                            fileTrees[folder.id].length > 0 ? (
                              <FileTreeView
                                nodes={fileTrees[folder.id]}
                                expandedDirs={expandedDirs}
                                onToggleDir={toggleDir}
                                projectPath={folder.path}
                              />
                            ) : (
                              <div className="py-2 text-center text-xs text-muted-foreground">Empty folder</div>
                            )
                          ) : (
                            <div className="py-2 flex items-center justify-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Loading...</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Add folder button at bottom of multi-folder tree */}
                  {onAddFolder && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground mt-2"
                      onClick={onAddFolder}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Folder to Workspace
                    </Button>
                  )}
                </div>
              ) : fileTree.length > 0 ? (
                /* Single folder view (backward compat) */
                <>
                  {creatingFileInDir === "" && (
                    <div className="flex items-center gap-1.5 py-1 px-1 pl-5">
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        value={newFileValue}
                        onChange={(e) => setNewFileValue(e.target.value)}
                        onBlur={() => handleFinishCreateFile("", newFileValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishCreateFile("", newFileValue);
                          if (e.key === "Escape") setCreatingFileInDir(null);
                        }}
                        autoFocus
                        placeholder="filename"
                        className="text-xs bg-muted border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary w-full"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  <FileTreeView
                    nodes={fileTree}
                    expandedDirs={expandedDirs}
                    onToggleDir={toggleDir}
                    projectPath={projectPath}
                  />
                  {/* Add folder button - only shown in single folder mode */}
                  {onAddFolder && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground mt-2"
                      onClick={onAddFolder}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Folder to Workspace
                    </Button>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  {creatingFileInDir === "" && (
                    <div className="flex items-center gap-1.5 py-1 px-1 pl-5 w-full">
                      <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        value={newFileValue}
                        onChange={(e) => setNewFileValue(e.target.value)}
                        onBlur={() => handleFinishCreateFile("", newFileValue)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishCreateFile("", newFileValue);
                          if (e.key === "Escape") setCreatingFileInDir(null);
                        }}
                        autoFocus
                        placeholder="filename"
                        className="text-xs bg-muted border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary w-full"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  )}
                  <FolderTree className="mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No files found</p>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Commit section - fixed at bottom (only show when git repo) */}
      {isGitRepo ? (
        <div className="border-t border-border p-4 space-y-3">
          {/* Subject line */}
          <div className="relative">
            <Input
              placeholder="Summary (required)"
              value={commitSubject}
              onChange={(e) => setCommitSubject(e.target.value)}
              aria-label="Commit summary"
              className={cn("bg-muted/50 text-sm", isGenerating && "pr-8")}
              disabled={isGenerating}
            />
            {isGenerating && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-primary" />
            )}
          </div>

          {/* Description */}
          <Textarea
            placeholder="Description (optional)"
            value={commitDescription}
            onChange={(e) => setCommitDescription(e.target.value)}
            aria-label="Commit description"
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

          {/* Commit or Undo Commit button */}
          {status && status.ahead > 0 && filesToCommit.size === 0 && history.length > 1 ? (
            <Button
              className="w-full bg-muted hover:bg-muted/80 text-foreground font-medium"
              onClick={handleUndoCommit}
              disabled={isUndoing}
            >
              <Undo2 className="mr-1.5 h-4 w-4" />
              <span className="truncate">
                {isUndoing ? "Undoing..." : "Undo Commit"}
              </span>
            </Button>
          ) : (
            <Button
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              onClick={handleCommit}
              disabled={isCommitting || !commitSubject.trim() || filesToCommit.size === 0}
            >
              <span className="truncate">
                {isCommitting
                  ? "Committing..."
                  : filesToCommit.size === diffs.length
                    ? `Commit to ${currentBranch?.name || "main"}`
                    : `Commit ${filesToCommit.size} file${filesToCommit.size !== 1 ? 's' : ''} to ${currentBranch?.name || "main"}`
                }
              </span>
            </Button>
          )}
        </div>
      ) : (
        <div className="border-t border-border p-4">
          <Button
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium gap-2"
            onClick={handleInitRepo}
            disabled={isInitializing}
          >
            {isInitializing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitBranch className="h-4 w-4" />
            )}
            {isInitializing ? "Initializing..." : "Initialize Git Repository"}
          </Button>
        </div>
      )}

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
            aria-label="New branch name"
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
              <ul className="mt-2 max-h-32 overflow-auto overflow-x-hidden rounded bg-muted p-2 font-mono text-xs">
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
              This will discard all changes to <span className="font-mono break-all">{fileToDiscard}</span>. This cannot be undone.
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
              This will discard the selected change in <span className="font-mono break-all">{hunkToDiscard?.filePath}</span>. This cannot be undone.
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

      {/* Reset to commit dialog */}
      <AlertDialog open={!!commitToReset} onOpenChange={(open) => !open && setCommitToReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to this commit?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how you want to reset to commit <span className="font-mono text-primary">{commitToReset?.slice(0, 7)}</span>:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => commitToReset && handleResetToCommit(commitToReset, "soft")}
              disabled={isResetting}
            >
              <div className="text-left">
                <div className="font-medium">Soft Reset</div>
                <div className="text-xs text-muted-foreground">Keep changes in staging area</div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start border-destructive/50 hover:bg-destructive/10"
              onClick={() => commitToReset && handleResetToCommit(commitToReset, "hard")}
              disabled={isResetting}
            >
              <div className="text-left">
                <div className="font-medium text-destructive">Hard Reset</div>
                <div className="text-xs text-muted-foreground">Discard all changes (cannot be undone)</div>
              </div>
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish branch?</AlertDialogTitle>
            <AlertDialogDescription>
              The branch <span className="font-mono text-primary">{status?.branch}</span> has no upstream. Do you want to publish it to origin?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublishBranch}>
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
