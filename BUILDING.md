# Building Orca

This document covers how to build Orca locally and how the CI/CD release process works.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Rust](https://rustup.rs/) 1.88+

### Platform-specific dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt-get update
sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libgtk-3-dev \
    libsoup-3.0-dev \
    xdg-utils
```

**Windows:**
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with C++ workload
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 10/11)

## Local Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev
```

## Building Locally

### macOS

```bash
./scripts/build-macos.sh
```

Outputs:
- `src-tauri/target/release/bundle/dmg/*.dmg`
- `src-tauri/target/release/bundle/macos/*.app`

Requires these environment variables in `.env.local` for signing and notarization:
```
APPLE_ID=your-apple-id@example.com
APPLE_PASSWORD=app-specific-password
APPLE_TEAM_ID=XXXXXXXXXX
TAURI_SIGNING_PRIVATE_KEY=your-private-key
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-password
```

### Linux (via Docker)

Build from macOS or any machine with Docker:

```bash
./scripts/build-linux-docker.sh
```

Outputs:
- `src-tauri/target/release/bundle/deb/*.deb` - Debian/Ubuntu package
- `src-tauri/target/release/bundle/appimage/*.AppImage` - Portable executable
- `src-tauri/target/release/bundle/rpm/*.rpm` - Fedora/RHEL package

Note: Building via Docker on Apple Silicon produces `aarch64` binaries. For `x86_64` binaries, use CI or build on an x86_64 machine.

### Linux (native)

On a Linux machine:

```bash
./scripts/build-linux.sh
```

### Windows

```powershell
.\scripts\build-windows.ps1
```

Outputs:
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*.exe`

## CI/CD Workflow

The GitHub Actions workflow (`.github/workflows/build.yml`) automates building for all platforms.

### When does it run?

| Trigger | What happens |
|---------|--------------|
| Push tag `v*` | Builds all platforms, creates GitHub Release, uploads to Cloudflare R2 |
| Manual dispatch | Builds all platforms, optionally uploads to R2 |

**Regular commits do not trigger builds.**

### Build matrix

| Platform | Architectures | Runners | Outputs |
|----------|---------------|---------|---------|
| Linux | x86_64, aarch64 | ubuntu-22.04, ubuntu-22.04-arm | .deb, .rpm, .AppImage |
| macOS | x86_64, aarch64 | macos-13, macos-14 | .dmg, .app.tar.gz |
| Windows | x86_64 | windows-latest | .msi, .exe |

### Required secrets

Configure these in GitHub → Settings → Secrets → Actions:

| Secret | Purpose |
|--------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | Signs update bundles for auto-updates |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for signing key |
| `APPLE_ID` | macOS notarization |
| `APPLE_PASSWORD` | macOS notarization (app-specific password) |
| `APPLE_TEAM_ID` | macOS notarization |
| `CLOUDFLARE_ACCOUNT_ID` | R2 upload |
| `CLOUDFLARE_R2_ACCESS_KEY` | R2 upload |
| `CLOUDFLARE_R2_SECRET_KEY` | R2 upload |
| `CLOUDFLARE_R2_BUCKET` | R2 bucket name |

### Downloading build artifacts

After a workflow run:

1. Go to **Actions** → select the workflow run
2. Scroll to the **Artifacts** section at the bottom
3. Download the platform-specific artifact (e.g., `linux-deb-x86_64`)

Artifacts are retained for 90 days.

## Releasing a New Version

### 1. Bump version

```bash
./scripts/bump-version.sh patch  # or minor, major
```

This updates the version in:
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

### 2. Commit and tag

```bash
git add -A
git commit -m "Bump version to X.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

### 3. Wait for CI

The workflow will:
1. Build for all platforms (Linux x86_64/arm64, macOS x86_64/arm64, Windows)
2. Sign all update bundles
3. Create a **draft** GitHub Release with all artifacts
4. Upload to Cloudflare R2
5. Update `latest.json` for auto-updates

### 4. Publish the release

1. Go to **Releases** on GitHub
2. Edit the draft release
3. Review release notes
4. Click **Publish release**

## Auto-Updates

Orca uses Tauri's built-in updater. The update flow:

1. App checks `https://releases.chell.app/latest.json` on startup
2. If a newer version exists, user is prompted to update
3. App downloads the appropriate bundle:
   - macOS: `.app.tar.gz`
   - Linux: `.AppImage`
   - Windows: `.msi`
4. Bundle signature is verified against the public key
5. App restarts with the new version

### Update bundle formats

| Platform | Initial Install | Auto-Update Bundle |
|----------|----------------|-------------------|
| macOS | `.dmg` | `.app.tar.gz` |
| Linux | `.deb` or `.AppImage` | `.AppImage` |
| Windows | `.msi` or `.exe` | `.msi` |

Note: Linux users who installed via `.deb` will receive updates via AppImage. The `.deb` is for initial installation only.

## Generating Signing Keys

If you need to generate new Tauri signing keys:

```bash
pnpm tauri signer generate -w ~/.tauri/orca.key
```

This outputs:
- Private key (keep secret, add to `.env.local` and GitHub Secrets)
- Public key (add to `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`)
