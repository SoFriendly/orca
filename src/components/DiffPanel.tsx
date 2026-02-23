import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ImageIcon, FileIcon, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { DiffPanelSelection } from "@/types";

interface DiffPanelProps {
  selection: DiffPanelSelection;
  onClose: () => void;
  onRefresh: () => void;
}

const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'];

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

export default function DiffPanel({ selection, onClose, onRefresh }: DiffPanelProps) {
  const { diff, source, commitMessage, projectPath } = selection;
  const isImage = imageExtensions.some(ext => diff.path.toLowerCase().endsWith(ext));
  const hasDiff = diff.hunks.length > 0;

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const handleDiscardHunk = async (filePath: string, hunk: typeof diff.hunks[0]) => {
    try {
      await invoke("discard_hunk", {
        repoPath: projectPath,
        filePath,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
      });
      toast.success("Change discarded");
      onRefresh();
    } catch (error) {
      toast.error(`Failed to discard change: ${error}`);
    }
  };

  const handleEditLine = async (filePath: string, lineNo: number, newContent: string) => {
    try {
      const fullPath = `${projectPath}/${filePath}`;
      await invoke("edit_file_line", {
        filePath: fullPath,
        lineNumber: lineNo,
        newContent,
      });
      onRefresh();
    } catch (error) {
      toast.error(`Failed to edit line: ${error}`);
    }
  };

  const handleDiscardFile = async (filePath: string) => {
    try {
      await invoke("discard_file", { repoPath: projectPath, filePath });
      toast.success("File changes discarded");
      onRefresh();
    } catch (error) {
      toast.error(`Failed to discard: ${error}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-2 px-3 pt-1 shrink-0">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", getStatusColor(diff.status))} />
        <span className="flex-1 truncate font-mono text-xs text-muted-foreground/60">
          {diff.path}
        </span>
        <button
          onClick={handleClose}
          className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-muted"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Commit context for history diffs */}
      {commitMessage && (
        <div className="px-3 pb-1">
          <span className="text-[10px] text-muted-foreground/50 italic truncate block">
            {commitMessage}
          </span>
        </div>
      )}

      {/* Body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 select-text">
          {isImage ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <img
                src={`asset://localhost/${projectPath}/${diff.path}`}
                alt={diff.path}
                className="max-w-full max-h-64 rounded border border-border object-contain"
                onError={(e) => {
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
            <div className="font-mono text-[11px] leading-relaxed">
              {diff.hunks.map((hunk, hi) => {
                const hunkContent = (
                  <div key={hi} className="mb-3 rounded">
                    {hunk.lines.map((line, li) => {
                      const isEditable = source === 'changes' && line.type !== "deletion" && line.newLineNo;

                      return (
                        <div
                          key={li}
                          className={cn(
                            "whitespace-pre-wrap break-all select-text outline-none px-3 py-1",
                            line.type === "addition" && "bg-green-500/5 text-green-400",
                            line.type === "deletion" && "bg-red-500/5 text-red-400",
                            line.type === "context" && "text-muted-foreground",
                            isEditable && "cursor-text"
                          )}
                          contentEditable={!!isEditable}
                          suppressContentEditableWarning
                          onBlur={(e) => {
                            if (isEditable && line.newLineNo) {
                              const newContent = e.currentTarget.textContent || "";
                              if (newContent !== line.content) {
                                handleEditLine(diff.path, line.newLineNo, newContent);
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.currentTarget.blur();
                            } else if (e.key === "Escape") {
                              e.stopPropagation();
                              e.currentTarget.textContent = line.content;
                              e.currentTarget.blur();
                            }
                          }}
                        >
                          {line.content}
                        </div>
                      );
                    })}
                  </div>
                );

                if (source === 'changes') {
                  return (
                    <ContextMenu key={hi}>
                      <ContextMenuTrigger>
                        {hunkContent}
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDiscardHunk(diff.path, hunk)}
                        >
                          <Undo2 className="mr-2 h-4 w-4" />
                          Discard this change
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDiscardFile(diff.path)}
                        >
                          <Undo2 className="mr-2 h-4 w-4" />
                          Discard all changes to file
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                }

                return hunkContent;
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <FileIcon className="h-4 w-4" />
              <span className="text-xs">Binary file changed</span>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
