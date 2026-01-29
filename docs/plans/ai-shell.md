# AI-Powered Shell Panel

## Overview

Add an AI assistant to the shell panel via a dedicated input bar:
1. **Natural language to command translation** - "run this project" → `npm run dev`
2. **Context-aware** - understands project type (Node, Rust, Python, etc.)
3. **Safe execution** - preview command before running, with Edit/Execute/Cancel options
4. **Error recovery** (optional) - "Command failed, ask AI for help?"

## Architecture: Smart Input Bar (Simplified)

Separate AI input field above the terminal. No xterm.js hacking required.

```
┌─────────────────────────────────────────────────┐
│ 🤖 Ask AI...                    [⏎]  [Hide]    │  ← AI input bar
├─────────────────────────────────────────────────┤
│ $ npm run dev                                   │  ← regular terminal
│ > vite v5.0.0                                   │
│ Local: http://localhost:5173                    │
└─────────────────────────────────────────────────┘
```

### User Flow

1. User types natural language: **"run the dev server"**
2. Press Enter → shows loading spinner
3. AI returns command, show preview:
   ```
   ┌─────────────────────────────────────────────┐
   │ 🤖 npm run dev                              │
   │    [Execute]  [Edit]  [Copy]  [Cancel]      │
   └─────────────────────────────────────────────┘
   ```
4. Click **Execute** → command injected into terminal PTY
5. Terminal runs command normally

### UI Components

**AI Input Bar:**
- Text input with placeholder "Ask AI to run a command..."
- Enter to submit, Escape to clear
- Up/down arrows for AI command history
- Loading spinner while waiting for AI
- Toggle button to hide bar (remember preference)

**Command Preview:**
- Shows the generated command in a code block
- Action buttons: Execute (primary), Edit, Copy, Cancel
- Edit opens inline editor to modify before executing
- Keyboard shortcuts: Enter=Execute, E=Edit, Esc=Cancel

**Quick Actions (optional, phase 2):**
- Chips/buttons for common commands: [Run] [Test] [Build] [Install]
- Contextual based on project type
- Click to auto-fill AI input or execute directly

**Error Recovery (optional, phase 3):**
- Detect non-zero exit codes from terminal
- Show "Command failed. Ask AI to help?" prompt
- AI can analyze error output and suggest fix

---

## AI Provider: Groq (Existing)

We already have Groq integration for AI commit messages. Reuse this for the shell.

**Current Setup:**
- **API:** `https://api.groq.com/openai/v1/chat/completions`
- **Model:** `llama-3.1-8b-instant` (very fast, good for completions)
- **Existing code:** `src-tauri/src/lib.rs` - `generate_commit_message` command

**Why Groq works well:**
- Already integrated and working
- Llama 3.1 8B is fast (~100ms responses)
- Free tier is generous (14,400 requests/day)
- OpenAI-compatible API format

**Backend Approach:**
Create a generic `ai_complete` Tauri command that can be reused:

```rust
#[tauri::command]
async fn ai_complete(
    prompt: String,
    system_prompt: Option<String>,
    api_key: String,
) -> Result<String, String> {
    // Reuse existing Groq structs
    let client = reqwest::Client::new();
    let messages = match system_prompt {
        Some(sys) => vec![
            GroqMessage { role: "system".into(), content: sys },
            GroqMessage { role: "user".into(), content: prompt },
        ],
        None => vec![
            GroqMessage { role: "user".into(), content: prompt },
        ],
    };

    let request = GroqRequest {
        model: "llama-3.1-8b-instant".to_string(),
        messages,
        temperature: 0.1,  // Low for deterministic completions
        max_tokens: 100,
    };
    // ... send request
}
```

---

## Context System

The AI needs context to make good suggestions:

### Project Context (read once on load)
```typescript
interface ProjectContext {
  type: 'node' | 'rust' | 'python' | 'go' | 'unknown';
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  scripts?: Record<string, string>;  // from package.json
  hasDocker: boolean;
  hasMakefile: boolean;
  gitBranches?: string[];
}
```

### Session Context (updated continuously)
```typescript
interface SessionContext {
  cwd: string;
  recentCommands: string[];      // last 10 commands
  lastCommandOutput?: string;    // for error correction
  lastExitCode?: number;
}
```

### Building Context
1. On project load: scan for package.json, Cargo.toml, pyproject.toml, etc.
2. Parse scripts/commands from config files
3. Track command history within session
4. Capture exit codes to detect failures

---

## Implementation Plan

