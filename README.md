# Chell
## Product Requirements Document

**Version:** 1.0  
**Date:** January 2026

---

## Overview

**Product Name:** Chell

**One-liner:** A cross-platform visual git client with an integrated terminal for AI coding assistants, designed to abstract git complexity behind AI-interpreted summaries.

**Platforms:** macOS, Windows, Linux (desktop only for v1)

**Name Origin:** Reference to the protagonist of Portal—the silent character who escapes through portals. Thematically aligned with the concept of portals between mobile and remote compute, and containers as isolated environments.

---

## Core Concepts

### Git Philosophy

Git is powerful but its terminology and workflows create friction. Chell hides the complexity—no staging, stashing, or blame. The AI interprets diffs as human-readable summaries. Users think in terms of "what changed" not "what lines changed."

### Coding in Context of Diffs

The terminal and git client are interwoven. Users are not switching between "coding mode" and "git mode"—they are always aware of what's changed while they work.

### Assistant-Agnostic

Chell provides the environment. Users bring their preferred AI coding assistant (Claude Code, Aider, etc.).

---

## Information Architecture

### Home Screen

- List of projects (local git repos)
- Clone repo from remote (GitHub, GitLab, Bitbucket, self-hosted)
- Create new repo
- Auth management for git services

### Project View

- Tabbed interface—open same or different projects in multiple tabs
- Each tab contains:
  - **Main terminal:** Coding assistant session
  - **Utility sidebar:** Secondary terminal for builds, logs, processes
  - **Git panel** (collapsible)

---

## Git Panel

### Header

- Current branch display
- Branch switcher: view, create, delete branches

### Two Tabs: Changes | History

### Changes Tab

- Overall AI summary of all uncommitted changes
- File list with per-file AI summaries
- Per-file toggle: summary view ↔ line-by-line diff view
- Discard options:
  - Discard entire file
  - Discard specific lines (in diff view)
  - Discard by intent: describe what to undo ("remove the logging"), sent to coding assistant
- Commit action:
  - One-click generate commit message from AI summaries
  - Editable before committing
  - User always commits manually—never automatic

### History Tab

- Scrollable commit list
- Per-commit: AI-generated summary, author, date
- Tap to expand: files changed, per-file summaries, diff toggle
- Actions per commit:
  - Checkout (grays out "future" commits to indicate viewing an older state)
  - Create branch from this commit
  - Reset current branch to this commit

---

## Terminal Features

### Main Terminal

- Runs user's chosen coding assistant
- **Assistant launcher:** Buttons to launch installed coding assistants (Claude Code, Aider, etc.)—no manual typing required to start a session
- Quick-install buttons for popular assistants not yet installed
- Voice input via system dictation—AI translates natural language to terminal commands

### Settings: Default Arguments

Per-assistant launch flags configurable in settings. Example: Claude Code can be set to always launch with `--dangerously-skip-permissions`.

### Utility Sidebar Terminal

- Standard shell (system default)
- For builds, dev servers, log tailing, non-AI terminal work

### Snippets

- User-defined snippets (global and per-project)
- AI-suggested snippets based on project analysis (detects package.json, Makefile, etc. and suggests relevant commands)

---

## File/Project Actions

- Right-click file → "Open in Finder" (or system equivalent)
- Right-click project → "Open in Finder"
- No built-in file browser or code editor—coding happens through the AI assistant

---

## Offline Behavior

- All git operations work offline
- AI features (summaries, intent-based revert, voice command translation, snippet suggestions) require internet
- Graceful degradation: falls back to standard diff view when AI unavailable

---

## Platform Considerations

### Desktop (macOS/Windows/Linux)

- Native window management, multiple tabs
- Full shell/PTY access for running coding assistants locally
- System keychain integration for git credentials
- Keyboard-driven terminal experience
- Voice input via system dictation APIs

---

## Out of Scope (v1)

- Mobile apps (iOS, Android)
- Staging
- Stashing
- Git blame
- Built-in code editor
- File browser
- Collaboration/multi-user
- Cross-device sync
- Notifications
- Pricing model

---

## Technical Architecture

### Framework

