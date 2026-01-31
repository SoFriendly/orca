import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Terminal as TerminalIcon, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settingsStore";
import type { CodingAssistant } from "@/types";

interface AssistantLauncherProps {
  projectPath: string;
  onTerminalCreate: (id: string) => void;
}

const KNOWN_ASSISTANTS: CodingAssistant[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    installed: false,
    icon: "Bot",
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    installed: false,
    icon: "Bot",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    installed: false,
    icon: "Bot",
  },
  {
    id: "shell",
    name: "Shell",
    command: "",
    installed: true,
    icon: "Terminal",
  },
];

export default function AssistantLauncher({
  projectPath,
  onTerminalCreate,
}: AssistantLauncherProps) {
  const [assistants, setAssistants] = useState<CodingAssistant[]>(KNOWN_ASSISTANTS);
  const [selectedAssistant, setSelectedAssistant] = useState<string>("shell");
  const [isLaunching, setIsLaunching] = useState(false);
  const { assistantArgs } = useSettingsStore();

  useEffect(() => {
    checkInstalledAssistants();
  }, []);

  const checkInstalledAssistants = async () => {
    try {
      const installed = await invoke<string[]>("check_installed_assistants");
      setAssistants((prev) =>
        prev.map((a) => ({
          ...a,
          installed: a.id === "shell" || installed.includes(a.command),
        }))
      );
    } catch (error) {
      console.error("Failed to check installed assistants:", error);
    }
  };

  const handleLaunch = async () => {
    const assistant = assistants.find((a) => a.id === selectedAssistant);
    if (!assistant) return;

    setIsLaunching(true);
    try {
      let command = assistant.command;
      const args = assistantArgs[assistant.id] || "";

      if (args) {
        command = `${command} ${args}`;
      }

      const terminalId = await invoke<string>("spawn_terminal", {
        shell: command,
        cwd: projectPath,
      });

      onTerminalCreate(terminalId);

      if (assistant.id !== "shell") {
        toast.success(`${assistant.name} launched`);
      }
    } catch (error) {
      toast.error(`Failed to launch ${assistant.name}`);
      console.error(error);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleInstall = async (assistantId: string) => {
    const assistant = assistants.find((a) => a.id === assistantId);
    if (!assistant) return;

    try {
      toast.info(`Installing ${assistant.name}...`);
      await invoke("install_assistant", { command: assistant.command });
      await checkInstalledAssistants();
      toast.success(`${assistant.name} installed`);
    } catch (error) {
      toast.error(`Failed to install ${assistant.name}`);
      console.error(error);
    }
  };

  const selectedAssistantData = assistants.find((a) => a.id === selectedAssistant);

  return (
    <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-2">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-xs font-medium text-muted-foreground">Assistant</span>
      </div>

      <Select value={selectedAssistant} onValueChange={setSelectedAssistant}>
        <SelectTrigger className="h-8 w-[160px] bg-muted/50 text-sm">
          <SelectValue placeholder="Select assistant" />
        </SelectTrigger>
        <SelectContent>
          {assistants.map((assistant) => (
            <SelectItem
              key={assistant.id}
              value={assistant.id}
              disabled={!assistant.installed && assistant.id !== "shell"}
            >
              <div className="flex items-center gap-2">
                {assistant.id === "shell" ? (
                  <TerminalIcon className="h-3 w-3" />
                ) : (
                  <Bot className="h-3 w-3" />
                )}
                <span>{assistant.name}</span>
                {!assistant.installed && assistant.id !== "shell" && (
                  <span className="text-[10px] text-muted-foreground">(not installed)</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        onClick={handleLaunch}
        disabled={isLaunching || !selectedAssistantData?.installed}
        className="h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        <Play className="mr-1.5 h-3 w-3" />
        {isLaunching ? "Starting..." : "Launch"}
      </Button>

      {selectedAssistantData && !selectedAssistantData.installed && selectedAssistant !== "shell" && (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => handleInstall(selectedAssistant)}
        >
          Install
        </Button>
      )}
    </div>
  );
}
