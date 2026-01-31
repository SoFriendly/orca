# Chell Portal Relay - Cloudflare Worker

A Cloudflare Worker that acts as a WebSocket relay between Chell Desktop and Chell Portal mobile apps. It handles secure pairing, session management, and message forwarding using Durable Objects for persistent state.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Network                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Chell Relay Worker                      │  │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐   │  │
│  │  │   HTTP Router   │───►│     Durable Object          │   │  │
│  │  │  /ws, /health   │    │      (SessionDO)            │   │  │
│  │  └─────────────────┘    │                             │   │  │
│  │                         │  ┌─────────────────────┐    │   │  │
│  │                         │  │  Session Store      │    │   │  │
│  │                         │  │  - Pairing state    │    │   │  │
│  │                         │  │  - Device registry  │    │   │  │
│  │                         │  │  - Connection map   │    │   │  │
│  │                         │  └─────────────────────┘    │   │  │
│  │                         │                             │   │  │
│  │                         │  WebSocket Connections:     │   │  │
│  │                         │  - Desktop ◄──────► Mobile  │   │  │
│  │                         │  - Desktop ◄──────► Mobile  │   │  │
│  │                         └─────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
           ▲                                          ▲
           │ WSS                                      │ WSS
           │                                          │
    ┌──────┴──────┐                           ┌──────┴──────┐
    │   Desktop   │                           │   Mobile    │
    │   (Tauri)   │                           │(React Native)│
    └─────────────┘                           └─────────────┘
```

## Features

- **Secure Pairing**: 6-word passphrase-based pairing (millions of combinations)
- **Session Persistence**: Durable Objects maintain state across requests
- **Multi-Device**: One desktop can have multiple mobile devices connected
- **Message Relay**: Bidirectional forwarding of commands and responses
- **Terminal Streaming**: Real-time terminal I/O between desktop and mobile
- **Status Sync**: Theme and connection status synchronization

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 3+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

## Setup

### 1. Install Wrangler

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

This opens a browser for OAuth authentication.

### 3. Install Dependencies

```bash
cd workers/relay
npm install
```

### 4. Create KV Namespace

The relay uses KV for device registry storage:

```bash
# Create production KV namespace
wrangler kv:namespace create "DEVICES"

# Create preview KV namespace (for local dev)
wrangler kv:namespace create "DEVICES" --preview
```

This outputs namespace IDs. Copy them.

### 5. Update wrangler.toml

Edit `wrangler.toml` with your KV namespace IDs:

```toml
name = "chell-relay"
main = "src/index.ts"
compatibility_date = "2024-11-01"

# Durable Objects for session management
[[durable_objects.bindings]]
name = "SESSIONS"
class_name = "SessionDO"

[[migrations]]
tag = "v1"
new_classes = ["SessionDO"]

# KV for device registry - UPDATE THESE
[[kv_namespaces]]
binding = "DEVICES"
id = "your-production-kv-id-here"           # From step 4
preview_id = "your-preview-kv-id-here"      # From step 4

[vars]
ENVIRONMENT = "production"
```

### 6. Deploy

```bash
# Deploy to Cloudflare
wrangler deploy

# Or deploy to a specific environment
wrangler deploy --env production
```

After deployment, you'll get a URL like:
```
https://chell-relay.your-subdomain.workers.dev
```

### 7. Verify Deployment

```bash
# Health check
curl https://chell-relay.your-subdomain.workers.dev/health

# Expected response:
# {"status":"ok","version":"1.0.0","environment":"production"}
```

## Local Development

```bash
# Start local dev server with Durable Objects
wrangler dev

# The worker runs at http://localhost:8787
# WebSocket endpoint: ws://localhost:8787/ws
```

For local testing, update the mobile app's relay URL to `ws://YOUR_LOCAL_IP:8787`.

## Message Protocol

All messages are JSON with a common structure:

```typescript
interface BaseMessage {
  type: string;
  id: string;       // Unique message ID
  timestamp: number; // Unix timestamp in ms
}
```

### Desktop → Relay

| Message Type | Description | Payload |
|-------------|-------------|---------|
| `register_desktop` | Register desktop for pairing | `deviceName`, `pairingCode`, `pairingPassphrase` |
| `command_response` | Response to mobile command | `requestId`, `success`, `result`, `error` |
| `terminal_output` | Terminal output stream | `terminalId`, `data` |
| `status_update` | Status/theme update | `connectionStatus`, `theme`, `customTheme` |
| `unpair` | Remove a linked device | `deviceId` |

### Mobile → Relay

| Message Type | Description | Payload |
|-------------|-------------|---------|
| `register_mobile` | Pair with desktop | `deviceName`, `pairingPassphrase` |
| `command` | Execute desktop command | `sessionToken`, `command`, `params` |
| `terminal_input` | Send terminal input | `sessionToken`, `terminalId`, `data` |
| `request_status` | Request current status | `sessionToken` |
| `ping` | Keep-alive ping | - |

### Relay → Desktop

| Message Type | Description |
|-------------|-------------|
| `register_desktop_response` | Confirmation of registration |
| `device_list` | List of linked mobile devices |
| `command` | Forwarded command from mobile |
| `terminal_input` | Forwarded terminal input |
| `request_status` | Request status update |

