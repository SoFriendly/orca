import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  GitBranch,
  Bot,
  Terminal as TerminalIcon,
  ChevronDown,
  ChevronRight,
  File,
  Plus,
  RotateCcw,
  X,
  Folder,
  RefreshCw,
  History,
  Sparkles,
  Check,
} from "lucide-react";
import { OrcaIcon } from "./components/OrcaIcon";
import { cn } from "./lib/utils";

// Typewriter text component
function TypewriterText({
  text,
  startFrame = 0,
  charactersPerFrame = 0.8,
  className,
}: {
  text: string;
  startFrame?: number;
  charactersPerFrame?: number;
  className?: string;
}) {
  const frame = useCurrentFrame();
  const adjustedFrame = Math.max(0, frame - startFrame);
  const charactersToShow = Math.floor(adjustedFrame * charactersPerFrame);
  const displayedText = text.slice(0, charactersToShow);
  const showCursor = adjustedFrame > 0 && charactersToShow < text.length;

  return (
    <span className={className}>
      {displayedText}
      {showCursor && <span className="text-[hsl(var(--primary))]">|</span>}
    </span>
  );
}

// Floating card wrapper with 3D transform
function FloatingCard({
  children,
  rotateX = 0,
  rotateY = 0,
  translateX = 0,
  translateY = 0,
  scale = 1,
  className,
}: {
  children: React.ReactNode;
  rotateX?: number;
  rotateY?: number;
  translateX?: number;
  translateY?: number;
  scale?: number;
  className?: string;
}) {
  return (
    <div
      style={{
        transform: `perspective(1400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateX(${translateX}px) translateY(${translateY}px) scale(${scale})`,
        transformStyle: "preserve-3d",
      }}
      className={cn(
        "rounded-2xl overflow-hidden",
        "shadow-[0_25px_80px_-15px_rgba(0,0,0,0.5)]",
        className
      )}
    >
      {children}
    </div>
  );
}

// Standalone Git Panel Component - LARGER
function GitPanelCard({ showDiff = true }: { showDiff?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const diffProgress = showDiff
    ? spring({ frame, fps, config: { damping: 200 } })
    : 0;

  return (
    <div className="w-[560px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        <div className="flex items-center gap-3">
          <GitBranch className="h-6 w-6 text-[hsl(var(--primary))]" />
          <span className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Changes
          </span>
          <span className="rounded-full bg-[hsl(var(--primary))] px-3 py-1 text-sm font-medium text-white">
            4
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-lg bg-[hsl(var(--muted))] px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))]">
            <GitBranch className="h-4 w-4" />
            main
          </span>
          <button className="flex h-10 w-10 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]">
            <RefreshCw className="h-5 w-5" />
          </button>
          <button className="flex h-10 w-10 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]">
            <History className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="p-4 space-y-2">
        {/* New file */}
        <div className="flex items-center gap-4 rounded-xl px-5 py-4 bg-[hsl(var(--muted))]/50">
          <ChevronRight className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <div className="h-4 w-4 rounded-full bg-[hsl(var(--tokyo-green))]" />
          <File className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <span className="flex-1 text-base text-[hsl(var(--foreground))]">
            NewComponent.tsx
          </span>
          <span className="text-sm font-medium text-[hsl(var(--tokyo-green))]">
            +142
          </span>
        </div>

        {/* Modified file with diff */}
        <div>
          <div className="flex items-center gap-4 rounded-xl px-5 py-4 bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/30">
            <ChevronDown className="h-5 w-5 text-[hsl(var(--primary))]" />
            <div className="h-4 w-4 rounded-full bg-[hsl(var(--tokyo-orange))]" />
            <File className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            <span className="flex-1 text-base text-[hsl(var(--foreground))] font-medium">
              App.tsx
            </span>
            <span className="text-sm font-medium text-[hsl(var(--tokyo-orange))]">
              +24 -8
            </span>
          </div>

          {/* Diff view */}
          {showDiff && (
            <div
              style={{
                opacity: diffProgress,
                transform: `translateY(${(1 - diffProgress) * -10}px)`,
                maxHeight: diffProgress * 220,
              }}
              className="mx-3 mt-3 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))]"
            >
              <div className="flex items-center justify-between px-5 py-3 text-sm text-[hsl(var(--muted-foreground))] border-b border-[hsl(var(--border))]">
                <span className="font-mono">@@ -12,4 +12,6 @@</span>
                <button className="flex items-center gap-2 text-[hsl(var(--tokyo-red))]">
                  <RotateCcw className="h-4 w-4" />
                  <span>Discard</span>
                </button>
              </div>
              <div className="font-mono text-sm">
                <div className="flex bg-[hsl(var(--tokyo-red))]/10 text-[hsl(var(--tokyo-red))] px-5 py-2">
                  <span className="w-10 text-right mr-4 opacity-50">12</span>
                  <span className="mr-3">-</span>
                  <span>{"return <div>Hello</div>"}</span>
                </div>
                <div className="flex bg-[hsl(var(--tokyo-green))]/10 text-[hsl(var(--tokyo-green))] px-5 py-2">
                  <span className="w-10 text-right mr-4 opacity-50">12</span>
                  <span className="mr-3">+</span>
                  <span>{"return ("}</span>
                </div>
                <div className="flex bg-[hsl(var(--tokyo-green))]/10 text-[hsl(var(--tokyo-green))] px-5 py-2">
                  <span className="w-10 text-right mr-4 opacity-50">13</span>
                  <span className="mr-3">+</span>
                  <span>{"  <MainLayout>"}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Another modified file */}
        <div className="flex items-center gap-4 rounded-xl px-5 py-4 bg-[hsl(var(--muted))]/50">
          <ChevronRight className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <div className="h-4 w-4 rounded-full bg-[hsl(var(--tokyo-orange))]" />
          <File className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <span className="flex-1 text-base text-[hsl(var(--foreground))]">
            styles.css
          </span>
          <span className="text-sm font-medium text-[hsl(var(--tokyo-orange))]">
            +18 -3
          </span>
        </div>

        {/* Deleted file */}
        <div className="flex items-center gap-4 rounded-xl px-5 py-4 bg-[hsl(var(--muted))]/50">
          <ChevronRight className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <div className="h-4 w-4 rounded-full bg-[hsl(var(--tokyo-red))]" />
          <File className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
          <span className="flex-1 text-base text-[hsl(var(--muted-foreground))] line-through">
            old-utils.js
          </span>
          <span className="text-sm font-medium text-[hsl(var(--tokyo-red))]">
            -89
          </span>
        </div>
      </div>
    </div>
  );
}

