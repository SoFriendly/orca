import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  Bot,
  Terminal as TerminalIcon,
  Eye,
  Undo2,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Plus,
  RotateCcw,
  Settings,
  HelpCircle,
  PanelRightClose,
  X,
  Folder,
  RefreshCw,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface OnboardingProps {
  onComplete: () => void;
}

interface Step {
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  highlight?: "git" | "assistant" | "shell";
}

const steps: Step[] = [
  {
    title: "Think in changes, not commands",
    subtitle: "Built for vibecoding",
    description:
      "Stop switching between your terminal, editor, and git client. Chell shows you what matters — the changes your AI is making — so you can stay in flow and ship faster.",
    icon: <Sparkles className="h-12 w-12" />,
  },
  {
    title: "Watch your code evolve",
    subtitle: "Git Panel",
    description:
      "See every change as it happens. New files in green, modifications in orange, deletions in red. No more running git status — your codebase is always in view.",
    icon: <GitBranch className="h-12 w-12" />,
    highlight: "git",
  },
  {
    title: "Understand what changed",
    subtitle: "Inline Diffs",
    description:
      "Expand any file to see the diff. Good vibecoding means knowing what your AI wrote — Chell makes that instant, without opening another app.",
    icon: <Eye className="h-12 w-12" />,
    highlight: "git",
  },
  {
    title: "Keep what works, toss the rest",
    subtitle: "Granular Control",
    description:
      "AI gets it wrong sometimes. Right-click any change to discard it. Stay in control without breaking your flow.",
    icon: <Undo2 className="h-12 w-12" />,
    highlight: "git",
  },
  {
    title: "Your AI, front and center",
    subtitle: "Assistant Panel",
    description:
      "Run Claude Code, Aider, Gemini, or any AI assistant here. Multiple tabs for different tasks. Your AI and your changes, always side by side.",
    icon: <Bot className="h-12 w-12" />,
    highlight: "assistant",
  },
  {
    title: "A shell when you need it",
    subtitle: "Shell Panel",
    description:
      "Run tests, start servers, check logs. Everything to validate your AI's work, without switching windows.",
    icon: <TerminalIcon className="h-12 w-12" />,
    highlight: "shell",
  },
  {
    title: "You're ready to vibe",
    subtitle: "Let's build",
    description:
      "Open a project and start coding with AI. See every change, stay in control, ship faster — all from one place.",
    icon: <Check className="h-12 w-12" />,
  },
];

