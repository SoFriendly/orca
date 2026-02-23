import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StickyNote, Plus, ArrowLeft, Pencil, Save, Trash2, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Note } from "@/types";

interface NotesPanelProps {
  projectPath: string;
  onNoteDropAtPosition?: (text: string, x: number, y: number) => void;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function getTitleFromContent(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function getBodyFromContent(content: string): string {
  return content.replace(/^#\s+.+\n*/m, "").trim();
}

function parseNotesFile(raw: string): Note[] {
  if (!raw.trim()) return [];

  const notes: Note[] = [];
  // Split on --- boundaries that start a frontmatter block
  // Each note starts with --- followed by frontmatter fields, then --- and content
  const blocks = raw.split(/\n---\n/);

  let i = 0;
  // If the file starts with ---, the first element will be empty
  if (blocks[0].trim() === "" || blocks[0].trim() === "---") {
    i = 1;
  } else if (blocks[0].trimStart().startsWith("---")) {
    // The file starts with --- on first line
    blocks[0] = blocks[0].trimStart().replace(/^---\s*/, "");
    i = 0;
  }

  while (i < blocks.length) {
    const block = blocks[i];
    // Check if this block looks like frontmatter (has id: and title:)
    const idMatch = block.match(/^id:\s*"?([^"\n]+)"?\s*$/m);
    const titleMatch = block.match(/^title:\s*"?([^"\n]+)"?\s*$/m);
    const createdMatch = block.match(/^created:\s*"?([^"\n]+)"?\s*$/m);
    const positionMatch = block.match(/^position:\s*(\d+)\s*$/m);

    if (idMatch && titleMatch) {
      // This is a frontmatter block - next block is the content
      const id = idMatch[1];
      const title = titleMatch[1];
      const created = createdMatch ? createdMatch[1] : new Date().toISOString();
      const position = positionMatch ? parseInt(positionMatch[1], 10) : i;
      const content = i + 1 < blocks.length ? blocks[i + 1].trim() : "";

      // Check if the content block itself contains frontmatter (meaning it's the next note)
      const contentHasId = content.match(/^id:\s*"?([^"\n]+)"?\s*$/m);
      const contentHasTitle = content.match(/^title:\s*"?([^"\n]+)"?\s*$/m);

      if (contentHasId && contentHasTitle) {
        // Content block is actually the next note's frontmatter
        notes.push({ id, title, created, position, content: "" });
        // Don't skip - process this block as frontmatter next
      } else {
        notes.push({ id, title, created, position, content });
        i++; // skip content block
      }
    }
    i++;
  }

  return notes.sort((a, b) => a.position - b.position);
}

function serializeNotes(notes: Note[]): string {
  return notes
    .map((note) => {
      return `---\nid: "${note.id}"\ntitle: "${note.title}"\ncreated: "${note.created}"\nposition: ${note.position}\n---\n\n${note.content}`;
    })
    .join("\n\n");
}