**Tauri + Rust** — Native desktop app with web frontend. Chosen for native performance, tiny bundle size (~10MB vs ~150MB Electron), full shell/PTY access, and strong security model.

### Stack

| Layer | Technology |
|-------|------------|
| Backend | Rust + Tauri |
| Frontend | React + TypeScript |
| UI Components | shadcn/ui |
| Terminal | xterm.js |
| Git | git2 (Rust libgit2 bindings) |
| State Management | Zustand or Jotai |

### Core Dependencies

**Rust/Backend:**
| Crate | Purpose |
|-------|---------|
| tauri | App framework, IPC, window management |
| git2 | Git operations (libgit2 bindings) |
| portable-pty | Cross-platform PTY for spawning shells |
| serde | Serialization for IPC |
| keyring | System keychain access for credentials |

**Frontend:**
| Package | Purpose |
|---------|---------|
| xterm.js | Terminal emulator |
| xterm-addon-fit | Auto-resize terminal to container |
| xterm-addon-web-links | Clickable URLs in terminal |
| shadcn/ui | UI component library |
| tailwindcss | Styling |
| @tauri-apps/api | Frontend-to-backend IPC |

### Component Mapping (shadcn/ui)

| Chell Feature | shadcn Component |
|---------------|------------------|
| Tabbed sessions | `Tabs` |
| Git panel (collapsible sidebar) | `ResizablePanelGroup` |
| Changes / History tabs | `Tabs` |
| File list with AI summaries | `Table` or `Accordion` |
| Commit action / message input | `Dialog` + `Input` + `Textarea` |
| Branch switcher | `Select` / `Combobox` |
| Discard confirmation | `AlertDialog` |
| Buttons (commit, discard, push, pull) | `Button` |
| Snippets picker | `Command` (cmdk) |
| Assistant launcher | `Select` or button group |
| Settings panel | `Sheet` (side drawer) |
| Notifications (push success, errors) | `Sonner` (toast) |
| AI summary cards | `Card` |
| Context menus (right-click file) | `ContextMenu` |

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Chell App                            │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + shadcn/ui)                               │
│  ┌─────────────┬─────────────────────┬─────────────────┐    │
│  │  Home       │  Project View       │  Settings       │    │
│  │  (Projects) │  (Tabs + Terminals) │  (Sheet)        │    │
│  └─────────────┴─────────────────────┴─────────────────┘    │
│                           │                                 │
│                    xterm.js (terminal UI)                   │
│                           │                                 │
├───────────────────────────┼─────────────────────────────────┤
│                     Tauri IPC                               │
├───────────────────────────┼─────────────────────────────────┤
│  Backend (Rust)           │                                 │
│  ┌────────────────────────┼────────────────────────────┐    │
│  │                        ▼                            │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐   │    │
│  │  │ PTY Manager │  │ Git Service │  │ AI Service │   │    │
│  │  │ (shells)    │  │ (git2)      │  │ (summaries)│   │    │
│  │  └─────────────┘  └─────────────┘  └────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│  Platform Layer                                             │
│  ┌─────────────────┬─────────────────┬─────────────────┐    │
│  │      macOS      │     Windows     │      Linux      │    │
│  └─────────────────┴─────────────────┴─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### IPC Commands (Tauri)

```rust
// Terminal
#[tauri::command] fn spawn_terminal(shell: String, cwd: String) -> TerminalId
#[tauri::command] fn write_terminal(id: TerminalId, data: String)
#[tauri::command] fn resize_terminal(id: TerminalId, cols: u16, rows: u16)
#[tauri::command] fn kill_terminal(id: TerminalId)

// Git
#[tauri::command] fn get_status(repo_path: String) -> GitStatus
#[tauri::command] fn get_diff(repo_path: String) -> Vec<FileDiff>
#[tauri::command] fn commit(repo_path: String, message: String)
#[tauri::command] fn get_branches(repo_path: String) -> Vec<Branch>
#[tauri::command] fn checkout_branch(repo_path: String, branch: String)
#[tauri::command] fn get_history(repo_path: String, limit: u32) -> Vec<Commit>
#[tauri::command] fn discard_file(repo_path: String, file_path: String)
#[tauri::command] fn discard_lines(repo_path: String, file_path: String, lines: Vec<u32>)

// AI
#[tauri::command] fn summarize_diff(diff: String) -> AISummary
#[tauri::command] fn generate_commit_message(summaries: Vec<String>) -> String
#[tauri::command] fn suggest_snippets(repo_path: String) -> Vec<Snippet>
```