// Standalone Commit Panel Component - AI commit message
function CommitPanelCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const buttonGlow = interpolate(frame, [0.8 * fps, 1.2 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div className="w-[560px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        <div className="flex items-center gap-3">
          <GitBranch className="h-6 w-6 text-[hsl(var(--primary))]" />
          <span className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Commit
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
          <span className="text-[hsl(var(--tokyo-green))]">3 files</span>
          <span>staged</span>
        </div>
      </div>

      {/* Staged files */}
      <div className="px-6 py-4 border-b border-[hsl(var(--border))]">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-sm">
            <Check className="h-4 w-4 text-[hsl(var(--tokyo-green))]" />
            <File className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <span className="text-[hsl(var(--foreground))]">ThemeContext.tsx</span>
            <span className="text-[hsl(var(--tokyo-green))] ml-auto">+48</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Check className="h-4 w-4 text-[hsl(var(--tokyo-green))]" />
            <File className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <span className="text-[hsl(var(--foreground))]">Settings.tsx</span>
            <span className="text-[hsl(var(--tokyo-orange))] ml-auto">+12 -3</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Check className="h-4 w-4 text-[hsl(var(--tokyo-green))]" />
            <File className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <span className="text-[hsl(var(--foreground))]">index.css</span>
            <span className="text-[hsl(var(--tokyo-orange))] ml-auto">+24 -8</span>
          </div>
        </div>
      </div>

      {/* Commit message area */}
      <div className="p-6">
        {/* AI generated label */}
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-[hsl(var(--primary))]" />
          <span className="text-sm text-[hsl(var(--primary))] font-medium">
            AI-generated message
          </span>
        </div>

        {/* Message input */}
        <div className="bg-[hsl(var(--background))] rounded-xl border border-[hsl(var(--border))] p-4 mb-5">
          <div className="text-base text-[hsl(var(--foreground))] min-h-[60px]">
            Add dark mode toggle with system preference detection
          </div>
        </div>

        {/* Commit button */}
        <button
          className="w-full py-4 rounded-xl text-lg font-semibold text-white transition-all"
          style={{
            backgroundColor: `hsl(var(--primary))`,
            boxShadow: buttonGlow > 0
              ? `0 0 ${30 * buttonGlow}px ${10 * buttonGlow}px hsl(252 87% 67% / ${0.4 * buttonGlow})`
              : 'none',
          }}
        >
          Commit Changes
        </button>
      </div>
    </div>
  );
}

