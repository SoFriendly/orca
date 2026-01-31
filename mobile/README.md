# Chell Portal - Mobile App

A React Native mobile app that acts as a remote portal to control your Chell desktop application. It provides the same functionality as the desktop app (Git operations, AI assistants, terminal) but relays all commands through a secure WebSocket connection.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Mobile App     │◄──────►│ Cloudflare Worker │◄──────►│  Desktop App    │
│  (React Native) │  WSS   │  (Relay Server)   │  WSS   │  (Tauri)        │
└─────────────────┘         └──────────────────┘         └─────────────────┘
```

The mobile app doesn't run any commands locally. Instead:
1. User performs an action (e.g., stage a file, run a command)
2. Mobile app sends a message via WebSocket to the Cloudflare relay
3. Relay forwards the message to the connected desktop app
4. Desktop app executes the command and sends the result back
5. Mobile app displays the result

## Features

- **Git Panel**: View status, stage/unstage files, view diffs, commit, pull, push, switch branches
- **Terminal**: Remote shell with command history, Ctrl+C, Tab completion
- **AI Assistant**: Launch Claude Code, Aider, OpenCode, or shell; Smart Shell for natural language commands
- **Theme Sync**: Automatically matches your desktop theme (Dark, Tokyo Night, Light, Custom)
- **Multi-Desktop**: Link multiple desktop machines and switch between them
- **Project Switching**: See all projects opened on desktop and switch between them from mobile

## Prerequisites

- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator (Mac) or Android Emulator, or Expo Go app on your phone
- A deployed Cloudflare Workers relay (see `/workers/relay/README.md`)

## Setup

### 1. Install Dependencies

```bash
cd mobile
npm install
```

### 2. Configure the Relay URL

The relay URL is configured in the app settings. By default, it points to `wss://chell-relay.workers.dev`. To use your own relay:

1. Deploy your Cloudflare Worker (see `/workers/relay/README.md`)
2. Open the app and go to Settings
3. The relay URL is stored in the connection store

Or modify the default in `stores/connectionStore.ts`:

```typescript
relayUrl: "wss://your-worker.your-subdomain.workers.dev",
```

### 3. Start the Development Server

```bash
# Start Expo
npx expo start

# Or for specific platforms
npx expo start --ios
npx expo start --android
```

### 4. Connect to Your Desktop

1. Open Chell on your desktop
2. Go to Settings > Remote Portal
3. Enable "Remote Portal"
4. A QR code will appear
5. On mobile, go to Settings tab and tap "Scan QR Code"
6. Scan the QR code to pair

**Note:** The desktop app runs in the background when you close the window (minimizes to system tray). Click the tray icon to reopen, or right-click for Show/Quit options.

## Project Structure

```
mobile/
├── app/                    # Expo Router screens
│   ├── (tabs)/            # Bottom tab navigator
│   │   ├── _layout.tsx    # Tab bar configuration
│   │   ├── index.tsx      # Git panel (default tab)
│   │   ├── terminal.tsx   # Remote terminal
│   │   ├── assistant.tsx  # AI assistants & Smart Shell
│   │   └── settings.tsx   # Connection & theme settings
│   ├── _layout.tsx        # Root layout with theme provider
│   └── connect.tsx        # QR code scanner modal
├── components/
│   ├── ui/                # Reusable UI components (shadcn-style)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── badge.tsx
│   │   ├── tabs.tsx
│   │   └── ...
│   └── ThemeProvider.tsx  # Theme context with NativeWind
├── stores/                # Zustand state management
│   ├── connectionStore.ts # WebSocket connection & pairing
│   ├── gitStore.ts        # Git operations (remote invocation)
│   ├── terminalStore.ts   # Terminal sessions & output
│   └── themeStore.ts      # Theme preferences & sync
├── lib/
│   ├── websocket.ts       # WebSocket client wrapper
│   └── utils.ts           # Utility functions
├── types/
│   └── index.ts           # TypeScript type definitions
├── global.css             # Tailwind/NativeWind styles & themes
├── app.json               # Expo configuration
├── tailwind.config.js     # Tailwind configuration
└── package.json
```

