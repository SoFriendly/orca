import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, ImageIcon, FileIcon, Undo2, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  const [deletedLines, setDeletedLines] = useState<Set<string>>(new Set());
  // Line-level staging state
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [lastClickedLine, setLastClickedLine] = useState<number | null>(null);
  const [isStagingLines, setIsStagingLines] = useState(false);
  // Image diff state
  const [oldImageBase64, setOldImageBase64] = useState<string | null>(null);
  const [imageDiffMode, setImageDiffMode] = useState<"side-by-side" | "slider">("side-by-side");

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

  // Load old image for comparison
  useEffect(() => {
    if (isImage && diff.status === "modified" && source === "changes") {
      invoke<string>("get_old_file_content", { repoPath: projectPath, filePath: diff.path })
        .then((base64) => setOldImageBase64(base64))
        .catch(() => setOldImageBase64(null));
    }
  }, [isImage, diff.path, diff.status, source, projectPath]);

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

  const handleEditLine = async (filePath: string, lineNo: number, newContent: string, deleteLine = false) => {
    try {
      const fullPath = `${projectPath}/${filePath}`;
      await invoke("edit_file_line", {
        filePath: fullPath,
        lineNumber: lineNo,
        newContent,
        delete: deleteLine,
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

  const handleToggleLine = (lineNo: number, shiftKey: boolean) => {
    setSelectedLines(prev => {
      const next = new Set(prev);
      if (shiftKey && lastClickedLine !== null) {
        // Range selection
        const start = Math.min(lastClickedLine, lineNo);
        const end = Math.max(lastClickedLine, lineNo);
        for (let i = start; i <= end; i++) {
          next.add(i);
        }
      } else {
        if (next.has(lineNo)) {
          next.delete(lineNo);
        } else {
          next.add(lineNo);
        }
      }
      return next;
    });
    setLastClickedLine(lineNo);
  };

  const handleStageSelectedLines = async () => {
    if (selectedLines.size === 0) return;
    setIsStagingLines(true);
    try {
      // Convert selected lines to ranges
      const sortedLines = Array.from(selectedLines).sort((a, b) => a - b);
      const ranges: [number, number][] = [];
      let start = sortedLines[0];
      let end = sortedLines[0];
      for (let i = 1; i < sortedLines.length; i++) {
        if (sortedLines[i] === end + 1) {
          end = sortedLines[i];
        } else {
          ranges.push([start, end]);
          start = sortedLines[i];
          end = sortedLines[i];
        }
      }
      ranges.push([start, end]);

      await invoke("stage_lines", {
        repoPath: projectPath,
        filePath: diff.path,
        lineRanges: ranges,
      });
      toast.success(`Staged ${selectedLines.size} line${selectedLines.size !== 1 ? 's' : ''}`);
      setSelectedLines(new Set());
      onRefresh();
    } catch (error) {
      toast.error(`Failed to stage lines: ${error}`);
    } finally {
      setIsStagingLines(false);
    }
  };

  // Get the extension for mime type detection for old image
  const getImageMime = (path: string): string => {
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.gif')) return 'image/gif';
    if (path.endsWith('.svg')) return 'image/svg+xml';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.ico')) return 'image/x-icon';
    if (path.endsWith('.bmp')) return 'image/bmp';
    return 'image/jpeg';
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center gap-2 px-3 pt-1 shrink-0">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", getStatusColor(diff.status))} />
        <span className="flex-1 truncate font-mono text-xs text-muted-foreground/60">
          {diff.path}
        </span>
        {/* Stage selected lines button */}
        {selectedLines.size > 0 && source === 'changes' && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={handleStageSelectedLines}
            disabled={isStagingLines}
          >
            {isStagingLines ? "Staging..." : `Stage ${selectedLines.size} line${selectedLines.size !== 1 ? 's' : ''}`}
          </Button>
        )}
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
              {/* Image diff comparison */}
              {diff.status === "modified" && oldImageBase64 ? (
                <div className="w-full space-y-2">
                  <div className="flex gap-1 justify-center mb-2">
                    <Button
                      variant={imageDiffMode === "side-by-side" ? "default" : "ghost"}
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setImageDiffMode("side-by-side")}
                    >
                      Side by Side
                    </Button>
                    <Button
                      variant={imageDiffMode === "slider" ? "default" : "ghost"}
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => setImageDiffMode("slider")}
                    >
                      Overlay
                    </Button>
                  </div>
                  {imageDiffMode === "side-by-side" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground mb-1">Before (HEAD)</div>
                        <img
                          src={`data:${getImageMime(diff.path)};base64,${oldImageBase64}`}
                          alt="Old version"
                          className="max-w-full max-h-48 rounded border border-red-500/30 object-contain mx-auto"
                        />
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground mb-1">After (Working)</div>
                        <img
                          src={`asset://localhost/${projectPath}/${diff.path}`}
                          alt="New version"
                          className="max-w-full max-h-48 rounded border border-green-500/30 object-contain mx-auto"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="relative w-full flex justify-center">
                      <img
                        src={`data:${getImageMime(diff.path)};base64,${oldImageBase64}`}
                        alt="Old version"
                        className="max-w-full max-h-48 rounded border border-border object-contain opacity-50"
                      />
                      <img
                        src={`asset://localhost/${projectPath}/${diff.path}`}
                        alt="New version"
                        className="absolute top-0 left-1/2 -translate-x-1/2 max-w-full max-h-48 rounded object-contain opacity-50"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <>
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
                </>
              )}
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
                      const lineKey = `${hi}-${li}`;
                      if (deletedLines.has(lineKey)) return null;
                      const canSelectForStaging = source === 'changes' && (line.type === "addition" || line.type === "deletion") && line.newLineNo;
                      const isSelected = line.newLineNo ? selectedLines.has(line.newLineNo) : false;

                      return (
                        <div
                          key={li}
                          className={cn(
                            "whitespace-pre-wrap break-all select-text outline-none px-3 py-1 flex items-start gap-1",
                            line.type === "addition" && "bg-green-500/5 text-green-400",
                            line.type === "deletion" && "bg-red-500/5 text-red-400",
                            line.type === "context" && "text-muted-foreground",
                            isEditable && "cursor-text",
                            isSelected && "ring-1 ring-primary/50 bg-primary/5"
                          )}
                        >
                          {/* Line selection checkbox for staging */}
                          {canSelectForStaging && line.newLineNo ? (
                            <button
                              className="flex-shrink-0 mt-0.5 opacity-40 hover:opacity-100"
                              onClick={(e) => handleToggleLine(line.newLineNo!, e.shiftKey)}
                            >
                              {isSelected ? (
                                <CheckSquare className="h-3 w-3 text-primary" />
                              ) : (
                                <Square className="h-3 w-3" />
                              )}
                            </button>
                          ) : (
                            <span className="w-3 flex-shrink-0" />
                          )}
                          {/* Line number gutter */}
                          <span className="w-8 flex-shrink-0 text-right text-muted-foreground/30 select-none text-[10px]">
                            {line.newLineNo || line.oldLineNo || ""}
                          </span>
                          <span
                            className="flex-1"
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
                              } else if (
                                (e.key === "Backspace" || e.key === "Delete") &&
                                isEditable && line.newLineNo &&
                                !e.currentTarget.textContent
                              ) {
                                e.preventDefault();
                                setDeletedLines(prev => new Set(prev).add(lineKey));
                                handleEditLine(diff.path, line.newLineNo, "", true);
                              }
                            }}
                          >
                            {line.content}
                          </span>
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