### Phase 1: Core AI Shell (MVP)
- [ ] Add `ai_shell_command` Tauri command (reuse Groq structs)
- [ ] Add `scan_project_context` Tauri command
- [ ] Create `SmartShell.tsx` component (AI input bar + Terminal)
- [ ] Create `CommandPreview.tsx` component
- [ ] Wire up Execute button to write command to PTY
- [ ] Basic prompt template for command translation

### Phase 2: Polish & UX
- [ ] Add loading state with spinner
- [ ] Add Edit button (inline edit before execute)
- [ ] Add Copy button
- [ ] AI input history (up/down arrows)
- [ ] Toggle to hide/show AI bar
- [ ] Keyboard shortcuts (Enter=Execute, Esc=Cancel)

### Phase 3: Quick Actions (Optional)
- [ ] Add quick action chips: [Run] [Test] [Build] [Install]
- [ ] Auto-detect available actions from project context
- [ ] One-click execution for common commands

### Phase 4: Error Recovery (Optional)
- [ ] Track last command exit code
- [ ] Detect failures and show "Ask AI for help?" prompt
- [ ] AI analyzes error output and suggests fix

---

## Technical Details

### Executing Commands in Terminal

To inject a command into the terminal PTY:

```typescript
// In SmartShell.tsx - parent has access to terminalId
const executeCommand = async (command: string) => {
  // Write command to PTY (appears in terminal)
  await invoke("write_terminal", { id: terminalId, data: command });
  // Send Enter key to execute
  await invoke("write_terminal", { id: terminalId, data: "\r" });
};
```

### AI Prompt Template

```typescript
const buildPrompt = (userRequest: string, context: ProjectContext) => `
You are a terminal command assistant. Convert the user's request into a shell command.

Project: ${context.type} (${context.packageManager || 'unknown package manager'})
${context.scripts ? `Available scripts: ${Object.keys(context.scripts).join(', ')}` : ''}
Current directory: ${context.cwd}

User request: "${userRequest}"

Respond with ONLY the shell command. No explanation, no markdown, no code blocks.
`;
```

### SmartShell Component Structure

```tsx
function SmartShell({ cwd, terminalId }: Props) {
  const [aiInput, setAiInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsLoading(true);
    const command = await invoke("ai_shell_command", {
      request: aiInput,
      cwd,
      apiKey: GROQ_API_KEY
    });
    setPreview(command);
    setIsLoading(false);
  };

  const handleExecute = () => {
    invoke("write_terminal", { id: terminalId, data: preview + "\r" });
    setPreview(null);
    setAiInput("");
  };

  return (
    <div className="flex flex-col h-full">
      {/* AI Input Bar */}
      <div className="p-2 border-b">
        <input value={aiInput} onChange={...} onKeyDown={...} />
        {preview && <CommandPreview command={preview} onExecute={handleExecute} />}
      </div>
      {/* Terminal */}
      <Terminal id={terminalId} cwd={cwd} />
    </div>
  );
}
```

---

## API Cost Estimation

**Groq Free Tier:**
- 14,400 requests/day (10 req/min)
- No cost for most users

**Groq Paid (if needed):**
- Llama 3.1 8B: $0.05/1M tokens
- Average request: ~200 tokens = $0.00001
- Essentially free even at scale

---

## Settings UI

```typescript
interface AIShellSettings {
  enabled: boolean;
  apiKey?: string;  // stored securely, defaults to built-in key
  model: string;
  features: {
    naturalLanguage: boolean;
    autoComplete: boolean;
    errorCorrection: boolean;
  };
  naturalLanguagePrefix: '/' | '?' | 'ai:';
  completionDelay: number;  // ms before requesting completion
}
```

---

## File Structure

```
src/
  components/
    SmartShell.tsx          # AI input bar + Terminal wrapper
    CommandPreview.tsx      # Shows command with Execute/Edit/Cancel buttons

src-tauri/
  src/
    lib.rs                  # Add ai_shell_command and scan_project_context commands
```

Just 2 new frontend files and 2 new Tauri commands.

---

## Open Questions

1. **Dangerous command warnings?**
   - Warn before executing `rm -rf`, `sudo`, `git push --force`, etc.
   - Show in red/orange with extra confirmation step

2. **AI bar visibility default?**
   - Show by default (discoverable) or hidden (less clutter)?
   - Remember user's preference in settings

---

## Success Metrics

- [ ] Natural language commands work >90% of the time
- [ ] AI response latency <500ms
- [ ] Command preview is clear and not confusing
- [ ] Zero accidental destructive commands
