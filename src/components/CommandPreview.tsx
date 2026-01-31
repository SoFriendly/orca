import { useState } from "react";
import { Check, Copy, Pencil, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CommandPreviewProps {
  command: string;
  onExecute: (command: string) => void;
  onCancel: () => void;
  className?: string;
}

export default function CommandPreview({
  command,
  onExecute,
  onCancel,
  className,
}: CommandPreviewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedCommand, setEditedCommand] = useState(command);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(editedCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExecute = () => {
    onExecute(editedCommand);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    } else if (e.key === "Escape") {
      if (isEditing) {
        setIsEditing(false);
        setEditedCommand(command);
      } else {
        onCancel();
      }
    }
  };

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/50 p-3",
        className
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Command display/edit */}
      <div className="mb-2">
        {isEditing ? (
          <Input
            value={editedCommand}
            onChange={(e) => setEditedCommand(e.target.value)}
            className="font-mono text-sm bg-background"
            autoFocus
            onBlur={() => setIsEditing(false)}
          />
        ) : (
          <code className="block rounded bg-background px-2 py-1.5 font-mono text-sm text-foreground">
            {editedCommand}
          </code>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleExecute}
          className="gap-1.5"
        >
          <Play className="h-3.5 w-3.5" />
          Execute
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsEditing(true)}
          className="gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleCopy}
          className="gap-1.5"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="gap-1.5 ml-auto"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>

      {/* Keyboard hint */}
      <p className="mt-2 text-xs text-muted-foreground">
        Press <kbd className="rounded bg-muted px-1">Enter</kbd> to execute,{" "}
        <kbd className="rounded bg-muted px-1">Esc</kbd> to cancel
      </p>
    </div>
  );
}
