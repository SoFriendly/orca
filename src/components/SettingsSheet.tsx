import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Settings,
  Palette,
  Sparkles,
  Keyboard,
  Info,
  FolderOpen,
  Check,
  Download,
  Bot,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import { CustomThemeEditor } from "@/components/CustomThemeEditor";
import type { ThemeOption } from "@/types";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab = "general" | "assistants" | "appearance" | "ai" | "keyboard" | "about";

const NAV_ITEMS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings className="h-4 w-4" /> },
  { id: "assistants", label: "Assistants", icon: <Bot className="h-4 w-4" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
  { id: "ai", label: "AI Behavior", icon: <Sparkles className="h-4 w-4" /> },
  { id: "keyboard", label: "Keyboard", icon: <Keyboard className="h-4 w-4" /> },
  { id: "about", label: "About", icon: <Info className="h-4 w-4" /> },
];

interface ThemeInfo {
  id: ThemeOption;
  name: string;
  gradient: string;
}

const THEMES: ThemeInfo[] = [
  { id: "dark", name: "Chell Dark", gradient: "from-portal-orange/60 to-neutral-900" },
  { id: "tokyo", name: "Tokyo Night", gradient: "from-indigo-500/60 to-slate-900" },
  { id: "light", name: "Light", gradient: "from-slate-200 to-slate-100" },
  { id: "custom", name: "Custom", gradient: "from-purple-500/60 via-pink-500/60 to-orange-500/60" },
];

interface AssistantInfo {
  id: string;
  name: string;
  description: string;
  installCommand: string;
  docsUrl: string;
}

const ASSISTANTS: AssistantInfo[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic's AI coding assistant with agentic capabilities",
    installCommand: "npm install -g @anthropic-ai/claude-code",
    docsUrl: "https://docs.anthropic.com/claude-code",
  },
  {
    id: "aider",
    name: "Aider",
    description: "AI pair programming in your terminal",
    installCommand: "pip install aider-chat",
    docsUrl: "https://aider.chat",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google's Gemini AI assistant for coding",
    installCommand: "npm install -g @google/gemini-cli",
    docsUrl: "https://ai.google.dev/gemini-api",
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    description: "OpenAI's code generation model",
    installCommand: "npm install -g @openai/codex",
    docsUrl: "https://platform.openai.com/docs",
  },
];