## How It Works

### Pairing Process

1. Desktop generates a 6-word passphrase and displays it as a QR code
2. Mobile scans the QR code which contains:
   ```json
   {
     "relayUrl": "wss://chell-relay.workers.dev",
     "pairingCode": "123456",
     "passphrase": "apple-banana-cherry-dragon-eagle-falcon"
   }
   ```
3. Mobile connects to the relay and sends a `pair_mobile` message
4. Relay validates the passphrase and establishes the session
5. Both devices receive confirmation and can now communicate

### Command Flow

**Git Operations:**
```typescript
// Mobile sends:
{
  type: "command",
  command: "git_status",
  params: { path: "/path/to/project" }
}

// Desktop receives, executes via Tauri, responds:
{
  type: "command_response",
  requestId: "...",
  success: true,
  result: { staged: [...], unstaged: [...], ... }
}
```

**Terminal I/O:**
```typescript
// Mobile sends input:
{ type: "terminal_input", terminalId: "...", data: "ls -la\n" }

// Desktop streams output:
{ type: "terminal_output", terminalId: "...", data: "total 48\ndrwxr-xr-x..." }
```

### Theme Synchronization

When `syncWithDesktop` is enabled:
1. Mobile sends `request_status` after connecting
2. Desktop responds with current theme (including custom theme colors if applicable)
3. Mobile applies the theme using NativeWind CSS classes
4. Custom themes convert HSL colors to hex for React Native compatibility

### Project Switching

The mobile app can see and switch between all projects opened on the desktop:

1. Desktop sends list of projects with each `status_update`
2. Mobile displays projects in Settings > Projects section
3. Tapping a project sends `select_project` message to desktop
4. Desktop opens/switches to that project tab
5. Desktop confirms with `project_changed` message

## UI Components

The app uses a custom component library styled after shadcn/ui:

| Component | Description |
|-----------|-------------|
| `Button` | Primary, outline, ghost, destructive variants |
| `Card` | Container with header, content, footer sections |
| `Badge` | Status indicators (success, warning, destructive) |
| `Tabs` | Segmented control for switching views |
| `Separator` | Visual divider |

All components support theming via CSS variables defined in `global.css`.

## Themes

Three built-in themes matching the desktop app:

| Theme | Background | Primary | Description |
|-------|------------|---------|-------------|
| Dark | #121212 | #FF6B00 (orange) | Default dark theme |
| Tokyo Night | #1a1b26 | #7aa2f7 (blue) | Inspired by Tokyo Night VSCode theme |
| Light | #ffffff | #FF6B00 (orange) | Light mode |

Custom themes are synced from desktop with full color palette support.

## Building for Production

### iOS

```bash
# Build for iOS
npx expo build:ios

# Or use EAS Build
npx eas build --platform ios
```

### Android

```bash
# Build for Android
npx expo build:android

# Or use EAS Build
npx eas build --platform android
```

## Troubleshooting

### "Not Connected" on all tabs
- Ensure your desktop has Remote Portal enabled in Settings
- Check that both devices are online
- Try re-scanning the QR code

### Terminal not showing output
- The terminal streams output from desktop - ensure the desktop shell is running
- Check the connection status in the header

### Theme not syncing
- Enable "Sync with Desktop" in mobile Settings
- The theme updates when the app receives a `status_update` message

### QR code not scanning
- Ensure camera permissions are granted
- The QR code should contain valid JSON with `relayUrl`, `pairingCode`, and `passphrase`

## Security

- All communication is over WSS (WebSocket Secure)
- Pairing requires a 6-word passphrase (62^6 combinations)
- Session tokens are randomly generated UUIDs
- No credentials are stored on the relay server
- The relay only forwards messages; it doesn't execute commands