// Standalone Assistant Panel Component - LARGER
function AssistantPanelCard() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const typingProgress = interpolate(frame, [0, 2.5 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <div className="w-[640px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex h-16 items-center border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        <div className="flex flex-1 items-center">
          {/* Active tab */}
          <div className="flex items-center gap-3 border-r border-[hsl(var(--border))] px-6 py-5 text-base font-medium border-b-2 border-b-[hsl(var(--primary))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]">
            <Bot className="h-5 w-5 text-[hsl(var(--primary))]" />
            <span>Claude Code</span>
            <button className="ml-2 rounded p-1">
              <X className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            </button>
          </div>
          {/* Inactive tab */}
          <div className="flex items-center gap-3 border-r border-[hsl(var(--border))] px-6 py-5 text-base font-medium text-[hsl(var(--muted-foreground))]">
            <TerminalIcon className="h-5 w-5" />
            <span>OpenAI Codex</span>
          </div>
          {/* Another tab */}
          <div className="flex items-center gap-3 border-r border-[hsl(var(--border))] px-6 py-5 text-base font-medium text-[hsl(var(--muted-foreground))]">
            <TerminalIcon className="h-5 w-5" />
            <span>Gemini</span>
          </div>
        </div>
        <button className="flex items-center px-5 py-4 text-[hsl(var(--muted-foreground))]">
          <Plus className="h-6 w-6" />
        </button>
      </div>

      {/* Terminal content */}
      <div
        className="p-6 font-mono text-base bg-[hsl(228,18%,10%)]"
        style={{ minHeight: 340 }}
      >
        <div className="text-[hsl(var(--muted-foreground))]">$ claude</div>
        <div className="mt-4 text-[hsl(var(--tokyo-green))]">
          ╭───────────────────────────────────────────────╮
        </div>
        <div className="text-[hsl(var(--tokyo-green))]">
          │ Welcome to Claude Code!                       │
        </div>
        <div className="text-[hsl(var(--tokyo-green))]">
          ╰───────────────────────────────────────────────╯
        </div>
        <div className="mt-5 text-[hsl(var(--foreground))]">
          <span className="text-[hsl(var(--primary))]">&gt;</span> Add a dark
          mode toggle to the settings page
        </div>
        <div className="mt-5 space-y-3">
          <div className="text-[hsl(var(--tokyo-cyan))]">
            I'll add a dark mode toggle. Let me:
          </div>
          {typingProgress > 0.15 && (
            <div className="text-[hsl(var(--foreground))] pl-5 flex items-center gap-3">
              <span className="text-[hsl(var(--tokyo-green))]">✓</span>
              <span>Create a theme context</span>
            </div>
          )}
          {typingProgress > 0.35 && (
            <div className="text-[hsl(var(--foreground))] pl-5 flex items-center gap-3">
              <span className="text-[hsl(var(--tokyo-green))]">✓</span>
              <span>Add toggle component</span>
            </div>
          )}
          {typingProgress > 0.55 && (
            <div className="text-[hsl(var(--foreground))] pl-5 flex items-center gap-3">
              <span className="text-[hsl(var(--tokyo-yellow))]">◐</span>
              <span>Update the settings page</span>
            </div>
          )}
        </div>
        {typingProgress > 0.7 && (
          <div className="mt-5">
            <div className="text-[hsl(var(--tokyo-yellow))]">
              Writing src/contexts/ThemeContext.tsx...
            </div>
          </div>
        )}
        {typingProgress > 0.85 && (
          <div className="text-[hsl(var(--tokyo-green))]">
            ✓ Created ThemeContext.tsx
          </div>
        )}
        <div className="mt-4 text-[hsl(var(--primary))]">█</div>
      </div>
    </div>
  );
}