### AI Integration Points

| Feature | Implementation |
|---------|----------------|
| Diff summaries | Send diff to AI API, cache results per file hash |
| Commit message generation | Aggregate file summaries, generate message |
| Discard by intent | Pass user request + diff to coding assistant via terminal |
| Voice-to-command | System dictation → AI API → terminal input |
| Snippet suggestions | Analyze project files (package.json, Makefile, etc.) on project open |

### Data Storage

| Data | Storage |
|------|---------|
| Project list | SQLite (via rusqlite) |
| Git credentials | System keychain (keyring crate) |
| Assistant default args | JSON config file |
| Snippets | JSON file per project + global config |
| Theme / settings | Tauri's app config directory |

---

## Development

### Prerequisites

- Node.js 18+
- pnpm
- Rust toolchain
- Xcode Command Line Tools (macOS)

### Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev
```

### Building & Releasing

Chell uses platform-specific build scripts with automatic version bumping and Cloudflare R2 for hosting updates.

#### Build Scripts

```bash
# Build without version bump
./scripts/build-macos.sh
./scripts/build-linux.sh

# Build with version bump (patch: 0.1.0 → 0.1.1)
./scripts/build-macos.sh patch

# Build with minor bump (0.1.0 → 0.2.0)
./scripts/build-macos.sh minor

# Build with major bump (0.1.0 → 1.0.0)
./scripts/build-macos.sh major
```

Windows (PowerShell):
```powershell
.\scripts\build-windows.ps1
.\scripts\build-windows.ps1 -BumpType patch
```

#### Uploading Releases

After building, upload artifacts to Cloudflare R2:

```bash
./scripts/upload-to-cloudflare.sh
```

This uploads:
- macOS: `.dmg` and `.app.tar.gz`
- Linux: `.AppImage` and `.deb`
- Windows: `.msi` and `.exe`

And generates `latest.json` for the auto-updater.

#### Full Release Workflow

```bash
# 1. Bump version and build
./scripts/build-macos.sh patch

# 2. Upload to Cloudflare
./scripts/upload-to-cloudflare.sh
```

#### Environment Variables

Create `.env.local` from the example:

```bash
cp .env.local.example .env.local
```

Required variables:
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` - macOS notarization
- `TAURI_SIGNING_PRIVATE_KEY` - Update signing
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_SECRET_KEY` - R2 uploads

#### Auto-Updates

The app checks for updates at `https://releases.chell.app/latest.json` on startup. Users are prompted to download and install new versions.

---

## Future Scope

### Mobile Companion App (v2+)

A lightweight mobile app for on-the-go git management:

- View project status and AI-summarized changes
- Commit, push, pull operations
- Branch management
- Review commit history
- **No local terminal**—coding assistants require connection to a remote dev environment (SSH, Codespaces, etc.)

Could be built with:
- Tauri Mobile (experimental)
- React Native
- Flutter (standalone app)

---

## Branding & Visual Direction

**Primary Inspiration:** GitHub Desktop—clean, minimal, functional. Easy to use without feeling sterile.

**Secondary Inspiration:** Portal (video game)—subtle thematic touches:
- Orange/blue accent colors (portal colors)
- Aperture Science-inspired iconography (optional, subtle)
- Terminal could have faint "test chamber" aesthetic
- Loading states or empty states could reference GLaDOS/Portal humor

**Design Principles:**
- Clean and uncluttered—git complexity is hidden, not the UI
- High contrast for readability (terminal text, diff views)
- Dark mode first (developers), light mode supported
- Consistent with native OS conventions (window chrome, menus)

---

## Design System

### Color Palette

**Dark Theme (Primary)**

