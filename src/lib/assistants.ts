import type { AssistantDefinition, CustomAssistantConfig } from "@/types";

const isWindows = navigator.platform.toUpperCase().indexOf("WIN") >= 0;

export const BUILT_IN_ASSISTANTS: AssistantDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    description: "Anthropic's AI coding assistant with agentic capabilities",
    installCommand: isWindows
      ? "irm https://claude.ai/install.ps1 | iex"
      : "curl -fsSL https://claude.ai/install.sh | bash",
    docsUrl: "https://docs.anthropic.com/claude-code",
    isBuiltIn: true,
  },
  {
    id: "antigravity",
    name: "Antigravity CLI",
    command: "agy",
    description: "Google's Antigravity AI assistant for coding",
    installCommand: isWindows
      ? "irm https://antigravity.google/cli/install.ps1 | iex"
      : "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    docsUrl: "https://antigravity.google",
    isBuiltIn: true,
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    command: "codex",
    description: "OpenAI's code generation model",
    installCommand: "npm install -g @openai/codex",
    docsUrl: "https://platform.openai.com/docs",
    isBuiltIn: true,
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    description: "OpenCode AI coding assistant",
    installCommand: "curl -fsSL https://opencode.ai/install | bash",
    docsUrl: "https://opencode.ai/docs",
    isBuiltIn: true,
  },
];

export function getAllAssistants(
  customAssistants: CustomAssistantConfig[],
  hiddenIds?: string[]
): AssistantDefinition[] {
  const custom: AssistantDefinition[] = customAssistants.map((c) => ({
    ...c,
    isBuiltIn: false,
  }));
  const all = [...BUILT_IN_ASSISTANTS, ...custom];
  if (hiddenIds && hiddenIds.length > 0) {
    return all.filter((a) => !hiddenIds.includes(a.id));
  }
  return all;
}

export function getAllAssistantCommands(
  customAssistants: CustomAssistantConfig[]
): string[] {
  return [
    ...BUILT_IN_ASSISTANTS.map((a) => a.command),
    ...customAssistants.map((a) => a.command),
  ];
}
