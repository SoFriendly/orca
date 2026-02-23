# Orca

A visual git client with an integrated terminal, designed for AI coding assistants.

Orca combines a simplified git interface with a full terminal environment, so you can run Claude Code, Aider, or any CLI-based coding assistant while keeping track of your changes.

## Features

- **Integrated terminal** — Run your preferred AI coding assistant alongside git
- **Simplified git** — No staging, stashing, or complex workflows. Just commit and push.
- **AI commit messages** — Automatically generate commit messages from your changes
- **Cross-platform** — macOS, Windows, and Linux

## Requirements

- **Git** — Must be installed and available in your PATH
  - macOS: `xcode-select --install` or `brew install git`
  - Linux: `sudo apt install git` or `sudo dnf install git`
  - Windows: [git-scm.com](https://git-scm.com/download/win)
- **AI coding assistant** (optional) — Claude Code, Aider, or any CLI-based assistant you want to use in the terminal

## Download

Get the latest release:

- **macOS:** [Orca.dmg](https://releases.chell.app/orca-latest.dmg)
- **Linux:** [AppImage](https://releases.chell.app/orca-latest.AppImage) | [.deb](https://releases.chell.app/orca-latest.deb)
- **Windows:** [Installer](https://releases.chell.app/orca-latest.exe) | [MSI](https://releases.chell.app/orca-latest.msi)

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

### Building

```bash
# macOS
./scripts/build-macos.sh

# Linux
./scripts/build-linux.sh

# Windows (PowerShell)
.\scripts\build-windows.ps1
```

Build with version bump:

```bash
./scripts/build-macos.sh patch   # 0.1.0 → 0.1.1
./scripts/build-macos.sh minor   # 0.1.0 → 0.2.0
./scripts/build-macos.sh major   # 0.1.0 → 1.0.0
```

### Environment Variables

Copy `.env.local.example` to `.env.local` and configure:

- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` — macOS notarization
- `TAURI_SIGNING_PRIVATE_KEY` — Update signing
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_SECRET_KEY` — Release uploads

## Tech Stack

- **Framework:** Tauri + Rust
- **Frontend:** React + TypeScript
- **UI:** shadcn/ui + Tailwind CSS
- **Terminal:** xterm.js
- **Git:** git2 (libgit2 bindings)

## License

MIT