// Standalone Shell Panel Component - LARGER
function ShellPanelCard() {
  return (
    <div className="w-[580px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]">
        <div className="flex items-center gap-4">
          <TerminalIcon className="h-6 w-6 text-[hsl(var(--primary))]" />
          <span className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Shell
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-3 rounded-lg bg-[hsl(var(--muted))] px-4 py-2 text-sm text-[hsl(var(--muted-foreground))]">
            <Folder className="h-5 w-5" />
            <span>my-app</span>
            <ChevronDown className="h-5 w-5" />
          </button>
          <button className="flex h-10 w-10 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))]">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div
        className="p-6 font-mono text-base bg-[hsl(228,18%,10%)]"
        style={{ minHeight: 320 }}
      >
        <div>
          <span className="text-[hsl(var(--tokyo-green))]">➜</span>{" "}
          <span className="text-[hsl(var(--tokyo-cyan))]">my-app</span>{" "}
          <span className="text-[hsl(var(--tokyo-magenta))]">git:(</span>
          <span className="text-[hsl(var(--tokyo-red))]">main</span>
          <span className="text-[hsl(var(--tokyo-magenta))]">)</span>
        </div>
        <div className="text-[hsl(var(--foreground))]">$ npm test</div>
        <div className="mt-4 text-[hsl(var(--muted-foreground))]">
          <div>&gt; my-app@0.1.0 test</div>
          <div>&gt; vitest run</div>
        </div>
        <div className="mt-4">
          <div className="text-[hsl(var(--tokyo-green))]">
            ✓ src/App.test.tsx (3 tests) 12ms
          </div>
          <div className="text-[hsl(var(--tokyo-green))]">
            ✓ src/utils.test.ts (5 tests) 8ms
          </div>
          <div className="text-[hsl(var(--tokyo-green))]">
            ✓ src/hooks.test.ts (4 tests) 15ms
          </div>
        </div>
        <div className="mt-4">
          <div className="text-[hsl(var(--foreground))]">
            Test Files{" "}
            <span className="text-[hsl(var(--tokyo-green))]">3 passed</span> (3)
          </div>
          <div className="text-[hsl(var(--foreground))]">
            Tests{" "}
            <span className="text-[hsl(var(--tokyo-green))]">12 passed</span>{" "}
            (12)
          </div>
          <div className="text-[hsl(var(--muted-foreground))]">
            Duration 35ms
          </div>
        </div>
        <div className="mt-4">
          <span className="text-[hsl(var(--tokyo-green))]">➜</span>{" "}
          <span className="text-[hsl(var(--tokyo-cyan))]">my-app</span>
          <span className="text-[hsl(var(--primary))] ml-2">█</span>
        </div>
      </div>
    </div>
  );
}