export default function NotesPanel({ projectPath, onNoteDropAtPosition }: NotesPanelProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const noteRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Track if mouse moved enough to count as a drag vs a click
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  const notesPath = `${projectPath}/notes.md`;

  const loadNotes = useCallback(async () => {
    try {
      const raw = await invoke<string>("read_text_file", { path: notesPath });
      setNotes(parseNotesFile(raw));
    } catch {
      // File doesn't exist yet - that's fine
      setNotes([]);
    }
  }, [notesPath]);

  const saveNotes = useCallback(
    async (updatedNotes: Note[]) => {
      const content = serializeNotes(updatedNotes);
      await invoke("write_text_file", { path: notesPath, content });
    },
    [notesPath]
  );

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleCreateNote = async () => {
    const newNote: Note = {
      id: generateId(),
      title: "Untitled",
      created: new Date().toISOString(),
      position: 0,
      content: "# Untitled\n\n",
    };
    const updated = [newNote, ...notes.map((n) => ({ ...n, position: n.position + 1 }))];
    setNotes(updated);
    await saveNotes(updated);
    setSelectedNoteId(newNote.id);
    setEditContent(newNote.content);
    setEditing(true);
  };

  const handleDeleteNote = async (id: string) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    await saveNotes(updated);
    if (selectedNoteId === id) {
      setSelectedNoteId(null);
      setEditing(false);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedNoteId) return;
    const derivedTitle = getTitleFromContent(editContent) || "Untitled";
    const updated = notes.map((n) =>
      n.id === selectedNoteId ? { ...n, title: derivedTitle, content: editContent } : n
    );
    setNotes(updated);
    await saveNotes(updated);
    setSelectedNoteId(null);
    setEditing(false);
  };

  const handleSelectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setEditContent(note.content);
    setEditing(false);
  };

  const handleEditNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setEditContent(note.content);
    setEditing(true);
  };

  const handleCopyNote = (note: Note) => {
    const body = getBodyFromContent(note.content);
    navigator.clipboard.writeText(body || note.content);
  };

  const handleBack = () => {
    setSelectedNoteId(null);
    setEditing(false);
  };

  const handleNoteMouseDown = (event: React.MouseEvent, noteId: string) => {
    // Only handle left mouse button
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    dragStartPos.current = { x: startX, y: startY };
    didDrag.current = false;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Only start drag after moving 5px threshold
      if (!didDrag.current && Math.abs(dx) + Math.abs(dy) < 5) return;

      if (!didDrag.current) {
        didDrag.current = true;
        setDraggingNoteId(noteId);
      }
      setDragPosition({ x: e.clientX, y: e.clientY });

      let foundId: string | null = null;
      noteRefs.current.forEach((el, id) => {
        if (id !== noteId) {
          const rect = el.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom) {
            foundId = id;
          }
        }
      });
      setDragOverId(foundId);
    };

    const handleMouseUp = (e: MouseEvent) => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      if (!didDrag.current) {
        // No drag happened — treat as click
        const note = notes.find((n) => n.id === noteId);
        if (note) handleSelectNote(note);
        dragStartPos.current = null;
        return;
      }

      // Check if dropped on another note (reorder)
      let targetId: string | null = null;
      noteRefs.current.forEach((el, id) => {
        if (id !== noteId) {
          const rect = el.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right &&
              e.clientY >= rect.top && e.clientY <= rect.bottom) {
            targetId = id;
          }
        }
      });

      if (targetId) {
        // Reorder within notes grid
        const sourceIdx = notes.findIndex((n) => n.id === noteId);
        const targetIdx = notes.findIndex((n) => n.id === targetId);
        if (sourceIdx !== -1 && targetIdx !== -1) {
          const reordered = [...notes];
          const [moved] = reordered.splice(sourceIdx, 1);
          reordered.splice(targetIdx, 0, moved);
          const updated = reordered.map((n, i) => ({ ...n, position: i }));
          setNotes(updated);
          saveNotes(updated);
        }
      } else if (onNoteDropAtPosition) {
        // Dropped outside notes grid — try terminal panels
        const note = notes.find((n) => n.id === noteId);
        if (note) {
          const body = getBodyFromContent(note.content);
          if (body) {
            onNoteDropAtPosition(body, e.clientX, e.clientY);
          }
        }
      }

      setDraggingNoteId(null);
      setDragOverId(null);
      setDragPosition(null);
      dragStartPos.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const selectedNote = notes.find((n) => n.id === selectedNoteId);
  const deleteNote = deleteNoteId ? notes.find((n) => n.id === deleteNoteId) : null;

  // Detail view
  if (selectedNote) {
    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-10 items-center justify-between px-3 text-muted-foreground/60">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-inherit hover:text-foreground" onClick={handleBack} aria-label="Back to notes list">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to list</TooltipContent>
            </Tooltip>
            <span className="text-xs font-medium truncate">
              {getTitleFromContent(editing ? editContent : selectedNote.content) || "Untitled"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {editing ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-inherit hover:text-foreground" onClick={handleSaveNote} aria-label="Save note">
                    <Save className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Save</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-inherit hover:text-foreground"
                    onClick={() => setEditing(true)}
                    aria-label="Edit note"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            )}
            <AlertDialog>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive" aria-label="Delete note">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete note?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{getTitleFromContent(selectedNote.content) || "Untitled"}". This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDeleteNote(selectedNote.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {editing ? (
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              aria-label="Note content"
              className="h-full w-full resize-none rounded-none border-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder="Write your note..."
            />
          ) : (
            <ScrollArea className="h-full">
              {selectedNote.content ? (
                <article className="prose prose-sm max-w-none p-3 overflow-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedNote.content}
                  </ReactMarkdown>
                </article>
              ) : (
                <div className="p-3 text-sm">
                  <span className="text-muted-foreground italic">Empty note</span>
                </div>
              )}
            </ScrollArea>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-10 items-center justify-between px-3 text-muted-foreground/60">
        <span className="text-xs font-medium text-inherit">Notes</span>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-inherit hover:text-foreground" onClick={handleCreateNote} aria-label="Create new note">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New note</TooltipContent>
        </Tooltip>
      </div>

      {/* Note list */}
      <ScrollArea className="flex-1">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 mb-4">
              <StickyNote className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground mb-1">No notes yet</p>
            <p className="text-xs text-muted-foreground/70 mb-4">
              Click + to create your first note
            </p>
          </div>
        ) : (
          <div className="grid gap-3 p-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {notes.map((note) => (
              <ContextMenu key={note.id}>
                <ContextMenuTrigger asChild>
                  <div
                    ref={(el) => {
                      if (el) noteRefs.current.set(note.id, el);
                      else noteRefs.current.delete(note.id);
                    }}
                    onMouseDown={(e) => handleNoteMouseDown(e, note.id)}
                    className={`relative text-left rounded-lg bg-card border p-4 hover:bg-accent transition-colors shadow-sm hover:shadow-md overflow-hidden cursor-grab note-fold ${draggingNoteId === note.id ? "opacity-60 cursor-grabbing" : ""} ${dragOverId === note.id && draggingNoteId !== note.id ? "border-primary" : "border-border"}`}
                  >
                    {getTitleFromContent(note.content) ? (
                      <>
                        <p className="text-xs font-semibold truncate mb-1">{getTitleFromContent(note.content)}</p>
                        {getBodyFromContent(note.content) && (
                          <div className="text-[11px] text-muted-foreground line-clamp-4 prose prose-sm max-w-none [&>*]:m-0 [&>*]:text-[11px] [&>*]:text-muted-foreground [&>*]:leading-snug">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {getBodyFromContent(note.content)}
                            </ReactMarkdown>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs line-clamp-5 prose prose-sm max-w-none [&>*]:m-0 [&>*]:text-xs [&>*]:leading-snug">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {note.content || "*Empty note*"}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => handleCopyNote(note)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleEditNote(note)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteNoteId(note.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Floating drag indicator */}
      {draggingNoteId && dragPosition && (
        <div
          className="fixed pointer-events-none z-50 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium shadow-lg"
          style={{
            left: dragPosition.x + 10,
            top: dragPosition.y + 10,
          }}
        >
          {getTitleFromContent(notes.find((n) => n.id === draggingNoteId)?.content || "") || "Note"}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteNoteId} onOpenChange={(open) => !open && setDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteNote ? (getTitleFromContent(deleteNote.content) || "Untitled") : ""}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (deleteNoteId) handleDeleteNote(deleteNoteId);
              setDeleteNoteId(null);
            }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