export default function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const {
    theme,
    setTheme,
    customTheme,
    initializeCustomTheme,
    assistantArgs,
    setAssistantArgs,
    defaultClonePath,
    setDefaultClonePath,
    defaultAssistant,
    setDefaultAssistant,
    autoCommitMessage,
    setAutoCommitMessage,
    autoFetchRemote,
    setAutoFetchRemote,
  } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [localDefaultClonePath, setLocalDefaultClonePath] = useState(defaultClonePath || "");
  const [installedAssistants, setInstalledAssistants] = useState<string[]>([]);
  const [assistantArgsState, setAssistantArgsState] = useState<Record<string, string>>({
    "claude-code": assistantArgs["claude-code"] || "",
    "aider": assistantArgs["aider"] || "",
    "gemini": assistantArgs["gemini"] || "",
    "codex": assistantArgs["codex"] || "",
  });
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  // Update local state when store changes
  useEffect(() => {
    setLocalDefaultClonePath(defaultClonePath || "");
  }, [defaultClonePath]);

  useEffect(() => {
    setAssistantArgsState({
      "claude-code": assistantArgs["claude-code"] || "",
      "aider": assistantArgs["aider"] || "",
      "gemini": assistantArgs["gemini"] || "",
      "codex": assistantArgs["codex"] || "",
    });
  }, [assistantArgs]);

  // Check installed assistants when dialog opens
  useEffect(() => {
    if (open) {
      checkInstalledAssistants();
    }
  }, [open]);

  const checkInstalledAssistants = async () => {
    try {
      const installed = await invoke<string[]>("check_installed_assistants");
      setInstalledAssistants(installed);
    } catch (error) {
      console.error("Failed to check installed assistants:", error);
    }
  };

  const handleSelectDefaultClonePath = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Default Clone Directory",
        defaultPath: localDefaultClonePath || undefined,
      });

      if (selected && typeof selected === "string") {
        setLocalDefaultClonePath(selected);
        setDefaultClonePath(selected);
        toast.success("Default clone path updated");
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  const handleSaveAssistantArgs = (assistantId: string, args: string) => {
    setAssistantArgs(assistantId, args);
    toast.success("Settings saved");
  };

  const handleThemeChange = (newTheme: ThemeOption) => {
    if (newTheme === 'custom') {
      // If no custom theme exists, initialize with dark as base
      if (!customTheme) {
        initializeCustomTheme('dark');
      } else {
        setTheme('custom');
      }
    } else {
      setTheme(newTheme);
    }
    toast.success(`Theme set to ${THEMES.find(t => t.id === newTheme)?.name}`);
  };

  const handleSetDefaultAssistant = (assistantId: string) => {
    if (!installedAssistants.includes(assistantId)) {
      toast.error(`${ASSISTANTS.find(a => a.id === assistantId)?.name} is not installed`);
      return;
    }
    setDefaultAssistant(assistantId);
    toast.success(`Default assistant set to ${ASSISTANTS.find(a => a.id === assistantId)?.name}`);
  };

  const copyInstallCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    toast.success("Install command copied to clipboard");
  };

  const checkForUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      const update = await check();
      if (update) {
        setUpdateStatus(`Version ${update.version} available`);
        toast.success(`Update available: v${update.version}`, {
          action: {
            label: "Install",
            onClick: async () => {
              try {
                await update.downloadAndInstall();
                toast.success("Update installed! Restarting...");
                await relaunch();
              } catch (e) {
                toast.error("Failed to install update");
              }
            },
          },
        });
      } else {
        setUpdateStatus("You're on the latest version");
        toast.success("You're on the latest version");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setUpdateStatus("Failed to check for updates");
      toast.error("Failed to check for updates");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <div className="flex h-[550px]">
          {/* Left sidebar navigation */}
          <div className="w-48 border-r border-border bg-card p-2">
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    activeTab === item.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  )}
                >
                  <span className={activeTab === item.id ? "text-primary" : ""}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Main content */}
          <ScrollArea className="flex-1">
            <div className="p-6">
              {/* General Tab */}
              {activeTab === "general" && (
                <div className="space-y-8">
                  {/* Git Configuration Section */}
                  <section>
                    <h2 className="text-lg font-semibold">Git Configuration</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Manage your global git identity and repository behaviors.
                    </p>

                    <div className="space-y-6">
                      {/* Default Clone Path */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Default Clone Path</p>
                          <p className="text-xs text-muted-foreground">
                            All cloned repositories will be placed in this directory.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={localDefaultClonePath}
                            onChange={(e) => {
                              setLocalDefaultClonePath(e.target.value);
                              setDefaultClonePath(e.target.value || undefined);
                            }}
                            placeholder="~/Projects"
                            className="w-56 h-9 bg-muted/50"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            onClick={handleSelectDefaultClonePath}
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Auto Fetch Remote */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Auto-Fetch Remote</p>
                          <p className="text-xs text-muted-foreground">
                            Periodically check for upstream changes in the background.
                          </p>
                        </div>
                        <Switch
                          checked={autoFetchRemote}
                          onCheckedChange={setAutoFetchRemote}
                        />
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* Assistants Tab */}
              {activeTab === "assistants" && (
                <div className="space-y-8">
                  <section>
                    <h2 className="text-lg font-semibold">AI Coding Assistants</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Configure which AI assistants are available and set your default.
                    </p>

                    <div className="space-y-4">
                      {ASSISTANTS.map((assistant) => {
                        const isInstalled = installedAssistants.includes(assistant.id);
                        const isDefault = defaultAssistant === assistant.id;
                        const argsKey = assistant.id === "claude" ? "claude-code" : assistant.id;

                        return (
                          <div
                            key={assistant.id}
                            className={cn(
                              "rounded-lg border p-4 transition-colors",
                              isDefault ? "border-primary bg-primary/5" : "border-border"
                            )}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-3">
                                <div className={cn(
                                  "flex h-10 w-10 items-center justify-center rounded-lg",
                                  isInstalled ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
                                )}>
                                  <Bot className="h-5 w-5" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium">{assistant.name}</p>
                                    {isInstalled && (
                                      <span className="flex items-center gap-1 text-xs text-green-500">
                                        <Check className="h-3 w-3" />
                                        Installed
                                      </span>
                                    )}
                                    {isDefault && (
                                      <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                        DEFAULT
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {assistant.description}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {isInstalled ? (
                                  <Button
                                    variant={isDefault ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => handleSetDefaultAssistant(assistant.id)}
                                    disabled={isDefault}
                                    className={isDefault ? "bg-primary hover:bg-primary" : ""}
                                  >
                                    {isDefault ? "Default" : "Set Default"}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyInstallCommand(assistant.installCommand)}
                                  >
                                    <Download className="h-3 w-3 mr-1" />
                                    Copy Install
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => window.open(assistant.docsUrl, "_blank")}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>

                            {isInstalled && (
                              <div className="mt-4 pt-4 border-t border-border">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-muted-foreground">Launch arguments</p>
                                  <Input
                                    value={assistantArgsState[argsKey] || ""}
                                    onChange={(e) => setAssistantArgsState(prev => ({
                                      ...prev,
                                      [argsKey]: e.target.value
                                    }))}
                                    onBlur={() => handleSaveAssistantArgs(argsKey, assistantArgsState[argsKey] || "")}
                                    placeholder="--flag value"
                                    className="w-64 h-8 text-xs bg-muted/50"
                                  />
                                </div>
                              </div>
                            )}

                            {!isInstalled && (
                              <div className="mt-4 pt-4 border-t border-border">
                                <p className="text-xs text-muted-foreground mb-2">Install command:</p>
                                <code className="block rounded bg-muted px-3 py-2 text-xs font-mono">
                                  {assistant.installCommand}
                                </code>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}

              {/* Appearance Tab */}
              {activeTab === "appearance" && (
                <div className="space-y-8">
                  <section>
                    <h2 className="text-lg font-semibold">Appearance</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Customize the look and feel of your terminal environment.
                    </p>

                    <div className="grid grid-cols-4 gap-3">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => handleThemeChange(t.id)}
                          className={cn(
                            "group relative rounded-lg border-2 p-1 transition-all",
                            theme === t.id
                              ? "border-primary"
                              : "border-transparent hover:border-muted"
                          )}
                        >
                          <div
                            className={cn(
                              "h-16 rounded-md bg-gradient-to-br",
                              t.gradient
                            )}
                          />
                          <p className="mt-2 text-center text-xs font-medium">
                            {t.name}
                          </p>
                          {theme === t.id && (
                            <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                              <Check className="h-3 w-3 text-primary-foreground" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>

                  {theme === "custom" && (
                    <section>
                      <h2 className="text-lg font-semibold">Customize Theme</h2>
                      <p className="text-sm text-muted-foreground mb-4">
                        Set your own colors using hex values.
                      </p>
                      <CustomThemeEditor />
                    </section>
                  )}
                </div>
              )}

              {/* AI Behavior Tab */}
              {activeTab === "ai" && (
                <div className="space-y-8">
                  <section>
                    <h2 className="text-lg font-semibold">AI Assistant Behavior</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Tune how the AI interacts with your workflow and code.
                    </p>

                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Commit Message Generation</p>
                          <p className="text-xs text-muted-foreground">
                            Automatically generate draft commit messages for staged changes.
                          </p>
                        </div>
                        <Switch
                          checked={autoCommitMessage}
                          onCheckedChange={setAutoCommitMessage}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Analysis Deep Scan</p>
                          <p className="text-xs text-muted-foreground">
                            Enables semantic code analysis for better context awareness (Higher token usage).
                          </p>
                        </div>
                        <Switch checked={false} disabled />
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* Keyboard Tab */}
              {activeTab === "keyboard" && (
                <div className="space-y-8">
                  <section>
                    <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Global hotkeys for rapid terminal operations.
                    </p>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm">New Terminal</p>
                        <kbd className="rounded bg-muted px-2 py-1 text-xs font-mono">
                          Cmd T
                        </kbd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm">Commit Changes</p>
                        <kbd className="rounded bg-muted px-2 py-1 text-xs font-mono">
                          Cmd Enter
                        </kbd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm">Refresh Git Status</p>
                        <kbd className="rounded bg-muted px-2 py-1 text-xs font-mono">
                          Cmd R
                        </kbd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm">Toggle Git Panel</p>
                        <kbd className="rounded bg-muted px-2 py-1 text-xs font-mono">
                          Cmd B
                        </kbd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm">Open Settings</p>
                        <kbd className="rounded bg-muted px-2 py-1 text-xs font-mono">
                          Cmd ,
                        </kbd>
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {/* About Tab */}
              {activeTab === "about" && (
                <div className="space-y-8">
                  <section>
                    <h2 className="text-lg font-semibold">About Chell</h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      Think in changes, not commands.
                    </p>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm text-muted-foreground">Version</p>
                        <p className="text-sm font-mono">0.1.1</p>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm text-muted-foreground">Build</p>
                        <p className="text-sm font-mono">2026.01.30</p>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm text-muted-foreground">License</p>
                        <p className="text-sm">MIT</p>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Updates</p>
                        {updateStatus && (
                          <p className="text-xs text-muted-foreground">{updateStatus}</p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={checkForUpdates}
                        disabled={isCheckingUpdate}
                      >
                        {isCheckingUpdate ? (
                          <>
                            <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                            Checking...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-3 w-3" />
                            Check for Updates
                          </>
                        )}
                      </Button>
                    </div>

                    <div className="mt-8 rounded-lg border border-border bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">
                        Chell brings git, a terminal, and AI coding into one place. Visually track
                        what your agent changes in real-time and commit often with confidence.
                      </p>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
