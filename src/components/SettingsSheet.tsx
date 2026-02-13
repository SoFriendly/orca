import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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
  Smartphone,
  Eye,
  EyeOff,
  Trash2,
  Plus,
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
import { useUpdateStore } from "@/stores/updateStore";
import { cn } from "@/lib/utils";
import { CustomThemeEditor } from "@/components/CustomThemeEditor";
import { RemotePortalSettings } from "@/components/RemotePortalSettings";
import { getAllAssistants, getAllAssistantCommands } from "@/lib/assistants";
import type { ThemeOption, AssistantDefinition } from "@/types";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab = "general" | "assistants" | "appearance" | "ai" | "keyboard" | "portal" | "about";

const NAV_ITEMS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings className="h-4 w-4" /> },
  { id: "assistants", label: "Assistants", icon: <Bot className="h-4 w-4" /> },
  { id: "appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
  { id: "ai", label: "AI Behavior", icon: <Sparkles className="h-4 w-4" /> },
  { id: "portal", label: "Remote Portal", icon: <Smartphone className="h-4 w-4" /> },
  { id: "keyboard", label: "Keyboard", icon: <Keyboard className="h-4 w-4" /> },
  { id: "about", label: "About", icon: <Info className="h-4 w-4" /> },
];

interface ThemeInfo {
  id: ThemeOption;
  name: string;
  gradient: string;
}