// Scene 1: Opening with logo and tagline
function OpeningScene() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 200 } });

  const taglineDelay = 0.5 * fps;
  const exitStart = durationInFrames - 0.8 * fps; // Start exit 0.8s before end

  // Title/subtitle exit animation - slide up and fade out
  const exitProgress = interpolate(
    frame,
    [exitStart, durationInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) }
  );

  const logoOpacity = interpolate(
    frame,
    [0, 0.4 * fps, exitStart, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const titleY = exitProgress * -100; // Slide up 100px on exit

  // Screenshot animation - peeks up from bottom, then slides back down before transition
  const screenshotDelay = 0.2 * fps;

  const screenshotProgress = spring({
    frame: frame - screenshotDelay,
    fps,
    config: { damping: 100, stiffness: 60 },
  });

  const screenshotY = interpolate(screenshotProgress, [0, 1], [600, 250]) + (exitProgress * 400);
  const screenshotOpacity = interpolate(
    frame,
    [screenshotDelay, screenshotDelay + 0.4 * fps, exitStart, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill className="bg-[hsl(var(--background))] flex flex-col items-center justify-center">
      {/* Subtle gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, hsl(252 87% 67% / 0.1) 0%, transparent 60%)",
        }}
      />

      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${logoScale}) translateY(${titleY}px)`,
          marginTop: -120,
        }}
        className="flex items-center gap-8 relative z-10"
      >
        <OrcaIcon className="h-40 w-40 text-[hsl(var(--primary))]" />
        <span className="text-[10rem] font-bold text-[hsl(var(--foreground))] leading-none">
          orca
        </span>
      </div>
      <div
        className="mt-8 text-5xl text-[hsl(var(--muted-foreground))] relative z-10"
        style={{
          opacity: logoOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <TypewriterText
          text="Git, Terminal, and AI Coding in One"
          startFrame={taglineDelay}
          charactersPerFrame={1.5}
        />
      </div>

      {/* Screenshot peeking from bottom */}
      <div
        className="absolute left-1/2 bottom-0 z-20"
        style={{
          opacity: screenshotOpacity,
          transform: `translateX(-50%) translateY(${screenshotY}px) perspective(1200px) rotateX(5deg)`,
        }}
      >
        <div className="rounded-t-2xl overflow-hidden shadow-[0_-30px_100px_-20px_rgba(139,92,246,0.4)]">
          <Img
            src={staticFile("chell-screenshot.png")}
            style={{ width: 1300 }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Feature scene with floating card - TIGHTER LAYOUT
function FeatureScene({
  title,
  description,
  children,
  panDirection = "left",
  rotateY = 15,
  rotateX = 5,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  panDirection?: "left" | "right";
  rotateY?: number;
  rotateX?: number;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Card entrance animation
  const cardProgress = spring({
    frame,
    fps,
    config: { damping: 100, stiffness: 80 },
  });

  // Panning animation - reduced distance
  const panDistance = 40;
  const panX = interpolate(
    frame,
    [0, durationInFrames],
    panDirection === "left"
      ? [panDistance, -panDistance]
      : [-panDistance, panDistance],
    { easing: Easing.inOut(Easing.quad) }
  );

  // Subtle floating animation
  const floatY = Math.sin(frame * 0.05) * 6;

  // Title slam animation
  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 200 },
  });

  // Text animations
  const textOpacity = interpolate(frame, [0.3 * fps, 0.6 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const initialRotateY = panDirection === "left" ? 20 : -20;
  const currentRotateY = interpolate(cardProgress, [0, 1], [initialRotateY, rotateY]);
  const currentRotateX = interpolate(cardProgress, [0, 1], [12, rotateX]);
  const cardScale = interpolate(cardProgress, [0, 1], [0.85, 1]);
  const cardOpacity = interpolate(cardProgress, [0, 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill className="bg-[hsl(var(--background))]">
      {/* Gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            panDirection === "left"
              ? "radial-gradient(ellipse at 70% 50%, hsl(252 87% 67% / 0.08) 0%, transparent 50%)"
              : "radial-gradient(ellipse at 30% 50%, hsl(252 87% 67% / 0.08) 0%, transparent 50%)",
        }}
      />

      {/* Main content */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={cn(
            "flex items-center justify-center gap-24",
            panDirection === "right" && "flex-row-reverse"
          )}
        >
          {/* Text */}
          <div
            className="w-[520px]"
            style={{
              transform: `translateY(${floatY * 0.5}px)`,
            }}
          >
            <h2
              className="text-6xl font-bold text-[hsl(var(--foreground))] leading-[1.1] mb-6"
              style={{
                opacity: interpolate(titleProgress, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }),
                transform: `scale(${interpolate(titleProgress, [0, 1], [1.3, 1])})`,
                transformOrigin: panDirection === "right" ? "right center" : "left center",
              }}
            >
              {title}
            </h2>
            <p
              className="text-3xl text-[hsl(var(--muted-foreground))] leading-relaxed"
              style={{ opacity: textOpacity }}
            >
              <TypewriterText
                text={description}
                startFrame={0.4 * fps}
                charactersPerFrame={1.5}
              />
            </p>
          </div>

          {/* Floating card */}
          <div className="flex-shrink-0">
            <FloatingCard
              rotateX={currentRotateX}
              rotateY={currentRotateY}
              translateX={panX}
              translateY={floatY}
              scale={cardScale}
            >
              <div style={{ opacity: cardOpacity }}>{children}</div>
            </FloatingCard>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// Closing scene
function ClosingScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoProgress = spring({
    frame,
    fps,
    config: { damping: 200 },
  });

  const ctaOpacity = interpolate(frame, [0.6 * fps, 1 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ctaScale = spring({
    frame: frame - 0.6 * fps,
    fps,
    config: { damping: 200 },
  });

  return (
    <AbsoluteFill className="bg-[hsl(var(--background))] flex flex-col items-center justify-center">
      {/* Gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, hsl(252 87% 67% / 0.15) 0%, transparent 50%)",
        }}
      />

      <div
        style={{
          opacity: logoProgress,
          transform: `scale(${logoProgress})`,
        }}
        className="flex items-center gap-6 mb-6 relative z-10"
      >
        <OrcaIcon className="h-32 w-32 text-[hsl(var(--primary))]" />
        <span className="text-9xl font-bold text-[hsl(var(--foreground))]">
          orca
        </span>
      </div>

      <div
        className="text-4xl text-[hsl(var(--muted-foreground))] mb-4 relative z-10"
        style={{ opacity: logoProgress }}
      >
        Think in changes, not commands.
      </div>

      <div
        className="text-2xl font-medium text-[hsl(var(--primary))] mb-10 relative z-10"
        style={{ opacity: logoProgress }}
      >
        100% Free & Open Source
      </div>

      <div
        style={{
          opacity: ctaOpacity,
          transform: `scale(${Math.max(0, ctaScale)})`,
        }}
        className="relative z-10"
      >
        <span className="text-5xl font-semibold text-[hsl(var(--primary))]">
          orca.ai
        </span>
      </div>
    </AbsoluteFill>
  );
}

// Background music with fade out
function BackgroundMusic() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade out over last 1.5 seconds
  const fadeOutStart = durationInFrames - 1.5 * fps;
  const volume = interpolate(
    frame,
    [0, 0.5 * fps, fadeOutStart, durationInFrames],
    [0, 0.7, 0.7, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <Audio
      src={staticFile("Aylex - Blast (freetouse.com).mp3")}
      volume={volume}
    />
  );
}

// Main composition - synced to 75 BPM (1 beat = 24 frames)
// Total duration: (120 + 144 + 144 + 144 + 144 + 144) - (5 * 24) = 720 frames = 24 seconds
export const MyComposition = () => {
  const BEAT = 24; // 75 BPM = 24 frames per beat
  const TRANSITION_DURATION = BEAT; // 1 beat transition

  return (
    <AbsoluteFill className="bg-[hsl(var(--background))]">
      <BackgroundMusic />
      <TransitionSeries>
        {/* Scene 1: Opening - 5 beats (4s) */}
        <TransitionSeries.Sequence durationInFrames={BEAT * 5}>
          <OpeningScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Scene 2: Git Panel - 6 beats (4.8s) */}
        <TransitionSeries.Sequence durationInFrames={BEAT * 6}>
          <FeatureScene
            title="Pull, push, and see what changed"
            description="Every git operation is one click away. Expand any file to see the inline diff with syntax highlighting. Discard hunks you don't want, keep the ones you do."
            panDirection="right"
            rotateY={-10}
            rotateX={6}
          >
            <GitPanelCard showDiff />
          </FeatureScene>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Scene 3: Commit Panel - 6 beats (4.8s) */}
        <TransitionSeries.Sequence durationInFrames={BEAT * 6}>
          <FeatureScene
            title="One-click commits that make sense"
            description="Orca analyzes your changes and generates meaningful commit messages. Review, edit if needed, and commit with confidence."
            panDirection="left"
            rotateY={10}
            rotateX={5}
          >
            <CommitPanelCard />
          </FeatureScene>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Scene 4: Assistant Panel - 6 beats (4.8s) */}
        <TransitionSeries.Sequence durationInFrames={BEAT * 6}>
          <FeatureScene
            title="Claude Code, OpenAI Codex, and whatever's next"
            description="Switch between assistants with tabs. Orca doesn't lock you into one AI—it gives you a great terminal that understands what any assistant is doing to your codebase."
            panDirection="left"
            rotateY={10}
            rotateX={5}
          >
            <AssistantPanelCard />
          </FeatureScene>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Scene 5: Shell Panel - 6 beats (4.8s) */}
        <TransitionSeries.Sequence durationInFrames={BEAT * 6}>
          <FeatureScene
            title="Your Terminal, Smarter"
            description="Run your dev server, watch your logs, and keep everything visible in one place. Type what you want in plain English and let NLT generate the command for you."
            panDirection="right"
            rotateY={-8}
            rotateX={4}
          >
            <ShellPanelCard />
          </FeatureScene>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_DURATION })}
        />

        {/* Scene 6: Closing - 6 beats (4.8s) */}
        <TransitionSeries.Sequence durationInFrames={BEAT * 6}>
          <ClosingScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