// Mock Git Panel - matches GitPanel.tsx layout exactly
function MockGitPanel({ showDiff, showRevert }: { showDiff?: boolean; showRevert?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      {/* Header - matches GitPanel header */}
      <div className="flex h-10 items-center justify-end gap-1 px-3">
        <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
          <GitBranch className="h-3 w-3" />
          main
        </span>
        <button className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
          <History className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Changes section */}
      <div className="flex-1 overflow-hidden">
        <div className="px-2 py-1">
          <div className="flex items-center gap-2 px-1 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Changes</span>
            <span className="rounded bg-muted px-1.5 text-[10px]">4</span>
          </div>
        </div>

        {/* File list */}
        <div className="space-y-px px-2">
          {/* New file */}
          <div className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="h-2.5 w-2.5 rounded-sm bg-green-500" />
            <File className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-xs">NewComponent.tsx</span>
          </div>

          {/* Modified file - can be expanded */}
          <div>
            <div className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
              showDiff ? "bg-muted" : "hover:bg-muted/50"
            )}>
              {showDiff ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <div className="h-2.5 w-2.5 rounded-sm bg-portal-orange" />
              <File className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate text-xs">App.tsx</span>
            </div>

            {/* Diff view */}
            {showDiff && (
              <div className="ml-6 mr-2 mt-1 mb-2 overflow-hidden rounded border border-border">
                <div className="flex items-center justify-between bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground border-b border-border">
                  <span className="font-mono">@@ -12,4 +12,6 @@</span>
                  {showRevert && (
                    <button className="flex items-center gap-1 text-red-400 hover:text-red-300">
                      <RotateCcw className="h-3 w-3 animate-pulse" />
                      <span>Discard</span>
                    </button>
                  )}
                </div>
                <div className="font-mono text-[10px]">
                  <div className="flex bg-red-500/10 text-red-400 px-2 py-0.5">
                    <span className="w-4 text-right mr-2 text-red-400/50">12</span>
                    <span>-</span>
                    <span className="ml-1">{"return <div>Hello</div>"}</span>
                  </div>
                  <div className="flex bg-green-500/10 text-green-400 px-2 py-0.5">
                    <span className="w-4 text-right mr-2 text-green-400/50">12</span>
                    <span>+</span>
                    <span className="ml-1">{"return ("}</span>
                  </div>
                  <div className="flex bg-green-500/10 text-green-400 px-2 py-0.5">
                    <span className="w-4 text-right mr-2 text-green-400/50">13</span>
                    <span>+</span>
                    <span className="ml-1">{"  <MainLayout>"}</span>
                  </div>
                  <div className="flex bg-green-500/10 text-green-400 px-2 py-0.5">
                    <span className="w-4 text-right mr-2 text-green-400/50">14</span>
                    <span>+</span>
                    <span className="ml-1">{"    <App />"}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Another modified file */}
          <div className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="h-2.5 w-2.5 rounded-sm bg-portal-orange" />
            <File className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-xs">styles.css</span>
          </div>

          {/* Deleted file */}
          <div className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="h-2.5 w-2.5 rounded-sm bg-red-500" />
            <File className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1 truncate text-xs text-muted-foreground line-through">old-utils.js</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Mock Assistant Panel - matches ProjectPage terminal tabs
function MockAssistantPanel() {
  return (
    <div className="flex h-full flex-col select-none overflow-hidden">
      {/* Tab bar - exact match */}
      <div className="flex h-10 items-center border-b border-border">
        <div className="flex flex-1 items-center overflow-x-auto">
          {/* Active tab */}
          <div className="group flex items-center gap-1 border-r border-border px-3 py-2 text-sm font-medium border-b-2 border-b-portal-orange bg-muted/50 text-foreground">
            <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[120px]">Claude Code</span>
            <button className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity">
              <X className="h-3 w-3" />
            </button>
          </div>
          {/* Inactive tab */}
          <div className="group flex items-center gap-1 border-r border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground">
            <TerminalIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate max-w-[120px]">Aider</span>
            <button className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
        <button className="flex h-full items-center px-3 py-2 text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden bg-[#0d0d0d] p-3 font-mono text-xs">
        <div className="text-muted-foreground">$ claude</div>
        <div className="mt-1 text-green-400">╭─────────────────────────────────────╮</div>
        <div className="text-green-400">│ Welcome to Claude Code!             │</div>
        <div className="text-green-400">╰─────────────────────────────────────╯</div>
        <div className="mt-3 text-muted-foreground">&gt; Add a dark mode toggle to the settings</div>
        <div className="mt-2 space-y-1">
          <div className="text-blue-400">I'll add a dark mode toggle. Let me:</div>
          <div className="text-muted-foreground pl-2">1. Create a theme context</div>
          <div className="text-muted-foreground pl-2">2. Add toggle component</div>
          <div className="text-muted-foreground pl-2">3. Update the settings page</div>
        </div>
        <div className="mt-3 text-yellow-400">Writing src/contexts/ThemeContext.tsx...</div>
        <div className="text-green-400">✓ Created ThemeContext.tsx</div>
        <div className="mt-1 animate-pulse text-portal-orange">█</div>
      </div>
    </div>
  );
}

// Mock Shell Panel - matches ProjectPage shell
function MockShellPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header - exact match */}
      <div className="flex h-10 items-center justify-between px-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TerminalIcon className="h-4 w-4 shrink-0 text-portal-orange" />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground min-w-0"
          >
            <Folder className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[120px]">my-app</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 overflow-hidden bg-[#0d0d0d] p-3 font-mono text-xs">
        <div><span className="text-green-400">➜</span> <span className="text-blue-400">my-app</span> <span className="text-yellow-400">git:(main)</span></div>
        <div className="text-muted-foreground">$ npm run dev</div>
        <div className="mt-2 text-muted-foreground">
          <div>&gt; my-app@0.1.0 dev</div>
          <div>&gt; vite</div>
        </div>
        <div className="mt-2">
          <div className="text-green-400">VITE v5.0.0 ready</div>
          <div className="text-muted-foreground">➜ Local: <span className="text-blue-400">http://localhost:5173/</span></div>
          <div className="text-muted-foreground">➜ Network: <span className="text-muted-foreground/50">use --host to expose</span></div>
        </div>
        <div className="mt-3 text-muted-foreground">$ git status</div>
        <div className="text-yellow-400">Changes not staged for commit:</div>
        <div className="text-red-400 pl-4">modified: src/App.tsx</div>
        <div className="mt-2">
          <span className="text-green-400">➜</span> <span className="text-blue-400">my-app</span>
          <span className="animate-pulse text-portal-orange ml-1">█</span>
        </div>
      </div>
    </div>
  );
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  const handleNext = () => {
    if (isLast) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      {/* Mock UI - exact layout from ProjectPage */}
      <div className="absolute inset-0 flex">
        {/* Horizontal divider line */}
        <div className="absolute left-0 right-0 top-10 h-px bg-border" />
        {/* Vertical divider for sidebar */}
        <div className="absolute left-12 top-10 bottom-0 w-px bg-border" />

        {/* Left icon sidebar - exact match from ProjectPage */}
        <div className="flex w-12 flex-col bg-background pt-8 pb-3">
          <div className="flex flex-1 flex-col items-center mt-[9px] pt-3">
            {/* Top icons */}
            <div className="flex flex-col items-center gap-1">
              <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-portal-orange/20 text-portal-orange">
                <TerminalIcon className="h-5 w-5" />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                <Plus className="h-5 w-5" />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                <Settings className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1" />

            {/* Panel toggle icons */}
            <div className="flex flex-col items-center gap-1">
              <button className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                step.highlight === "git" ? "text-portal-orange" : "text-foreground"
              )}>
                <GitBranch className="h-5 w-5" />
              </button>
              <button className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                step.highlight === "assistant" ? "text-portal-orange" : "text-foreground"
              )}>
                <Bot className="h-5 w-5" />
              </button>
              <button className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                step.highlight === "shell" ? "text-portal-orange" : "text-foreground"
              )}>
                <PanelRightClose className="h-5 w-5" />
              </button>
            </div>

            {/* Bottom icons */}
            <div className="flex flex-col items-center gap-1 mt-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
                <HelpCircle className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Git Panel */}
          <motion.div
            className="h-full flex flex-col overflow-hidden shrink-0"
            style={{ width: 280 }}
            animate={{
              opacity: step.highlight === "git" || !step.highlight ? 1 : 0.3,
            }}
            transition={{ duration: 0.3 }}
          >
            <MockGitPanel
              showDiff={currentStep === 2 || currentStep === 3}
              showRevert={currentStep === 3}
            />
          </motion.div>

          {/* Resize handle */}
          <div className="w-1 bg-border shrink-0" />

          {/* Assistant Panel */}
          <motion.div
            className="flex-1 h-full overflow-hidden min-w-0"
            animate={{
              opacity: step.highlight === "assistant" || !step.highlight ? 1 : 0.3,
            }}
            transition={{ duration: 0.3 }}
          >
            <MockAssistantPanel />
          </motion.div>

          {/* Resize handle */}
          <div className="w-1 bg-border shrink-0" />

          {/* Shell Panel */}
          <motion.div
            className="h-full flex flex-col overflow-hidden shrink-0"
            style={{ width: 400 }}
            animate={{
              opacity: step.highlight === "shell" || !step.highlight ? 1 : 0.3,
            }}
            transition={{ duration: 0.3 }}
          >
            <MockShellPanel />
          </motion.div>
        </div>
      </div>

      {/* Highlight overlay */}
      {step.highlight && (
        <div className="absolute inset-0 pointer-events-none">
          <motion.div
            className="absolute bg-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              left: step.highlight === "git" ? 48 : step.highlight === "assistant" ? 329 : undefined,
              right: step.highlight === "shell" ? 0 : step.highlight === "assistant" ? 401 : undefined,
              top: 0,
              bottom: 0,
              width: step.highlight === "git" ? 281 : step.highlight === "shell" ? 401 : undefined,
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.85)",
            }}
          />
        </div>
      )}

      {/* Dim overlay behind modal - only when not highlighting a panel */}
      {!step.highlight && (
        <div className="absolute inset-0 bg-black/50 z-[5]" />
      )}

      {/* Main content card */}
      <div className="relative z-10 w-full max-w-lg mx-4">
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-portal-orange transition-all duration-300"
              style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
            />
          </div>

          {/* Content */}
          <div className="p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="text-center"
              >
                {/* Icon */}
                <div className="flex justify-center mb-6">
                  <div className="p-4 rounded-2xl bg-portal-orange/10 text-portal-orange">
                    {step.icon}
                  </div>
                </div>

                {/* Text */}
                <p className="text-xs font-medium uppercase tracking-wider text-portal-orange mb-2">
                  {step.subtitle}
                </p>
                <h2 className="text-2xl font-bold mb-4">{step.title}</h2>
                <p className="text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="px-8 pb-8">
            {/* Step indicators */}
            <div className="flex justify-center gap-1.5 mb-6">
              {steps.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentStep(index)}
                  className={cn(
                    "w-2 h-2 rounded-full transition-all",
                    index === currentStep
                      ? "bg-portal-orange w-6"
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  )}
                />
              ))}
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={isFirst ? handleSkip : handlePrev}
                className="text-muted-foreground"
              >
                {isFirst ? (
                  "Skip"
                ) : (
                  <>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                  </>
                )}
              </Button>

              <Button
                onClick={handleNext}
                className="bg-portal-orange hover:bg-portal-orange/90 text-white"
              >
                {isLast ? (
                  <>
                    Get Started
                    <Check className="h-4 w-4 ml-2" />
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