const THEMES: ThemeInfo[] = [
  { id: "tokyo", name: "Chell Blue", gradient: "from-indigo-500/60 to-slate-900" },
  { id: "dark", name: "Chell Orange", gradient: "from-portal-orange/60 to-neutral-900" },
  { id: "light", name: "Light", gradient: "from-slate-200 to-slate-100" },
  { id: "custom", name: "Custom", gradient: "from-purple-500/60 via-pink-500/60 to-orange-500/60" },
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
    groqApiKey,
    setGroqApiKey,
    preferredEditor,
    setPreferredEditor,
    showHiddenFiles,
    setShowHiddenFiles,
    customAssistants,
    hiddenAssistantIds,
    addCustomAssistant,
    removeCustomAssistant,
    toggleAssistantHidden,
  } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [appVersion, setAppVersion] = useState<string>("");
  const [localDefaultClonePath, setLocalDefaultClonePath] = useState(defaultClonePath || "");
  const [installedAssistants, setInstalledAssistants] = useState<string[]>([]);
  const [installingCommands, setInstallingCommands] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAssistant, setNewAssistant] = useState({ name: "", command: "", description: "", installCommand: "", docsUrl: "" });
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const allAssistants = getAllAssistants(customAssistants);

  const buildArgsState = () => {
    const state: Record<string, string> = {};
    for (const a of allAssistants) {
      const argsKey = a.id === "claude" ? "claude-code" : a.id;
      state[argsKey] = assistantArgs[argsKey] || "";
    }
    return state;
  };

  const [assistantArgsState, setAssistantArgsState] = useState<Record<string, string>>(buildArgsState);

  const { isChecking: isCheckingUpdate, checkForUpdates, updateAvailable } = useUpdateStore();

  // Fetch app version from Tauri
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  // Update local state when store changes
  useEffect(() => {
    setLocalDefaultClonePath(defaultClonePath || "");
  }, [defaultClonePath]);

  useEffect(() => {
    setAssistantArgsState(buildArgsState());
  }, [assistantArgs, customAssistants]);

  const checkInstalledAssistants = useCallback(async () => {
    try {
      const commands = getAllAssistantCommands(customAssistants);
      const installed = await invoke<string[]>("check_commands_installed", { commands });
      setInstalledAssistants(installed);

      // Stop polling for any commands that are now installed
      setInstallingCommands((prev) => {
        const next = new Set(prev);
        for (const cmd of prev) {
          if (installed.includes(cmd)) {
            next.delete(cmd);
          }
        }
        return next;
      });
    } catch (error) {
      console.error("Failed to check installed assistants:", error);
    }
  }, [customAssistants]);

  // Check installed assistants when dialog opens
  useEffect(() => {
    if (open) {
      checkInstalledAssistants();
    }
    if (!open) {
      // Clear installing state when dialog closes
      setInstallingCommands(new Set());
    }
  }, [open, checkInstalledAssistants]);

  // Poll while any assistants are being installed
  useEffect(() => {
    if (installingCommands.size > 0 && open) {
      pollIntervalRef.current = setInterval(() => {
        checkInstalledAssistants();
      }, 3000);
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [installingCommands.size, open, checkInstalledAssistants]);

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
    const assistant = allAssistants.find(a => a.id === assistantId);
    if (!installedAssistants.includes(assistant?.command || "")) {
      toast.error(`${assistant?.name} is not installed`);
      return;
    }
    setDefaultAssistant(assistantId);
    toast.success(`Default assistant set to ${assistant?.name}`);
  };

  const handleInstallAssistant = async (assistant: AssistantDefinition) => {
    try {
      const cwd = await invoke<string>("get_home_dir").catch(() => "/tmp");

      // Track this command as installing (starts polling)
      setInstallingCommands((prev) => new Set(prev).add(assistant.command));

      // Run install command through a login shell to handle pipes, env vars, etc.
      const shellCmd = assistant.installCommand;
      const params = new URLSearchParams({
        command: shellCmd,
        cwd,
        title: `Installing ${assistant.name}`,
        shell: "true",
      });
      new WebviewWindow(`install-${Date.now()}`, {
        url: `/terminal?${params.toString()}`,
        title: `Installing ${assistant.name}`,
        width: 800,
        height: 500,
        center: true,
        titleBarStyle: "overlay" as const,
        hiddenTitle: true,
        visible: true,
      });
    } catch (error) {
      console.error("Failed to open install terminal:", error);
      setInstallingCommands((prev) => {
        const next = new Set(prev);
        next.delete(assistant.command);
        return next;
      });
      navigator.clipboard.writeText(assistant.installCommand);
      toast.success("Install command copied to clipboard");
    }
  };

  const handleAddCustomAssistant = () => {
    if (!newAssistant.name.trim() || !newAssistant.command.trim()) {
      toast.error("Name and command are required");
      return;
    }
    const id = crypto.randomUUID();
    addCustomAssistant({
      id,
      name: newAssistant.name.trim(),
      command: newAssistant.command.trim(),
      description: newAssistant.description.trim(),
      installCommand: newAssistant.installCommand.trim(),
      docsUrl: newAssistant.docsUrl.trim(),
    });
    setNewAssistant({ name: "", command: "", description: "", installCommand: "", docsUrl: "" });
    setShowAddForm(false);
    toast.success("Custom assistant added");
    // Re-check installed
    checkInstalledAssistants();
  };

  const handleRemoveCustomAssistant = (id: string, name: string) => {
    removeCustomAssistant(id);
    toast.success(`${name} removed`);
  };

  const handleCheckForUpdates = async () => {
    try {
      await checkForUpdates();
      // If no update available, show a toast (the dialog will show automatically if update found)
      if (!useUpdateStore.getState().updateAvailable) {
        toast.success("You're on the latest version");
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check for common dev mode errors
      if (errorMessage.includes("signature") || errorMessage.includes("Could not fetch") || errorMessage.includes("TAURI_ENV")) {
        toast.error("Updates only work in release builds");
      } else {
        toast.error(`Failed to check for updates: ${errorMessage}`);
      }
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
                    <h3 className="text-lg font-semibold">Git Configuration</h3>
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
                            aria-label="Default clone path"
                            className="w-56 h-9 bg-muted/50"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-9 w-9"
                            onClick={handleSelectDefaultClonePath}
                            aria-label="Browse for default clone path"
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

                      {/* Preferred Editor */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Preferred Editor</p>
                          <p className="text-xs text-muted-foreground">
                            Terminal editor for "Open in Editor" (e.g., vim, nvim, nano)
                          </p>
                        </div>
                        <Input
                          value={preferredEditor || ""}
                          onChange={(e) => setPreferredEditor(e.target.value || undefined)}
                          placeholder="nvim"
                          aria-label="Preferred terminal editor"
                          className="w-32 h-9 bg-muted/50 font-mono text-sm"
                        />
                      </div>

                      {/* Show Hidden Files */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Show Hidden Files</p>
                          <p className="text-xs text-muted-foreground">
                            Display dotfiles and hidden folders in the file tree.
                          </p>
                        </div>
                        <Switch
                          checked={showHiddenFiles}
                          onCheckedChange={setShowHiddenFiles}
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
                    <h3 className="text-lg font-semibold">AI Coding Assistants</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Configure which AI assistants are available and set your default.
                    </p>

                    <div className="space-y-4">
                      {allAssistants.map((assistant) => {
                        const isInstalled = installedAssistants.includes(assistant.command);
                        const isDefault = defaultAssistant === assistant.id;
                        const isHidden = hiddenAssistantIds.includes(assistant.id);
                        const argsKey = assistant.id === "claude" ? "claude-code" : assistant.id;

                        return (
                          <div
                            key={assistant.id}
                            className={cn(
                              "rounded-lg border p-4 transition-colors",
                              isDefault ? "border-primary bg-primary/5" : "border-border",
                              isHidden && "opacity-50"
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
                                    {!assistant.isBuiltIn && (
                                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                        CUSTOM
                                      </span>
                                    )}
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
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => toggleAssistantHidden(assistant.id)}
                                  aria-label={isHidden ? `Show ${assistant.name}` : `Hide ${assistant.name}`}
                                >
                                  {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </Button>
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
                                ) : installingCommands.has(assistant.command) ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled
                                  >
                                    <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                    Installing...
                                  </Button>
                                ) : assistant.installCommand ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleInstallAssistant(assistant)}
                                  >
                                    <Download className="h-3 w-3 mr-1" />
                                    Install
                                  </Button>
                                ) : null}
                                {assistant.docsUrl && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => window.open(assistant.docsUrl, "_blank")}
                                    aria-label={`Open ${assistant.name} documentation`}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                {!assistant.isBuiltIn && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => handleRemoveCustomAssistant(assistant.id, assistant.name)}
                                    aria-label={`Remove ${assistant.name}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
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
                                    aria-label={`Launch arguments for ${assistant.name}`}
                                    className="w-64 h-8 text-xs bg-muted/50"
                                  />
                                </div>
                              </div>
                            )}

                            {!isInstalled && assistant.installCommand && (
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

                  {/* Add Custom Assistant */}
                  <section>
                    {!showAddForm ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setShowAddForm(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Custom Assistant
                      </Button>
                    ) : (
                      <div className="rounded-lg border border-border p-4 space-y-4">
                        <h3 className="text-sm font-medium">Add Custom Assistant</h3>
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-muted-foreground">Name *</label>
                            <Input
                              value={newAssistant.name}
                              onChange={(e) => setNewAssistant(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="My Assistant"
                              className="h-8 text-sm bg-muted/50"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Command *</label>
                            <Input
                              value={newAssistant.command}
                              onChange={(e) => setNewAssistant(prev => ({ ...prev, command: e.target.value }))}
                              placeholder="my-assistant"
                              className="h-8 text-sm bg-muted/50 font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Description</label>
                            <Input
                              value={newAssistant.description}
                              onChange={(e) => setNewAssistant(prev => ({ ...prev, description: e.target.value }))}
                              placeholder="A brief description"
                              className="h-8 text-sm bg-muted/50"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Install Command</label>
                            <Input
                              value={newAssistant.installCommand}
                              onChange={(e) => setNewAssistant(prev => ({ ...prev, installCommand: e.target.value }))}
                              placeholder="npm install -g my-assistant"
                              className="h-8 text-sm bg-muted/50 font-mono"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Docs URL</label>
                            <Input
                              value={newAssistant.docsUrl}
                              onChange={(e) => setNewAssistant(prev => ({ ...prev, docsUrl: e.target.value }))}
                              placeholder="https://example.com/docs"
                              className="h-8 text-sm bg-muted/50"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowAddForm(false);
                              setNewAssistant({ name: "", command: "", description: "", installCommand: "", docsUrl: "" });
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleAddCustomAssistant}
                          >
                            Add Assistant
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* Appearance Tab */}
              {activeTab === "appearance" && (
                <div className="space-y-8">
                  <section>
                    <h3 className="text-lg font-semibold">Appearance</h3>
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
                      <h3 className="text-lg font-semibold">Customize Theme</h3>
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
                    <h3 className="text-lg font-semibold">AI Shell</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Configure the AI-powered shell command assistant.
                    </p>

                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">Groq API Key</p>
                          <p className="text-xs text-muted-foreground">
                            Required for AI shell commands. Get a free key at{" "}
                            <a
                              href="https://console.groq.com/keys"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              console.groq.com
                            </a>
                          </p>
                        </div>
                        <Input
                          type="password"
                          value={groqApiKey || ""}
                          onChange={(e) => setGroqApiKey(e.target.value || undefined)}
                          onBlur={(e) => {
                            if (e.target.value) {
                              toast.success("API key saved");
                            }
                          }}
                          placeholder="gsk_..."
                          aria-label="API key"
                          className="w-56 h-9 bg-muted/50 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="text-lg font-semibold">AI Behavior</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Tune how AI interacts with your workflow and code.
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
                    <h3 className="text-lg font-semibold">Keyboard Shortcuts</h3>
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

              {/* Remote Portal Tab */}
              {activeTab === "portal" && <RemotePortalSettings />}

              {/* About Tab */}
              {activeTab === "about" && (
                <div className="space-y-8">
                  <section>
                    <h3 className="text-lg font-semibold">About Chell</h3>
                    <p className="text-sm text-muted-foreground mb-6">
                      Think in changes, not commands.
                    </p>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between py-2">
                        <p className="text-sm text-muted-foreground">Version</p>
                        <p className="text-sm font-mono">{appVersion || "..."}</p>
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
                        {updateAvailable && (
                          <p className="text-xs text-muted-foreground">
                            Version {updateAvailable.version} available
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCheckForUpdates}
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