| Token | HSL Value | Hex | Usage |
|-------|-----------|-----|-------|
| `--background` | `0 0% 7%` | `#121212` | App background |
| `--foreground` | `0 0% 90%` | `#E5E5E5` | Primary text |
| `--card` | `0 0% 9%` | `#171717` | Cards, panels, sidebars |
| `--muted` | `0 0% 15%` | `#262626` | Subtle backgrounds, hover states |
| `--muted-foreground` | `0 0% 55%` | `#8C8C8C` | Secondary text, labels |
| `--border` | `0 0% 18%` | `#2E2E2E` | Borders, dividers |
| `--primary` | `24 100% 50%` | `#FF6B00` | Portal Orange - primary actions |
| `--destructive` | `0 62.8% 50%` | `#CC3333` | Delete, discard actions |

**Accent Colors**

| Name | Value | Usage |
|------|-------|-------|
| Portal Orange | `#FF6B00` | Primary buttons, active states, highlights |
| Portal Blue | `#00A4D6` | Secondary accent (sparingly) |
| Green | `#22C55E` | Added files, success states |
| Red | `#EF4444` | Deleted files, errors |

**Terminal Background:** `#0D0D0D` — Slightly darker than the card background for visual separation.

### Typography

**Font Stack:**
- UI: System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
- Monospace: `"SF Mono", "Menlo", "Monaco", "Consolas", monospace`

**Scale:**

| Size | Class | Usage |
|------|-------|-------|
| 11px | `text-[11px]` | Labels, timestamps, section headers |
| 12px | `text-xs` | Secondary info, file paths |
| 14px | `text-sm` | Body text, list items |
| 16px | `text-base` | Page titles |
| 20px | `text-xl` | Hero headings (empty states) |

**Section Headers:** Always uppercase, tracking-wider, muted-foreground color.
```jsx
<h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
  Unstaged Changes
</h3>
```

### Spacing & Layout

**Standard Padding:**
- Page padding: `px-6 py-4`
- Card/panel padding: `p-4`
- Compact items: `px-3 py-2` or `px-2 py-1.5`

**Border Radius:**
- Buttons, inputs: `rounded-md` (6px)
- Cards, panels: `rounded-lg` (8px)
- Icons in containers: `rounded-lg` (8px)
- Hero icons: `rounded-2xl` (16px)

**Gaps:**
- Tight: `gap-1` or `gap-1.5`
- Normal: `gap-2` or `gap-3`
- Spacious: `gap-4` or `gap-6`

### Component Patterns

#### Action Cards (Empty State)
Used for primary actions in empty states:

```jsx
<button className="group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-portal-orange/50 hover:bg-muted/50">
  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
    <Icon className="h-5 w-5 text-muted-foreground group-hover:text-portal-orange" />
  </div>
  <div className="flex-1">
    <p className="text-sm font-medium">Primary action text</p>
    <p className="text-xs text-muted-foreground">Secondary description</p>
  </div>
  <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
</button>
```

#### List Items (Projects, Files)
Minimal padding, full-width clickable area:

```jsx
<button className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
  <Icon className="h-4 w-4 shrink-0 text-portal-orange" />
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-medium">{name}</p>
    <p className="truncate text-[11px] text-muted-foreground font-mono">{path}</p>
  </div>
  <span className="shrink-0 text-[11px] text-muted-foreground">{timestamp}</span>
</button>
```

#### File Status Indicators
Small colored squares indicating git status:

```jsx
<span className={cn(
  "h-2 w-2 shrink-0 rounded-sm",
  status === "added" && "bg-green-500",
  status === "deleted" && "bg-red-500",
  status === "modified" && "bg-portal-orange"
)} />
```

#### Primary Buttons
Orange background for primary actions:

```jsx
<Button className="bg-portal-orange hover:bg-portal-orange/90 text-white font-medium">
  Commit to main
</Button>
```

#### Ghost Buttons with Loading
For regenerate/refresh actions:

```jsx
<Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-foreground">
  <Sparkles className="mr-1.5 h-3 w-3" />
  {isLoading ? "Generating..." : "Regenerate with AI"}
</Button>
```

#### App Logo
The Chell logo uses a gradient background with the GitBranch icon. Use consistently in headers and hero sections:

```jsx
// Header size (40px)
<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-portal-orange/20 to-orange-600/20 border border-portal-orange/30">
  <GitBranch className="h-5 w-5 text-portal-orange" />
</div>

// Clickable header logo (e.g., home navigation)
<button className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-portal-orange/20 to-orange-600/20 border border-portal-orange/30 transition-all hover:from-portal-orange/30 hover:to-orange-600/30">
  <GitBranch className="h-4 w-4 text-portal-orange" />
</button>
```

#### Hero Icons (Empty States)
Large centered icon with gradient background:

```jsx
<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-portal-orange/20 to-orange-600/20 border border-portal-orange/30">
  <GitBranch className="h-8 w-8 text-portal-orange" />
</div>
```

### Icon Sizes

| Context | Size | Class |
|---------|------|-------|
| Inline with text | 12-14px | `h-3 w-3` or `h-3.5 w-3.5` |
| List item icons | 16px | `h-4 w-4` |
| Button icons | 14-16px | `h-3.5 w-3.5` or `h-4 w-4` |
| Panel headers | 16px | `h-4 w-4` |
| Empty state icons | 24-32px | `h-6 w-6` or `h-8 w-8` |
| Hero icons | 32px | `h-8 w-8` |

### Borders & Dividers

- Use `border-border` for all borders (maps to `#2E2E2E` in dark mode)
- Section dividers: `border-b border-border`
- Card borders: `border border-border`
- Highlight on hover: `hover:border-portal-orange/50`

### Interactive States

**Hover:**
- Backgrounds: `hover:bg-muted/50`
- Borders: `hover:border-portal-orange/50`
- Text: `hover:text-foreground` (from muted-foreground)
- Icons: `group-hover:text-portal-orange`

**Active/Selected:**
- Tab underline: `border-b-2 border-portal-orange`
- Text: `text-foreground` (not muted)

**Disabled:**
- Opacity: `disabled:opacity-50`
- Cursor: `disabled:cursor-not-allowed`

**Loading:**
- Spinner: `<Loader2 className="animate-spin" />`
- Text: "Loading...", "Generating...", "Committing..."

### Animation Guidelines

- Keep animations subtle and fast
- Use `transition-colors` for background/text changes
- Use `transition-opacity` for fade effects
- Use `transition-all` sparingly (only when multiple properties change)
- Spinners: `animate-spin` on Loader2 or RefreshCw icons

### Tailwind Config Reference

```js
// tailwind.config.js
colors: {
  'portal-orange': '#FF6B00',
  'portal-blue': '#00A4D6',
}
```

### Do's and Don'ts

**Do:**
- Use the orange accent sparingly—it should draw attention to primary actions
- Keep text sizes small (11-14px) for information density
- Use monospace font for file paths and code
- Truncate long text with `truncate` class
- Use `shrink-0` on icons to prevent squishing
- Group related items visually with subtle backgrounds

**Don't:**
- Don't use blue as a primary action color (reserve for secondary accents)
- Don't use borders everywhere—prefer subtle background changes
- Don't make interactive elements too small (minimum 32px touch targets)
- Don't use pure white (`#FFFFFF`) in dark mode—use `foreground` token
- Don't add shadows in dark mode—they don't read well
- Don't use emojis in the UI

---

## AI Provider Configuration

**Approach:** BYOK (Bring Your Own Key)

Users configure their preferred AI provider in settings. No default provider—user must add at least one key for AI features to work.

**Supported Providers:**

| Provider | Model Examples |
|----------|----------------|
| Anthropic | Claude 3.5 Sonnet, Claude 3 Opus |
| OpenAI | GPT-4o, GPT-4 Turbo |
| Groq | Llama 3, Mixtral (fast inference) |
| Grok (xAI) | Grok-1 |
| Local/Custom | Any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, etc.) |

**Settings UI:**
- Provider selector dropdown
- API key input (stored in system keychain)
- Model selector (per provider)
- Custom endpoint URL (for local/self-hosted)
- Test connection button

**Fallback Behavior:**
- If no API key configured: AI features disabled, raw diff view shown
- If API call fails: Toast notification, fall back to raw diff
- Voice input without AI: Raw dictation typed into terminal

---

## License

**MIT** — Fully open source. Community contributions welcome.