### Relay → Mobile

| Message Type | Description |
|-------------|-------------|
| `pair_response` | Pairing success with session token |
| `command_response` | Response from desktop |
| `terminal_output` | Terminal output stream |
| `status_update` | Desktop status/theme |
| `error` | Error message |
| `pong` | Response to ping |

## Pairing Flow

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│   Desktop   │          │    Relay    │          │   Mobile    │
└──────┬──────┘          └──────┬──────┘          └──────┬──────┘
       │                        │                        │
       │  register_desktop      │                        │
       │  passphrase: "apple-   │                        │
       │  banana-cherry-..."    │                        │
       │───────────────────────►│                        │
       │                        │                        │
       │  register_desktop_     │                        │
       │  response {success}    │                        │
       │◄───────────────────────│                        │
       │                        │                        │
       │                        │  register_mobile       │
       │                        │  passphrase: "apple-   │
       │                        │  banana-cherry-..."    │
       │                        │◄───────────────────────│
       │                        │                        │
       │                        │  Validate passphrase   │
       │                        │  Generate session token│
       │                        │                        │
       │  device_list           │  pair_response         │
       │  [new device added]    │  {sessionToken}        │
       │◄───────────────────────│───────────────────────►│
       │                        │                        │
       │  request_status        │                        │
       │◄───────────────────────│                        │
       │                        │                        │
       │  status_update         │                        │
       │  {theme, ...}          │                        │
       │───────────────────────►│───────────────────────►│
       │                        │                        │
```

## Command Execution Flow

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│   Mobile    │          │    Relay    │          │   Desktop   │
└──────┬──────┘          └──────┬──────┘          └──────┬──────┘
       │                        │                        │
       │  command               │                        │
       │  {git_status, path}    │                        │
       │───────────────────────►│                        │
       │                        │                        │
       │                        │  command               │
       │                        │  {git_status, path}    │
       │                        │───────────────────────►│
       │                        │                        │
       │                        │    Tauri invoke()      │
       │                        │    Execute command     │
       │                        │                        │
       │                        │  command_response      │
       │                        │  {staged, unstaged..}  │
       │                        │◄───────────────────────│
       │                        │                        │
       │  command_response      │                        │
       │  {staged, unstaged..}  │                        │
       │◄───────────────────────│                        │
       │                        │                        │
```

## File Structure

```
workers/relay/
├── src/
│   ├── index.ts       # Worker entry point, HTTP router
│   ├── session.ts     # SessionDO Durable Object class
│   ├── crypto.ts      # Token/passphrase generation
│   └── types.ts       # TypeScript type definitions
├── wrangler.toml      # Cloudflare Worker configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Security Considerations

- **Passphrase Entropy**: 6 words from a 64-word list = ~36 bits of entropy
- **Session Tokens**: SHA-256 hash of desktop ID + mobile ID + passphrase
- **No Persistent Storage**: Commands/data are forwarded, not stored
- **WSS Only**: All production traffic uses TLS
- **Rate Limiting**: Cloudflare's built-in DDoS protection applies

For enhanced security, consider:
- Adding custom rate limiting per IP/device
- Implementing passphrase expiry (e.g., 5 minutes)
- Adding IP allowlisting for enterprise deployments

## Scaling

The current setup uses a single global Durable Object. For production scale:

1. **Regional Sharding**: Route users to regional DOs based on location
2. **User Sharding**: Create separate DOs per desktop device
3. **Hibernation**: Durable Objects automatically hibernate when idle

Example user-sharded approach:
```typescript
// In index.ts
if (url.pathname === "/ws") {
  const deviceId = url.searchParams.get("deviceId") || "global";
  const id = env.SESSIONS.idFromName(deviceId);
  const stub = env.SESSIONS.get(id);
  return stub.fetch(request);
}
```

## Monitoring

View logs in real-time:

```bash
wrangler tail
```

Or use Cloudflare Dashboard → Workers → chell-relay → Logs.

## Troubleshooting

### "Expected WebSocket" error
The client is making an HTTP request instead of a WebSocket upgrade. Ensure:
- Client uses `wss://` protocol
- Headers include `Upgrade: websocket`

### Durable Object not found
Run the migration:
```bash
wrangler deploy
```

Migrations in `wrangler.toml` are applied on deploy.

### KV namespace errors
Verify KV namespace IDs in `wrangler.toml` match your account.

### WebSocket disconnects frequently
- Check Cloudflare's 100-second idle timeout
- Implement ping/pong heartbeat (every 30s recommended)

## Cost Estimation

Cloudflare Workers pricing (as of 2024):

| Resource | Free Tier | Paid ($5/mo) |
|----------|-----------|--------------|
| Requests | 100K/day | 10M/mo |
| Durable Objects | 10K reads, 1K writes/day | Included |
| KV | 100K reads, 1K writes/day | Included |

For a personal project with a few devices, the free tier is sufficient.

## Updating the Desktop App

After deploying your relay, update the desktop app to use your URL:

1. Edit `src/stores/portalStore.ts`
2. Change the default `relayUrl`:
```typescript
relayUrl: "wss://chell-relay.your-subdomain.workers.dev",
```

Or let users configure it in Settings → Remote Portal.
