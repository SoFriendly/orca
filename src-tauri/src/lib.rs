use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
// use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
// use tauri::image::Image;
use tauri::menu::MenuItemBuilder;
use uuid::Uuid;

mod database;
mod git;
mod portal;

use database::Database;
use git::GitService;
use portal::Portal;

// Types for IPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFolder {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: String,
    pub folders: Option<Vec<ProjectFolder>>,
}

// Project file format for .orca files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFileData {
    pub version: u32,
    pub name: String,
    pub folders: Vec<ProjectFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub status: String,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    #[serde(rename = "oldStart")]
    pub old_start: u32,
    #[serde(rename = "oldLines")]
    pub old_lines: u32,
    #[serde(rename = "newStart")]
    pub new_start: u32,
    #[serde(rename = "newLines")]
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub line_type: String,
    pub content: String,
    #[serde(rename = "oldLineNo")]
    pub old_line_no: Option<u32>,
    #[serde(rename = "newLineNo")]
    pub new_line_no: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Branch {
    pub name: String,
    #[serde(rename = "isHead")]
    pub is_head: bool,
    #[serde(rename = "isRemote")]
    pub is_remote: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub id: String,
    #[serde(rename = "shortId")]
    pub short_id: String,
    pub message: String,
    pub author: String,
    #[serde(rename = "authorEmail")]
    pub author_email: String,
    pub timestamp: String,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    pub branch: Option<String>,
    #[serde(rename = "headSha")]
    pub head_sha: Option<String>,
    #[serde(rename = "isMain")]
    pub is_main: bool,
    #[serde(rename = "isLocked")]
    pub is_locked: bool,
    #[serde(rename = "lockReason")]
    pub lock_reason: Option<String>,
    #[serde(rename = "isPrunable")]
    pub is_prunable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
    pub modified: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentMatch {
    pub path: String,
    #[serde(rename = "lineNumber")]
    pub line_number: usize,
    pub line: String,
    #[serde(rename = "absolutePath")]
    pub absolute_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentSearchResult {
    pub matches: Vec<ContentMatch>,
    pub truncated: bool,
}

// Terminal state management
pub struct TerminalState {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub title: String,  // Command/title for display
    pub cwd: String,    // Working directory
    pub terminal_type: String,  // "shell" or "assistant"
    pub output_buffer: Arc<Mutex<Vec<u8>>>,  // Buffer for recent output (for mobile attach)
    pub child_pid: Option<u32>,  // PID of the child shell process for explicit cleanup
}

const MAX_OUTPUT_BUFFER_SIZE: usize = 100 * 1024; // 100KB buffer

// Terminal info for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    #[serde(rename = "type")]
    pub terminal_type: String,
}

// Git watcher state - holds the debouncer and stop signal
struct GitWatcher {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    _stop_tx: std::sync::mpsc::Sender<()>,
}

// File system watcher state - watches project files for changes
struct FileWatcher {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    _stop_tx: std::sync::mpsc::Sender<()>,
}

struct AppState {
    terminals: Mutex<HashMap<String, TerminalState>>,
    database: Mutex<Database>,
    portal_enabled: Mutex<bool>,
    git_watchers: Mutex<HashMap<String, GitWatcher>>,
    file_watchers: Mutex<HashMap<String, FileWatcher>>,
    portal: Mutex<Option<Portal>>,
}

// Debug command to print to terminal
#[tauri::command]
fn debug_log(message: String) {
    println!("[DEBUG] {}", message);
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    { std::env::var("USERPROFILE").map_err(|_| "Could not find USERPROFILE directory".to_string()) }
    #[cfg(not(target_os = "windows"))]
    { std::env::var("HOME").map_err(|_| "Could not find HOME directory".to_string()) }
}

/// Request microphone permission on macOS.
/// This triggers the system permission dialog if not already granted.
#[cfg(target_os = "macos")]
#[tauri::command]
fn request_microphone_permission() -> Result<String, String> {
    use std::process::Command;

    // Use AppleScript to trigger the microphone permission dialog
    // This is more reliable than using objc directly
    let script = r#"
        tell application "System Events"
            -- This triggers the microphone permission check
            set frontApp to name of first application process whose frontmost is true
        end tell

        -- Use osascript to check/request microphone access via a helper
        do shell script "osascript -e 'tell application \"System Events\" to return (get volume settings)'"
    "#;

    // Alternative: Use tccutil or direct TCC database check
    // For now, just try to trigger the permission by accessing audio
    let output = Command::new("osascript")
        .arg("-e")
        .arg(r#"
            use framework "AVFoundation"
            set authStatus to current application's AVCaptureDevice's authorizationStatusForMediaType:(current application's AVMediaTypeAudio)
            if authStatus = 0 then
                -- Not determined, request access
                current application's AVCaptureDevice's requestAccessForMediaType:(current application's AVMediaTypeAudio) completionHandler:(missing value)
                return "requested"
            else if authStatus = 3 then
                return "authorized"
            else if authStatus = 2 then
                return "denied"
            else if authStatus = 1 then
                return "restricted"
            else
                return "unknown"
            end if
        "#)
        .output()
        .map_err(|e| format!("Failed to run osascript: {}", e))?;

    if output.status.success() {
        let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(result)
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("osascript failed: {}", err))
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn request_microphone_permission() -> Result<String, String> {
    Ok("not_applicable".to_string())
}

/// Fetch secrets from macOS Keychain for environment variables.
/// Automatically discovers Keychain items with service names starting with "env/"
/// and exports them as environment variables (stripping the "env/" prefix).
/// This runs in Orca's GUI context, so authorization dialogs appear properly.
#[cfg(target_os = "macos")]
fn fetch_keychain_env_vars() -> HashMap<String, String> {
    let mut env_vars = HashMap::new();

    // First, dump keychain metadata to find items with "env/" prefix
    // We use dump-keychain without -d to avoid triggering auth for each item
    let dump_output = std::process::Command::new("/usr/bin/security")
        .args(["dump-keychain"])
        .output();

    let dump_output = match dump_output {
        Ok(o) => o,
        Err(e) => {
            println!("[Keychain] Failed to dump keychain: {}", e);
            return env_vars;
        }
    };

    let dump_text = String::from_utf8_lossy(&dump_output.stdout);

    // Parse dump output to find service names starting with "env/"
    // Format: 0x00000007 <blob>="env/SERVICE_NAME"
    // or: "svce"<blob>="env/SERVICE_NAME"
    let mut service_names: Vec<String> = Vec::new();

    for line in dump_text.lines() {
        let line = line.trim();
        // Look for service attribute (0x00000007 or "svce")
        if (line.contains("0x00000007") || line.contains("\"svce\"")) && line.contains("=\"env/") {
            // Extract the service name between quotes
            if let Some(start) = line.find("=\"env/") {
                let rest = &line[start + 2..]; // skip ="
                if let Some(end) = rest.find('"') {
                    let service = &rest[..end];
                    if !service_names.contains(&service.to_string()) {
                        service_names.push(service.to_string());
                    }
                }
            }
        }
    }

    if service_names.is_empty() {
        return env_vars;
    }

    println!("[Keychain] Found {} env items: {:?}", service_names.len(), service_names);

    // Fetch each secret
    for service in service_names {
        let output = std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", &service, "-w"])
            .output();

        if let Ok(output) = output {
            if output.status.success() {
                let secret = String::from_utf8_lossy(&output.stdout).trim().to_string();

                // Derive env var name: "env/PARCEL_API_KEY" -> "PARCEL_API_KEY"
                let env_name = service.strip_prefix("env/").unwrap_or(&service).to_string();

                if !env_name.is_empty() && !secret.is_empty() {
                    println!("[Keychain] Loaded secret for {}", env_name);
                    env_vars.insert(env_name, secret);
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("[Keychain] Failed to get {}: {}", service, stderr.trim());
            }
        }
    }

    env_vars
}

// Terminal commands
#[tauri::command]
fn spawn_terminal(
    shell: String,
    cwd: String,
    cols: Option<u16>,
    rows: Option<u16>,
    args: Option<Vec<String>>,
    is_assistant: Option<bool>,
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<AppState>>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let pty_system = native_pty_system();

    // Use provided dimensions or fall back to defaults
    let initial_cols = cols.unwrap_or(80);
    let initial_rows = rows.unwrap_or(24);

    let pty_pair = pty_system
        .openpty(PtySize {
            rows: initial_rows,
            cols: initial_cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    println!("DEBUG spawn_terminal - shell: {:?}, args: {:?}", shell, args);

    let mut cmd = if shell.is_empty() {
        // Use default shell
        // On Windows, always use powershell.exe (SHELL env var is a Unix convention
        // and may be set to invalid paths like /usr/bin/bash by Git Bash)
        #[cfg(target_os = "windows")]
        let shell_path = "powershell.exe".to_string();
        #[cfg(not(target_os = "windows"))]
        let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
            #[cfg(target_os = "macos")]
            { "/bin/zsh".to_string() }
            #[cfg(target_os = "linux")]
            { "/bin/bash".to_string() }
        });
        println!("DEBUG spawn_terminal - using shell: {:?}", shell_path);
        CommandBuilder::new(shell_path)
    } else if let Some(ref arg_list) = args {
        // Args provided separately - use them directly (handles paths with spaces)
        let command = &shell;
        let resolved_command = if command.contains('/') || command.contains('\\') {
            Some(command.to_string())
        } else {
            find_command_path(command).map(|p| p.to_string_lossy().to_string())
        };

        println!("DEBUG spawn_terminal - resolved command: {:?}", resolved_command);

        if let Some(full_path) = resolved_command {
            let mut cmd = CommandBuilder::new(&full_path);
            for arg in arg_list {
                cmd.arg(arg);
            }
            cmd
        } else {
            // Command not found in PATH - run through shell
            #[cfg(target_os = "windows")]
            let shell_path = "powershell.exe".to_string();
            #[cfg(not(target_os = "windows"))]
            let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
                #[cfg(target_os = "macos")]
                { "/bin/zsh".to_string() }
                #[cfg(target_os = "linux")]
                { "/bin/bash".to_string() }
            });

            let mut cmd = CommandBuilder::new(&shell_path);

            #[cfg(target_os = "windows")]
            {
                // PowerShell: escape args with double-quotes and use -Command
                let escaped_args: Vec<String> = arg_list.iter()
                    .map(|a| format!("\"{}\"", a.replace("\"", "`\"")))
                    .collect();
                let full_cmd = format!("{} {}", shell, escaped_args.join(" "));
                cmd.args(["-NoLogo", "-Command", &full_cmd]);
            }
            #[cfg(not(target_os = "windows"))]
            {
                // Unix: escape args with single-quotes and use login shell
                let escaped_args: Vec<String> = arg_list.iter()
                    .map(|a| format!("'{}'", a.replace("'", "'\\''")))
                    .collect();
                let full_cmd = format!("{} {}", shell, escaped_args.join(" "));
                cmd.args(["-i", "-l", "-c", &format!("exec {}", full_cmd)]);
            }

            cmd
        }
    } else {
        // Parse the shell command (legacy behavior)
        let parts: Vec<&str> = shell.split_whitespace().collect();
        if parts.is_empty() {
            return Err("Empty command".to_string());
        }

        // Resolve full path for the command if it's not already an absolute path
        let command = parts[0];
        let resolved_command = if command.contains('/') || command.contains('\\') {
            Some(command.to_string())
        } else {
            // Try to find the full path for this command
            find_command_path(command).map(|p| p.to_string_lossy().to_string())
        };

        println!("DEBUG spawn_terminal - resolved command: {:?}", resolved_command);

        if let Some(full_path) = resolved_command {
            // We found the command, run it directly
            let mut cmd = CommandBuilder::new(&full_path);
            for arg in parts.iter().skip(1) {
                cmd.arg(*arg);
            }
            cmd
        } else {
            // Command not found in PATH - run through user's shell
            #[cfg(target_os = "windows")]
            let shell_path = "powershell.exe".to_string();
            #[cfg(not(target_os = "windows"))]
            let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
                #[cfg(target_os = "macos")]
                { "/bin/zsh".to_string() }
                #[cfg(target_os = "linux")]
                { "/bin/bash".to_string() }
            });

            let mut cmd = CommandBuilder::new(&shell_path);

            #[cfg(target_os = "windows")]
            {
                println!("DEBUG spawn_terminal - running through PowerShell: {}", shell);
                cmd.args(["-NoLogo", "-Command", &shell]);
            }
            #[cfg(not(target_os = "windows"))]
            {
                println!("DEBUG spawn_terminal - running through shell: {} -ilc 'exec {}'", shell_path, shell);
                cmd.args(["-i", "-l", "-c", &format!("exec {}", shell)]);
            }

            cmd
        }
    };

    cmd.cwd(&cwd);

    // Inherit all environment variables from the parent process
    // This ensures keychain-injected secrets and user-configured vars are available
    for (key, value) in std::env::vars() {
        cmd.env(key, value);
    }

    // Set terminal type for proper rendering
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Set UTF-8 locale (Unix only - Windows handles encoding differently)
    #[cfg(not(target_os = "windows"))]
    {
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_ALL", "en_US.UTF-8");
    }

    // Build a comprehensive PATH that includes common tool locations
    let current_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/Shared".to_string());
        let extra_paths = vec![
            format!("{}/bin", home),
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/.pyenv/bin", home),
            format!("{}/.pyenv/shims", home),
            format!("{}/.nvm/versions/node/default/bin", home),
            "/opt/homebrew/bin".to_string(),
            "/opt/homebrew/sbin".to_string(),
            "/usr/local/bin".to_string(),
            "/usr/local/sbin".to_string(),
        ];
        let new_path = format!("{}:{}", extra_paths.join(":"), current_path);
        cmd.env("PATH", new_path);

        // Set HOMEBREW_PREFIX for brew shellenv
        if std::path::Path::new("/opt/homebrew").exists() {
            cmd.env("HOMEBREW_PREFIX", "/opt/homebrew");
            cmd.env("HOMEBREW_CELLAR", "/opt/homebrew/Cellar");
            cmd.env("HOMEBREW_REPOSITORY", "/opt/homebrew");
        } else if std::path::Path::new("/usr/local/Homebrew").exists() {
            cmd.env("HOMEBREW_PREFIX", "/usr/local");
            cmd.env("HOMEBREW_CELLAR", "/usr/local/Cellar");
            cmd.env("HOMEBREW_REPOSITORY", "/usr/local/Homebrew");
        }

        // Set NVM_DIR if it exists
        let nvm_dir = format!("{}/.nvm", home);
        if std::path::Path::new(&nvm_dir).exists() {
            cmd.env("NVM_DIR", &nvm_dir);
        }

        // Set PYENV_ROOT if it exists
        let pyenv_root = format!("{}/.pyenv", home);
        if std::path::Path::new(&pyenv_root).exists() {
            cmd.env("PYENV_ROOT", &pyenv_root);
        }

        // Pre-fetch Keychain secrets and set as environment variables
        // This runs in Orca's GUI context, so authorization dialogs appear properly
        let keychain_vars = fetch_keychain_env_vars();
        for (key, value) in keychain_vars {
            cmd.env(key, value);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home".to_string());
        let extra_paths = vec![
            format!("{}/bin", home),
            format!("{}/.local/bin", home),
            format!("{}/.cargo/bin", home),
            format!("{}/.pyenv/bin", home),
            format!("{}/.pyenv/shims", home),
            "/usr/local/bin".to_string(),
        ];
        let new_path = format!("{}:{}", extra_paths.join(":"), current_path);
        cmd.env("PATH", new_path);
    }

    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".to_string());
        let extra_paths = vec![
            format!("{}\\.cargo\\bin", home),
            format!("{}\\AppData\\Local\\Programs", home),
            format!("{}\\AppData\\Roaming\\npm", home),
            format!("{}\\.local\\bin", home),
        ];
        let new_path = format!("{};{}", extra_paths.join(";"), current_path);
        cmd.env("PATH", new_path);
    }

    // Destructure the PtyPair to separate master and slave
    let PtyPair { master: master_pty, slave: slave_pty } = pty_pair;

    let mut child = slave_pty
        .spawn_command(cmd)
        .map_err(|e| {
            let err_msg = format!("Failed to spawn terminal process: {}", e);
            println!("ERROR spawn_terminal - {}", err_msg);
            err_msg
        })?;

    // Capture the child PID before moving child into the wait thread
    let child_pid = child.process_id();

    // CRITICAL: Drop the slave side after spawning. On Windows ConPTY, keeping
    // the slave handle open prevents output from flowing to the master/reader.
    drop(slave_pty);

    let writer = master_pty.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master_pty.try_clone_reader().map_err(|e| e.to_string())?;

    let terminal_id = id.clone();
    let handle = app_handle.clone();
    let state_for_read = state.inner().clone();

    // Create output buffer for mobile attach replay
    let output_buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(MAX_OUTPUT_BUFFER_SIZE)));
    let output_buffer_clone = output_buffer.clone();

    // Spawn thread to read terminal output
    println!("DEBUG spawn_terminal - starting reader thread for terminal {}", terminal_id);
    thread::spawn(move || {
        let mut buffer = [0u8; 16384]; // Larger buffer for better throughput
        let event_name = format!("terminal-output-{}", terminal_id);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    println!("DEBUG reader thread - terminal {} got EOF", terminal_id);
                    break;
                }
                Ok(n) => {
                    // Buffer output and forward to mobile if portal mode is enabled
                    if *state_for_read.portal_enabled.lock() {
                        {
                            let mut buf = output_buffer_clone.lock();
                            buf.extend_from_slice(&buffer[..n]);
                            // Trim if over max size (keep most recent data)
                            if buf.len() > MAX_OUTPUT_BUFFER_SIZE {
                                let excess = buf.len() - MAX_OUTPUT_BUFFER_SIZE;
                                buf.drain(0..excess);
                            }
                        }

                        // Forward live output to mobile via portal
                        if let Some(ref portal) = *state_for_read.portal.lock() {
                            let raw_data = String::from_utf8_lossy(&buffer[..n]);
                            crate::portal::forward_terminal_output(portal, &terminal_id, &raw_data);
                        }
                    }

                    // Use base64 encoding for efficient transfer (much smaller than JSON array)
                    let encoded = BASE64.encode(&buffer[..n]);
                    // Emit to terminal-specific event (for desktop Terminal component)
                    let _ = handle.emit(&event_name, &encoded);
                    // Also emit to generic event with terminal ID (for mobile forwarding)
                    let _ = handle.emit("terminal-output", serde_json::json!({
                        "terminalId": terminal_id,
                        "data": encoded
                    }));
                }
                Err(e) => {
                    println!("DEBUG reader thread - terminal {} read error: {}", terminal_id, e);
                    break;
                }
            }
        }
    });

    // Spawn thread to wait for child exit
    let terminal_id_exit = id.clone();
    let state_clone = state.inner().clone();
    thread::spawn(move || {
        let _ = child.wait();
        state_clone.terminals.lock().remove(&terminal_id_exit);
    });

    // Determine title from shell command
    let title = if shell.is_empty() {
        "Shell".to_string()
    } else {
        // Use the command name as the title
        shell.split_whitespace().next().unwrap_or("Shell").to_string()
    };

    // Determine terminal type based on command
    let terminal_type = if is_assistant == Some(true) {
        "assistant".to_string()
    } else if shell.is_empty() {
        "shell".to_string()
    } else {
        let assistant_commands = ["claude", "aider", "gemini", "codex", "opencode", "pi"];
        let cmd = shell.split_whitespace().next().unwrap_or("");
        if assistant_commands.contains(&cmd) {
            "assistant".to_string()
        } else {
            "shell".to_string()
        }
    };

    let terminal_state = TerminalState {
        master: master_pty,
        writer,
        title,
        cwd: cwd.clone(),
        terminal_type,
        output_buffer,
        child_pid,
    };

    state.terminals.lock().insert(id.clone(), terminal_state);

    Ok(id)
}

#[tauri::command]
fn write_terminal(id: String, data: String, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    let mut terminals = state.terminals.lock();
    if let Some(terminal) = terminals.get_mut(&id) {
        terminal
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        terminal.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("Terminal not found: {}", id))
    }
}

#[tauri::command]
fn write_terminal_bytes(id: String, data: Vec<u8>, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    let mut terminals = state.terminals.lock();
    if let Some(terminal) = terminals.get_mut(&id) {
        terminal
            .writer
            .write_all(&data)
            .map_err(|e| e.to_string())?;
        terminal.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("Terminal not found: {}", id))
    }
}

#[tauri::command]
fn resize_terminal(
    id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<Arc<AppState>>,
) -> Result<(), String> {
    let terminals = state.terminals.lock();
    if let Some(terminal) = terminals.get(&id) {
        terminal
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Kill a terminal's child process by PID and drop its state
pub fn kill_terminal_process(terminal: TerminalState) {
    if let Some(pid) = terminal.child_pid {
        #[cfg(unix)]
        unsafe {
            libc::kill(pid as i32, libc::SIGHUP);
        }
        #[cfg(windows)]
        {
            // On Windows, dropping the master PTY handle will signal the child
            let _ = pid;
        }
    }
    // Dropping terminal_state closes the master PTY fd, which also signals the child
}

#[tauri::command]
fn kill_terminal(id: String, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    if let Some(terminal) = state.terminals.lock().remove(&id) {
        kill_terminal_process(terminal);
    }
    Ok(())
}

#[tauri::command]
fn kill_terminals(ids: Vec<String>, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    let mut terminals = state.terminals.lock();
    for id in ids {
        if let Some(terminal) = terminals.remove(&id) {
            kill_terminal_process(terminal);
        }
    }
    Ok(())
}

#[tauri::command]
fn list_terminals(state: tauri::State<Arc<AppState>>) -> Vec<TerminalInfo> {
    let terminals = state.terminals.lock();
    println!("[list_terminals] Found {} terminals", terminals.len());
    terminals
        .iter()
        .map(|(id, t)| {
            println!("[list_terminals] Terminal: {} title={} cwd={} type={}", id, t.title, t.cwd, t.terminal_type);
            TerminalInfo {
                id: id.clone(),
                title: t.title.clone(),
                cwd: t.cwd.clone(),
                terminal_type: t.terminal_type.clone(),
            }
        })
        .collect()
}

#[tauri::command]
fn clear_terminals(state: tauri::State<Arc<AppState>>) {
    let mut terminals = state.terminals.lock();
    let all: Vec<TerminalState> = terminals.drain().map(|(_, t)| t).collect();
    println!("[clear_terminals] Killing {} terminals", all.len());
    for terminal in all {
        kill_terminal_process(terminal);
    }
}

#[tauri::command]
fn get_terminal_buffer(id: String, state: tauri::State<Arc<AppState>>) -> Result<String, String> {
    let terminals = state.terminals.lock();
    if let Some(terminal) = terminals.get(&id) {
        let buf = terminal.output_buffer.lock();
        // Return base64-encoded buffer content
        Ok(BASE64.encode(&buf[..]))
    } else {
        Err(format!("Terminal not found: {}", id))
    }
}

// Git commands
#[tauri::command]
fn is_git_repo(path: String) -> Result<bool, String> {
    GitService::is_git_repo(&path)
}

#[tauri::command]
fn get_status(repo_path: String) -> Result<GitStatus, String> {
    GitService::get_status(&repo_path)
}

#[tauri::command]
fn get_diff(repo_path: String) -> Result<Vec<FileDiff>, String> {
    GitService::get_diff(&repo_path)
}

#[tauri::command]
fn commit(repo_path: String, message: String, files: Option<Vec<String>>) -> Result<(), String> {
    GitService::commit(&repo_path, &message, files)
}

#[tauri::command]
fn get_branches(repo_path: String) -> Result<Vec<Branch>, String> {
    GitService::get_branches(&repo_path)
}

#[tauri::command]
fn checkout_branch(repo_path: String, branch: String) -> Result<(), String> {
    GitService::checkout_branch(&repo_path, &branch)
}

#[tauri::command]
fn create_branch(repo_path: String, name: String) -> Result<(), String> {
    GitService::create_branch(&repo_path, &name)
}

#[tauri::command]
fn get_history(repo_path: String, limit: u32) -> Result<Vec<Commit>, String> {
    GitService::get_history(&repo_path, limit)
}

#[tauri::command]
fn get_commit_diff(repo_path: String, commit_id: String) -> Result<Vec<FileDiff>, String> {
    GitService::get_commit_diff(&repo_path, &commit_id)
}

#[tauri::command]
fn discard_file(repo_path: String, file_path: String) -> Result<(), String> {
    GitService::discard_file(&repo_path, &file_path)
}

#[tauri::command]
fn add_to_gitignore(repo_path: String, pattern: String) -> Result<(), String> {
    GitService::add_to_gitignore(&repo_path, &pattern)
}

#[tauri::command]
fn get_remote_url(repo_path: String) -> Result<String, String> {
    GitService::get_remote_url(&repo_path)
}

#[tauri::command]
fn discard_hunk(
    repo_path: String,
    file_path: String,
    old_start: i32,
    old_lines: i32,
    new_start: i32,
    new_lines: i32,
    lines: Vec<String>,
) -> Result<(), String> {
    GitService::discard_hunk(&repo_path, &file_path, old_start, old_lines, new_start, new_lines, lines)
}

#[tauri::command]
fn checkout_commit(repo_path: String, commit_id: String) -> Result<(), String> {
    GitService::checkout_commit(&repo_path, &commit_id)
}

#[tauri::command]
fn reset_to_commit(repo_path: String, commit_id: String, mode: String) -> Result<(), String> {
    GitService::reset_to_commit(&repo_path, &commit_id, &mode)
}

#[tauri::command]
fn revert_commit(repo_path: String, commit_id: String) -> Result<(), String> {
    GitService::revert_commit(&repo_path, &commit_id)
}

#[tauri::command]
fn get_file_tree(path: String, show_hidden: bool) -> Result<Vec<FileTreeNode>, String> {
    use std::fs;
    use std::path::Path;

    fn build_tree(dir_path: &Path, base_path: &Path, depth: usize, show_hidden: bool) -> Result<Vec<FileTreeNode>, String> {
        if depth > 10 {
            return Ok(vec![]); // Limit depth to prevent infinite recursion
        }

        let mut nodes = Vec::new();
        let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files/dirs unless show_hidden is true
            if !show_hidden && name.starts_with('.') {
                continue;
            }

            // Always skip common ignore patterns
            if name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" || name == "build" {
                continue;
            }

            let relative_path = path.strip_prefix(base_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| name.clone());

            let is_dir = path.is_dir();
            let modified = fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64());
            let children = if is_dir {
                Some(build_tree(&path, base_path, depth + 1, show_hidden)?)
            } else {
                None
            };

            nodes.push(FileTreeNode {
                name,
                path: relative_path,
                is_dir,
                children,
                modified,
            });
        }

        // Sort: directories first, then alphabetically
        nodes.sort_by(|a, b| {
            match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });

        Ok(nodes)
    }

    let path = Path::new(&path);
    build_tree(path, path, 0, show_hidden)
}

#[tauri::command]
fn search_file_contents(path: String, query: String, show_hidden: bool, max_results: Option<usize>) -> Result<ContentSearchResult, String> {
    use std::fs;
    use std::io::{BufRead, BufReader};
    use std::path::Path;

    let max = max_results.unwrap_or(100);
    let query_lower = query.to_lowercase();
    let mut matches: Vec<ContentMatch> = Vec::new();
    let mut truncated = false;

    let binary_extensions = [
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp", ".tiff", ".tif", ".psd", ".ai",
        ".mp4", ".mov", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a",
        ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".dmg", ".iso",
        ".exe", ".dll", ".so", ".dylib", ".bin", ".app", ".deb", ".rpm", ".msi",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
        ".ttf", ".otf", ".woff", ".woff2", ".eot",
        ".sqlite", ".db", ".pyc", ".class", ".o", ".a", ".wasm",
    ];

    fn walk_dir(
        dir_path: &Path,
        base_path: &Path,
        query_lower: &str,
        show_hidden: bool,
        binary_extensions: &[&str],
        matches: &mut Vec<ContentMatch>,
        max: usize,
        truncated: &mut bool,
        depth: usize,
    ) {
        if depth > 10 || *truncated {
            return;
        }

        let entries = match fs::read_dir(dir_path) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries {
            if matches.len() >= max {
                *truncated = true;
                return;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files/dirs unless show_hidden is true
            if !show_hidden && name.starts_with('.') {
                continue;
            }

            // Always skip common ignore patterns
            if name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" || name == "build" || name == ".git" {
                continue;
            }

            if path.is_dir() {
                walk_dir(&path, base_path, query_lower, show_hidden, binary_extensions, matches, max, truncated, depth + 1);
            } else {
                // Skip binary files by extension
                let name_lower = name.to_lowercase();
                if binary_extensions.iter().any(|ext| name_lower.ends_with(ext)) {
                    continue;
                }

                // Skip files > 1MB
                if let Ok(metadata) = fs::metadata(&path) {
                    if metadata.len() > 1_048_576 {
                        continue;
                    }
                }

                // Search file contents
                let file = match fs::File::open(&path) {
                    Ok(f) => f,
                    Err(_) => continue,
                };

                let reader = BufReader::new(file);
                for (line_idx, line_result) in reader.lines().enumerate() {
                    if matches.len() >= max {
                        *truncated = true;
                        return;
                    }

                    let line = match line_result {
                        Ok(l) => l,
                        Err(_) => break, // binary content or encoding error
                    };

                    if line.to_lowercase().contains(query_lower) {
                        let relative_path = path.strip_prefix(base_path)
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|_| name.clone());

                        matches.push(ContentMatch {
                            path: relative_path,
                            line_number: line_idx + 1,
                            line: if line.len() > 500 { line[..500].to_string() } else { line },
                            absolute_path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    let base = Path::new(&path);
    walk_dir(base, base, &query_lower, show_hidden, &binary_extensions, &mut matches, max, &mut truncated, 0);

    Ok(ContentSearchResult { matches, truncated })
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&path);
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    use std::fs;

    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn edit_file_line(file_path: String, line_number: usize, new_content: String, delete: Option<bool>) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(&file_path);
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let lines: Vec<&str> = content.lines().collect();

    if line_number == 0 || line_number > lines.len() {
        return Err(format!("Line number {} out of range (1-{})", line_number, lines.len()));
    }

    // Convert to 0-indexed
    let idx = line_number - 1;

    // Create a new vector with the updated line
    let mut new_lines: Vec<String> = lines.iter().map(|s| s.to_string()).collect();

    // Only delete the line when explicitly requested
    if delete.unwrap_or(false) {
        new_lines.remove(idx);
    } else {
        new_lines[idx] = new_content;
    }

    // Write back with proper line endings
    let new_content = new_lines.join("\n");
    fs::write(path, new_content).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn save_clipboard_image(base64: String, mime: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let base64_data = match base64.find(',') {
        Some(idx) => &base64[idx + 1..],
        None => base64.as_str(),
    };

    let bytes = BASE64
        .decode(base64_data.as_bytes())
        .map_err(|e| e.to_string())?;

    let extension = match mime.as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "png",
    };

    let mut dir = std::env::temp_dir();
    dir.push("orca");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let filename = format!("clipboard-{}.{}", Uuid::new_v4(), extension);
    let mut path = PathBuf::from(&dir);
    path.push(filename);

    fs::write(&path, bytes).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn init_repo(path: String) -> Result<(), String> {
    GitService::init_repo(&path)
}

#[tauri::command]
fn clone_repo(url: String, path: String) -> Result<String, String> {
    GitService::clone_repo(&url, &path)
}

#[tauri::command]
fn fetch_remote(repo_path: String, remote: String) -> Result<(), String> {
    GitService::fetch(&repo_path, &remote)
}

#[tauri::command]
fn pull_remote(repo_path: String, remote: String) -> Result<(), String> {
    GitService::pull(&repo_path, &remote)
}

#[tauri::command]
fn push_remote(repo_path: String, remote: String) -> Result<(), String> {
    GitService::push(&repo_path, &remote)
}

#[tauri::command]
fn publish_branch(repo_path: String, remote: String) -> Result<(), String> {
    GitService::publish_branch(&repo_path, &remote)
}

// Git file watcher commands
/// Resolve the actual .git directory for a repo path.
/// Handles both regular repos (.git is a directory) and worktrees (.git is a file containing "gitdir: <path>").
fn resolve_git_dir(repo_path: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Path;
    let git_path = Path::new(repo_path).join(".git");
    if !git_path.exists() {
        return Err("Not a git repository".to_string());
    }
    if git_path.is_dir() {
        return Ok(git_path);
    }
    // .git is a file (worktree) — parse "gitdir: <path>"
    let content = std::fs::read_to_string(&git_path).map_err(|e| e.to_string())?;
    let gitdir = content
        .trim()
        .strip_prefix("gitdir: ")
        .ok_or_else(|| "Invalid .git file format".to_string())?;
    let resolved = if Path::new(gitdir).is_absolute() {
        std::path::PathBuf::from(gitdir)
    } else {
        Path::new(repo_path).join(gitdir)
    };
    if resolved.exists() {
        Ok(resolved)
    } else {
        Err(format!("Git directory not found: {}", resolved.display()))
    }
}

#[tauri::command]
fn watch_repo(
    repo_path: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<AppState>>,
) -> Result<(), String> {
    use notify::RecursiveMode;
    use std::path::Path;
    use std::sync::mpsc;

    // Check if already watching this repo
    {
        let watchers = state.git_watchers.lock();
        if watchers.contains_key(&repo_path) {
            return Ok(()); // Already watching
        }
    }

    let git_dir = resolve_git_dir(&repo_path)?;

    // Create channels for communication
    let (event_tx, event_rx) = mpsc::channel::<()>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    // Spawn a thread to handle events and emit to frontend
    let repo_path_for_thread = repo_path.clone();
    let app_handle_clone = app_handle.clone();
    thread::spawn(move || {
        loop {
            // Check for stop signal (non-blocking)
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // Wait for events with timeout so we can check stop signal
            match event_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(()) => {
                    // Emit event to frontend (safe on this thread)
                    if let Err(e) = app_handle_clone.emit("git-files-changed", &repo_path_for_thread) {
                        println!("Failed to emit git-files-changed: {:?}", e);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    // Create a debounced watcher with 500ms delay to batch rapid changes
    let event_tx_clone = event_tx.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            match result {
                Ok(events) => {
                    // Check if any event is relevant
                    let has_changes = events.iter().any(|e| {
                        matches!(e.kind, DebouncedEventKind::Any)
                    });

                    if has_changes {
                        // Send to the event thread (ignore errors if channel closed)
                        let _ = event_tx_clone.send(());
                    }
                }
                Err(e) => {
                    println!("Git watcher error: {:?}", e);
                }
            }
        },
    ).map_err(|e| e.to_string())?;

    // Watch the .git directory (especially index file which changes on most operations)
    debouncer.watcher().watch(&git_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Also watch the working directory recursively for file changes
    // This catches new files, deletions, and modifications before they're staged
    let work_dir = Path::new(&repo_path);
    debouncer.watcher().watch(work_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Store the watcher
    let git_watcher = GitWatcher {
        _debouncer: debouncer,
        _stop_tx: stop_tx,
    };
    state.git_watchers.lock().insert(repo_path, git_watcher);

    Ok(())
}

#[tauri::command]
fn unwatch_repo(
    repo_path: String,
    state: tauri::State<Arc<AppState>>,
) -> Result<(), String> {
    state.git_watchers.lock().remove(&repo_path);
    Ok(())
}

// Worktree commands
#[tauri::command]
fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    GitService::list_worktrees(&repo_path)
}

#[tauri::command]
fn create_worktree(
    repo_path: String,
    path: String,
    branch: Option<String>,
    new_branch: Option<String>,
) -> Result<WorktreeInfo, String> {
    GitService::create_worktree(
        &repo_path,
        &path,
        branch.as_deref(),
        new_branch.as_deref(),
    )
}

#[tauri::command]
fn remove_worktree(repo_path: String, worktree_path: String, force: bool) -> Result<(), String> {
    GitService::remove_worktree(&repo_path, &worktree_path, force)
}

#[tauri::command]
fn prune_worktrees(repo_path: String) -> Result<(), String> {
    GitService::prune_worktrees(&repo_path)
}

#[tauri::command]
fn lock_worktree(repo_path: String, worktree_path: String, reason: Option<String>) -> Result<(), String> {
    GitService::lock_worktree(&repo_path, &worktree_path, reason.as_deref())
}

#[tauri::command]
fn unlock_worktree(repo_path: String, worktree_path: String) -> Result<(), String> {
    GitService::unlock_worktree(&repo_path, &worktree_path)
}

// File system watcher commands - watches project files for changes (Issue #8)
#[tauri::command]
fn watch_project_files(
    project_path: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<Arc<AppState>>,
) -> Result<(), String> {
    use notify::RecursiveMode;
    use std::path::Path;
    use std::sync::mpsc;

    // Check if already watching this project
    {
        let watchers = state.file_watchers.lock();
        if watchers.contains_key(&project_path) {
            return Ok(()); // Already watching
        }
    }

    let project_dir = Path::new(&project_path);
    if !project_dir.exists() || !project_dir.is_dir() {
        return Err("Project path does not exist or is not a directory".to_string());
    }

    // Create channels for communication
    let (event_tx, event_rx) = mpsc::channel::<()>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    // Spawn a thread to handle events and emit to frontend
    let project_path_for_thread = project_path.clone();
    let app_handle_clone = app_handle.clone();
    thread::spawn(move || {
        loop {
            // Check for stop signal (non-blocking)
            if stop_rx.try_recv().is_ok() {
                break;
            }

            // Wait for events with timeout so we can check stop signal
            match event_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(()) => {
                    // Emit event to frontend
                    if let Err(e) = app_handle_clone.emit("fs-files-changed", &project_path_for_thread) {
                        println!("Failed to emit fs-files-changed: {:?}", e);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    // Directories to ignore when watching
    let ignore_dirs: std::collections::HashSet<&str> = [
        "node_modules", "target", "__pycache__", "dist", "build", ".git"
    ].iter().cloned().collect();

    // Create a debounced watcher with 500ms delay to batch rapid changes
    let event_tx_clone = event_tx.clone();
    let ignore_dirs_clone = ignore_dirs.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            match result {
                Ok(events) => {
                    // Filter out events in ignored directories
                    let has_relevant_changes = events.iter().any(|e| {
                        if !matches!(e.kind, DebouncedEventKind::Any) {
                            return false;
                        }
                        // Check if path contains any ignored directory
                        let path_str = e.path.to_string_lossy();
                        !ignore_dirs_clone.iter().any(|dir| {
                            path_str.contains(&format!("/{}/", dir)) ||
                            path_str.contains(&format!("\\{}\\", dir)) ||
                            path_str.ends_with(&format!("/{}", dir)) ||
                            path_str.ends_with(&format!("\\{}", dir))
                        })
                    });

                    if has_relevant_changes {
                        let _ = event_tx_clone.send(());
                    }
                }
                Err(e) => {
                    println!("File watcher error: {:?}", e);
                }
            }
        },
    ).map_err(|e| e.to_string())?;

    // Watch the project directory recursively
    debouncer.watcher().watch(project_dir, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Store the watcher
    let file_watcher = FileWatcher {
        _debouncer: debouncer,
        _stop_tx: stop_tx,
    };
    state.file_watchers.lock().insert(project_path, file_watcher);

    Ok(())
}

#[tauri::command]
fn unwatch_project_files(
    project_path: String,
    state: tauri::State<Arc<AppState>>,
) -> Result<(), String> {
    state.file_watchers.lock().remove(&project_path);
    Ok(())
}

// Project commands
#[tauri::command]
fn add_project(project: Project, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    let db = state.database.lock();
    db.add_project(&project)
}

#[tauri::command]
fn remove_project(id: String, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    let db = state.database.lock();
    db.remove_project(&id)
}

#[tauri::command]
fn get_project(id: String, state: tauri::State<Arc<AppState>>) -> Result<Option<Project>, String> {
    let db = state.database.lock();
    db.get_project(&id)
}

#[tauri::command]
fn get_all_projects(state: tauri::State<Arc<AppState>>) -> Result<Vec<Project>, String> {
    let db = state.database.lock();
    db.get_all_projects()
}

// File system commands
#[tauri::command]
async fn open_folder_dialog() -> Result<Option<String>, String> {
    // Note: In a real implementation, you'd use a file dialog
    // For now, we return None to indicate no folder was selected
    // The actual dialog would be implemented using native APIs or a Tauri plugin
    Ok(None)
}

#[tauri::command]
fn open_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reveal_in_file_manager(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // On Linux, open the parent directory since xdg-open doesn't support selecting
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_file_in_editor(path: String, line: Option<u32>, column: Option<u32>) -> Result<(), String> {
    use std::path::Path;

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let line_num = line.unwrap_or(1);
    let col_num = column.unwrap_or(1);

    // Try VS Code first (most common code editor with line number support)
    let vscode_result = {
        #[cfg(target_os = "macos")]
        {
            // Try 'code' command first, then fall back to VS Code app bundle
            std::process::Command::new("code")
                .arg("--goto")
                .arg(format!("{}:{}:{}", path, line_num, col_num))
                .spawn()
                .or_else(|_| {
                    std::process::Command::new("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")
                        .arg("--goto")
                        .arg(format!("{}:{}:{}", path, line_num, col_num))
                        .spawn()
                })
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("code")
                .arg("--goto")
                .arg(format!("{}:{}:{}", path, line_num, col_num))
                .spawn()
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("code")
                .arg("--goto")
                .arg(format!("{}:{}:{}", path, line_num, col_num))
                .spawn()
        }
    };

    if vscode_result.is_ok() {
        return Ok(());
    }

    // Try Cursor editor (VS Code fork)
    let cursor_result = std::process::Command::new("cursor")
        .arg("--goto")
        .arg(format!("{}:{}:{}", path, line_num, col_num))
        .spawn();

    if cursor_result.is_ok() {
        return Ok(());
    }

    // Try Zed editor
    let zed_result = {
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("zed")
                .arg(format!("{}:{}", path, line_num))
                .spawn()
        }
        #[cfg(not(target_os = "macos"))]
        {
            std::process::Command::new("zed")
                .arg(format!("{}:{}", path, line_num))
                .spawn()
        }
    };

    if zed_result.is_ok() {
        return Ok(());
    }

    // Fall back to system default application
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn open_in_terminal_editor(path: String, editor: String) -> Result<(), String> {
    use std::path::Path;

    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    // Escape the path for shell use
    let escaped_path = path.replace("'", "'\\''");

    #[cfg(target_os = "macos")]
    {
        // Use osascript to open a new Terminal window with the editor
        let script = format!(
            r#"tell application "Terminal"
                activate
                do script "{} '{}'"
            end tell"#,
            editor, escaped_path
        );
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // Open a new cmd window with the editor
        std::process::Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", &format!("{} \"{}\"", editor, path)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try common terminal emulators
        let terminals = ["gnome-terminal", "konsole", "xfce4-terminal", "xterm"];
        let mut spawned = false;

        for term in terminals {
            let result = match term {
                "gnome-terminal" => std::process::Command::new(term)
                    .args(["--", &editor, &path])
                    .spawn(),
                "konsole" => std::process::Command::new(term)
                    .args(["-e", &editor, &path])
                    .spawn(),
                "xfce4-terminal" => std::process::Command::new(term)
                    .args(["-e", &format!("{} '{}'", editor, escaped_path)])
                    .spawn(),
                _ => std::process::Command::new(term)
                    .args(["-e", &format!("{} '{}'", editor, escaped_path)])
                    .spawn(),
            };

            if result.is_ok() {
                spawned = true;
                break;
            }
        }

        if !spawned {
            return Err("Could not find a terminal emulator".to_string());
        }
    }

    Ok(())
}

// List directories in a path
#[tauri::command]
fn list_directories(path: String) -> Result<Vec<String>, String> {
    let mut dirs = Vec::new();

    // Add parent directory option
    dirs.push("..".to_string());

    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    if let Some(name) = entry.file_name().to_str() {
                        // Skip hidden directories
                        if !name.starts_with('.') {
                            dirs.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    dirs.sort();
    Ok(dirs)
}

// Read shell history
#[tauri::command]
fn get_shell_history(limit: Option<usize>) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(500);

    let mut history_paths: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // PowerShell history file location
        if let Ok(appdata) = std::env::var("APPDATA") {
            history_paths.push(format!(
                "{}\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt",
                appdata
            ));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = std::env::var("HOME") {
            // Try zsh history first, then bash
            history_paths.push(format!("{}/.zsh_history", home));
            history_paths.push(format!("{}/.bash_history", home));
        }
    }

    for history_path in history_paths {
        let path = std::path::Path::new(&history_path);
        if path.exists() {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            let content = String::from_utf8_lossy(&bytes);
            let mut commands: Vec<String> = content
                .lines()
                .filter_map(|line| {
                    // zsh history format: ": timestamp:0;command" or just "command"
                    let cmd = if line.starts_with(':') {
                        line.splitn(2, ';').nth(1).map(|s| s.to_string())
                    } else {
                        Some(line.to_string())
                    };
                    cmd.filter(|s| !s.trim().is_empty())
                })
                .collect();

            // Remove duplicates while preserving order (keep last occurrence)
            let mut seen = std::collections::HashSet::new();
            commands.reverse();
            commands.retain(|cmd| seen.insert(cmd.clone()));
            commands.reverse();

            // Return most recent commands (up to limit)
            let start = commands.len().saturating_sub(limit);
            return Ok(commands[start..].to_vec());
        }
    }

    Ok(Vec::new())
}

// Per-project shell history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ShellHistoryEntry {
    command: String,
    project_path: String,
    timestamp: i64,
}

// Get the path to Orca's shell history file
fn get_orca_history_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("shell_history.json"))
}

// Record a command to project-specific history
#[tauri::command]
fn record_project_command(command: String, project_path: String) -> Result<(), String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Ok(());
    }

    let history_path = get_orca_history_path().ok_or("Could not determine history path")?;

    // Ensure directory exists
    if let Some(parent) = history_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Load existing history
    let mut entries: Vec<ShellHistoryEntry> = if history_path.exists() {
        let content = std::fs::read_to_string(&history_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Add new entry
    let entry = ShellHistoryEntry {
        command: command.clone(),
        project_path: project_path.clone(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    entries.push(entry);

    // Keep only last 5000 entries total to prevent unbounded growth
    if entries.len() > 5000 {
        entries = entries.split_off(entries.len() - 5000);
    }

    // Save back
    let content = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    std::fs::write(&history_path, content).map_err(|e| e.to_string())?;

    Ok(())
}

// Get project-specific shell history
#[tauri::command]
fn get_project_shell_history(project_path: String, limit: Option<usize>) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(500);
    let history_path = get_orca_history_path().ok_or("Could not determine history path")?;

    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
    let entries: Vec<ShellHistoryEntry> = serde_json::from_str(&content).unwrap_or_default();

    // Filter by project path and extract commands
    let mut commands: Vec<String> = entries
        .into_iter()
        .filter(|e| e.project_path == project_path || e.project_path.starts_with(&format!("{}/", project_path)))
        .map(|e| e.command)
        .collect();

    // Remove duplicates while preserving order (keep last occurrence)
    let mut seen = std::collections::HashSet::new();
    commands.reverse();
    commands.retain(|cmd| seen.insert(cmd.clone()));
    commands.reverse();

    // Return most recent commands (up to limit)
    let start = commands.len().saturating_sub(limit);
    Ok(commands[start..].to_vec())
}

// Helper function to find the full path of a command
fn find_command_path(cmd: &str) -> Option<std::path::PathBuf> {
    // First try the standard which lookup
    if let Ok(path) = which::which(cmd) {
        return Some(path);
    }

    // On macOS, GUI apps don't inherit shell profile paths, so check common locations
    #[cfg(target_os = "macos")]
    {
        use std::path::Path;

        // Get home directory
        if let Some(home) = std::env::var_os("HOME") {
            let home = Path::new(&home);

            // Common installation paths for npm/node-based CLIs
            let common_paths = [
                home.join(".local/bin").join(cmd),
                home.join(".npm-global/bin").join(cmd),
                home.join(".nvm/versions/node").join("current/bin").join(cmd),
            ];

            for path in &common_paths {
                if path.exists() {
                    return Some(path.clone());
                }
            }

            // Check nvm versions directory for any installed node version
            let nvm_versions = home.join(".nvm/versions/node");
            if nvm_versions.exists() {
                if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                    for entry in entries.flatten() {
                        let bin_path = entry.path().join("bin").join(cmd);
                        if bin_path.exists() {
                            return Some(bin_path);
                        }
                    }
                }
            }
        }

        // System-wide paths that might not be in GUI app PATH
        let system_paths = [
            Path::new("/usr/local/bin").join(cmd),
            Path::new("/opt/homebrew/bin").join(cmd),
        ];

        for path in &system_paths {
            if path.exists() {
                return Some(path.clone());
            }
        }
    }

    None
}

// Helper function to check if a command exists
fn command_exists(cmd: &str) -> bool {
    find_command_path(cmd).is_some()
}

// Assistant commands
#[tauri::command]
fn check_installed_assistants() -> Result<Vec<String>, String> {
    let mut installed = Vec::new();

    // Check for Claude Code
    if command_exists("claude") {
        installed.push("claude".to_string());
    }

    // Check for Aider
    if command_exists("aider") {
        installed.push("aider".to_string());
    }

    // Check for Gemini CLI
    if command_exists("gemini") {
        installed.push("gemini".to_string());
    }

    // Check for OpenAI Codex CLI
    if command_exists("codex") {
        installed.push("codex".to_string());
    }

    // Check for OpenCode CLI
    if command_exists("opencode") {
        installed.push("opencode".to_string());
    }

    // Check for Pi
    if command_exists("pi") {
        installed.push("pi".to_string());
    }

    Ok(installed)
}

#[tauri::command]
fn check_commands_installed(commands: Vec<String>) -> Result<Vec<String>, String> {
    // First try the fast in-process check
    let mut installed: Vec<String> = commands.iter()
        .filter(|cmd| command_exists(cmd))
        .cloned()
        .collect();

    // For any commands not found, scan the augmented PATH directories directly
    // (same paths that spawn_terminal provides to child processes)
    let not_found: Vec<&String> = commands.iter()
        .filter(|cmd| !installed.contains(cmd))
        .collect();

    if !not_found.is_empty() {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let mut search_dirs: Vec<String> = Vec::new();

        #[cfg(not(target_os = "windows"))]
        {
            let home = std::env::var("HOME").unwrap_or_else(|_| {
                #[cfg(target_os = "macos")]
                { "/Users".to_string() }
                #[cfg(not(target_os = "macos"))]
                { "/home".to_string() }
            });

            // Build the same augmented PATH that spawn_terminal uses
            search_dirs.extend(vec![
                format!("{}/bin", home),
                format!("{}/.local/bin", home),
                format!("{}/.cargo/bin", home),
                format!("{}/.pyenv/bin", home),
                format!("{}/.pyenv/shims", home),
                format!("{}/.nvm/versions/node/default/bin", home),
                "/opt/homebrew/bin".to_string(),
                "/opt/homebrew/sbin".to_string(),
                "/usr/local/bin".to_string(),
                "/usr/local/sbin".to_string(),
            ]);

            // Also scan all nvm node version bin dirs
            let nvm_versions = format!("{}/.nvm/versions/node", home);
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                for entry in entries.flatten() {
                    let bin_dir = entry.path().join("bin");
                    if bin_dir.exists() {
                        search_dirs.push(bin_dir.to_string_lossy().to_string());
                    }
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users".to_string());
            search_dirs.extend(vec![
                format!("{}\\.cargo\\bin", home),
                format!("{}\\AppData\\Local\\Programs", home),
                format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", home),
                format!("{}\\AppData\\Roaming\\npm", home),
                format!("{}\\.local\\bin", home),
            ]);
        }

        // Add existing PATH entries (use platform-appropriate separator)
        #[cfg(target_os = "windows")]
        let path_separator = ';';
        #[cfg(not(target_os = "windows"))]
        let path_separator = ':';

        for dir in current_path.split(path_separator) {
            if !dir.is_empty() && !search_dirs.contains(&dir.to_string()) {
                search_dirs.push(dir.to_string());
            }
        }

        for cmd in &not_found {
            let mut found = false;
            for dir in &search_dirs {
                // On Windows, also check common executable extensions
                #[cfg(target_os = "windows")]
                {
                    let extensions = ["", ".exe", ".cmd", ".bat", ".ps1"];
                    for ext in &extensions {
                        let candidate = std::path::Path::new(dir).join(format!("{}{}", cmd, ext));
                        if candidate.exists() {
                            installed.push((*cmd).clone());
                            found = true;
                            break;
                        }
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let candidate = std::path::Path::new(dir).join(cmd.as_str());
                    if candidate.exists() {
                        installed.push((*cmd).clone());
                        found = true;
                    }
                }
                if found { break; }
            }
        }

        // Last resort: try shell for anything still missing
        let still_not_found: Vec<&&String> = not_found.iter()
            .filter(|cmd| !installed.contains(cmd))
            .collect();

        if !still_not_found.is_empty() {
            #[cfg(target_os = "windows")]
            {
                // On Windows, use 'where' command to find executables
                for cmd in &still_not_found {
                    let output = std::process::Command::new("cmd.exe")
                        .args(["/C", &format!("where {}", cmd)])
                        .output();
                    if let Ok(output) = output {
                        if output.status.success() {
                            installed.push((**cmd).clone());
                        }
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                // On Unix, try an interactive login shell
                let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
                    #[cfg(target_os = "macos")]
                    { "/bin/zsh".to_string() }
                    #[cfg(not(target_os = "macos"))]
                    { "/bin/bash".to_string() }
                });
                for cmd in &still_not_found {
                    let output = std::process::Command::new(&shell_path)
                        .args(["-i", "-l", "-c", &format!("command -v {}", cmd)])
                        .output();
                    if let Ok(output) = output {
                        if output.status.success() {
                            installed.push((**cmd).clone());
                        }
                    }
                }
            }
        }
    }

    Ok(installed)
}

#[tauri::command]
fn install_assistant(command: String) -> Result<String, String> {
    let install_cmd = match command.as_str() {
        "claude" => {
            if cfg!(target_os = "windows") {
                "irm https://claude.ai/install.ps1 | iex"
            } else {
                "curl -fsSL https://claude.ai/install.sh | bash"
            }
        }
        "aider" => "pip install aider-chat",
        "gemini" => "npm install -g @anthropic-ai/gemini-cli",
        "codex" => "npm install -g @openai/codex",
        "opencode" => "curl -fsSL https://opencode.ai/install | bash",
        "pi" => "npm install -g @mariozechner/pi-coding-agent",
        _ => return Err(format!("Unknown assistant: {}", command)),
    };

    // Return the install command for the user to run in terminal
    Ok(install_cmd.to_string())
}

// AI commands using Groq
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AiMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

impl AiMessage {
    fn user(content: &str) -> Self {
        Self { role: "user".into(), content: Some(content.into()), tool_calls: None, tool_call_id: None, name: None }
    }
    fn system(content: &str) -> Self {
        Self { role: "system".into(), content: Some(content.into()), tool_calls: None, tool_call_id: None, name: None }
    }
    fn tool_result(tool_call_id: &str, name: &str, content: &str) -> Self {
        Self { role: "tool".into(), content: Some(content.into()), tool_calls: None, tool_call_id: Some(tool_call_id.into()), name: Some(name.into()) }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: ToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Clone, Serialize)]
struct Tool {
    #[serde(rename = "type")]
    tool_type: String,
    function: ToolFunction,
}

#[derive(Debug, Clone, Serialize)]
struct ToolFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct AiRequest {
    model: String,
    messages: Vec<AiMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Tool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AiChoice {
    message: AiMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AiResponse {
    choices: Vec<AiChoice>,
}

// --- Claude (Anthropic) API types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ClaudeMessage {
    role: String,
    content: ClaudeContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
enum ClaudeContent {
    Text(String),
    Blocks(Vec<ClaudeContentBlock>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ClaudeContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: String,
    },
}

#[derive(Debug, Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<ClaudeMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<ClaudeTool>>,
}

#[derive(Debug, Clone, Serialize)]
struct ClaudeTool {
    name: String,
    description: String,
    input_schema: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeResponseBlock>,
    stop_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
enum ClaudeResponseBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
}

// --- Provider configuration ---

struct ProviderConfig {
    endpoint: String,
    commit_model: String,
    nlt_model: String,
    is_claude: bool,
    use_max_completion_tokens: bool,
    supports_temperature: bool,
    commit_max_tokens: u32,
    nlt_max_tokens: u32,
}

fn get_provider_config(provider: &str) -> ProviderConfig {
    match provider {
        "openai" => ProviderConfig {
            endpoint: "https://api.openai.com/v1/chat/completions".into(),
            commit_model: "gpt-5-mini-2025-08-07".into(),
            nlt_model: "gpt-5.2-2025-12-11".into(),
            is_claude: false,
            use_max_completion_tokens: true,
            supports_temperature: false,
            commit_max_tokens: 2048,  // reasoning models need headroom for thinking
            nlt_max_tokens: 4096,
        },
        "claude" => ProviderConfig {
            endpoint: "https://api.anthropic.com/v1/messages".into(),
            commit_model: "claude-sonnet-4-5-20250929".into(),
            nlt_model: "claude-sonnet-4-5-20250929".into(),
            is_claude: true,
            use_max_completion_tokens: false,
            supports_temperature: true,
            commit_max_tokens: 200,
            nlt_max_tokens: 1024,
        },
        _ => ProviderConfig { // "groq" default
            endpoint: "https://api.groq.com/openai/v1/chat/completions".into(),
            commit_model: "llama-3.1-8b-instant".into(),
            nlt_model: "llama-3.3-70b-versatile".into(),
            is_claude: false,
            use_max_completion_tokens: false,
            supports_temperature: true,
            commit_max_tokens: 200,
            nlt_max_tokens: 1024,
        },
    }
}

/// Send a simple (non-tool) request to Claude and return the text response.
async fn claude_simple_request(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    endpoint: &str,
    system: Option<&str>,
    user_message: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let request = ClaudeRequest {
        model: model.to_string(),
        max_tokens,
        system: system.map(|s| s.to_string()),
        messages: vec![ClaudeMessage {
            role: "user".into(),
            content: ClaudeContent::Text(user_message.into()),
        }],
        temperature: Some(temperature),
        tools: None,
    };

    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Claude API error: {}", error_text));
    }

    let claude_response: ClaudeResponse = response.json().await.map_err(|e| e.to_string())?;

    // Extract text from response blocks
    for block in &claude_response.content {
        if let ClaudeResponseBlock::Text { text } = block {
            return Ok(text.clone());
        }
    }
    Err("No text response from Claude".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
struct CommitSuggestion {
    subject: String,
    description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NltResponse {
    command: String,
    explanation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NltProgressEvent {
    request_id: String,
    status: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_name: Option<String>,
    iteration: usize,
}

// Portal commands
#[tauri::command]
fn set_portal_enabled(enabled: bool, state: tauri::State<Arc<AppState>>) {
    *state.portal_enabled.lock() = enabled;
}

#[tauri::command]
fn get_portal_config(state: tauri::State<Arc<AppState>>) -> Result<database::PortalConfig, String> {
    let db = state.database.lock();
    db.get_portal_config()
}

#[tauri::command]
fn set_portal_config(config: database::PortalConfig, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    let db = state.database.lock();
    db.set_portal_config(&config)
}

#[tauri::command]
fn portal_enable(app: tauri::AppHandle, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    let mut config = {
        let db = state.database.lock();
        db.get_portal_config()?
    };

    config.is_enabled = true;

    // Save config
    {
        let db = state.database.lock();
        db.set_portal_config(&config)?;
    }

    *state.portal_enabled.lock() = true;

    // Start portal connection
    let portal = Portal::new(app, config);
    let state_arc: Arc<AppState> = (*state).clone();
    portal.connect(state_arc);
    *state.portal.lock() = Some(portal);

    log::info!("[Portal] Portal enabled and connected");
    Ok(())
}

#[tauri::command]
fn portal_disable(state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    // Update config
    let mut config = {
        let db = state.database.lock();
        db.get_portal_config()?
    };

    config.is_enabled = false;

    {
        let db = state.database.lock();
        db.set_portal_config(&config)?;
    }

    *state.portal_enabled.lock() = false;

    // Disconnect portal
    if let Some(portal) = state.portal.lock().take() {
        portal.disconnect();
    }

    log::info!("[Portal] Portal disabled");
    Ok(())
}

#[tauri::command]
fn portal_regenerate_pairing(app: tauri::AppHandle, state: tauri::State<Arc<AppState>>) -> Result<database::PortalConfig, String> {
    use rand::Rng;
    use rand::seq::SliceRandom;

    let mut config = {
        let db = state.database.lock();
        db.get_portal_config()?
    };

    // Generate new pairing code
    let mut rng = rand::thread_rng();
    config.pairing_code = format!("{:06}", rng.gen_range(0..1000000));

    // Generate new passphrase
    const WORDS: &[&str] = &[
        "apple", "banana", "cherry", "dolphin", "eagle", "forest",
        "garden", "harbor", "island", "jungle", "kitten", "lemon",
        "mountain", "nectar", "ocean", "palace", "quartz", "river",
        "sunset", "temple", "umbrella", "valley", "willow", "yellow",
    ];
    config.pairing_passphrase = (0..6)
        .map(|_| *WORDS.choose(&mut rng).unwrap())
        .collect::<Vec<_>>()
        .join("-");

    // Clear linked devices since passphrase changed
    config.linked_devices.clear();

    // Save config
    {
        let db = state.database.lock();
        db.set_portal_config(&config)?;
    }

    // If connected, reconnect with new credentials
    if config.is_enabled {
        // Disconnect existing
        if let Some(portal) = state.portal.lock().take() {
            portal.disconnect();
        }

        // Reconnect
        let portal = Portal::new(app, config.clone());
        let state_arc: Arc<AppState> = (*state).clone();
        portal.connect(state_arc);
        *state.portal.lock() = Some(portal);
    }

    Ok(config)
}

#[tauri::command]
fn portal_get_status(state: tauri::State<Arc<AppState>>) -> Result<serde_json::Value, String> {
    let is_connected = state.portal.lock().as_ref().map(|p| p.is_connected()).unwrap_or(false);
    let config = {
        let db = state.database.lock();
        db.get_portal_config()?
    };

    Ok(serde_json::json!({
        "isEnabled": config.is_enabled,
        "isConnected": is_connected,
        "deviceId": config.device_id,
        "deviceName": config.device_name,
        "pairingCode": config.pairing_code,
        "linkedDevices": config.linked_devices,
    }))
}

#[tauri::command]
fn portal_send_message(message: serde_json::Value, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    if let Some(portal) = state.portal.lock().as_ref() {
        portal.send_message(&message);
        Ok(())
    } else {
        Err("Portal not connected".to_string())
    }
}

#[tauri::command]
fn portal_register_mobile_terminal(terminal_id: String, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    if let Some(portal) = state.portal.lock().as_ref() {
        portal.add_mobile_terminal(terminal_id.clone());

        // Send any buffered output immediately
        let buffer_data = state
            .terminals
            .lock()
            .get(&terminal_id)
            .map(|t| {
                let buffer = t.output_buffer.lock();
                String::from_utf8_lossy(&buffer).to_string()
            })
            .unwrap_or_default();

        if !buffer_data.is_empty() {
            let msg = serde_json::json!({
                "type": "terminal_output",
                "id": uuid::Uuid::new_v4().to_string(),
                "terminalId": terminal_id,
                "data": buffer_data,
            });
            portal.send_message(&msg);
        }

        Ok(())
    } else {
        Err("Portal not connected".to_string())
    }
}

// AI Shell types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContext {
    #[serde(rename = "projectType")]
    pub project_type: String,
    #[serde(rename = "packageManager")]
    pub package_manager: Option<String>,
    pub scripts: Option<Vec<String>>,
    #[serde(rename = "hasDocker")]
    pub has_docker: bool,
    #[serde(rename = "hasMakefile")]
    pub has_makefile: bool,
    /// Config file snippets for AI to analyze (package.json, pyproject.toml, Cargo.toml, etc.)
    #[serde(rename = "configSnippet")]
    pub config_snippet: Option<String>,
    /// List of config files found in the project
    #[serde(rename = "configFiles")]
    pub config_files: Vec<String>,
    /// Top-level folder structure
    #[serde(rename = "folderStructure")]
    pub folder_structure: Option<String>,
}

#[tauri::command]
async fn generate_commit_message(
    diffs: Vec<FileDiff>,
    api_key: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<CommitSuggestion, String> {
    if api_key.is_empty() {
        return Err("No API key provided".to_string());
    }

    let provider_str = provider.as_deref().unwrap_or("groq");
    let mut config = get_provider_config(provider_str);
    if let Some(m) = model {
        if !m.is_empty() {
            config.commit_model = m.clone();
            config.nlt_model = m;
        }
    }

    // Metadata/config files that should be summarized briefly
    let metadata_patterns = [
        "package.json", "package-lock.json", "Cargo.toml", "Cargo.lock",
        "yarn.lock", "pnpm-lock.yaml", "composer.lock", "Gemfile.lock",
        "poetry.lock", "go.sum", "pubspec.lock", ".version", "version.txt",
        "VERSION", "tauri.conf.json", "app.json",
    ];

    let is_metadata_file = |path: &str| -> bool {
        let filename = path.rsplit('/').next().unwrap_or(path);
        metadata_patterns.iter().any(|p| filename == *p || filename.ends_with(".lock"))
    };

    // Separate diffs into code changes and metadata changes
    let mut code_diffs: Vec<&FileDiff> = Vec::new();
    let mut metadata_diffs: Vec<&FileDiff> = Vec::new();

    for diff in &diffs {
        if is_metadata_file(&diff.path) {
            metadata_diffs.push(diff);
        } else {
            code_diffs.push(diff);
        }
    }

    // Build summary - prioritize code changes
    let mut changes_summary = String::new();

    // First, add code changes with full diffs (up to a limit per file)
    for diff in &code_diffs {
        changes_summary.push_str(&format!("## {} ({})\n", diff.path, diff.status));
        let mut file_lines = 0;
        for hunk in &diff.hunks {
            for line in &hunk.lines {
                if line.line_type == "addition" || line.line_type == "deletion" {
                    let prefix = if line.line_type == "addition" { "+" } else { "-" };
                    changes_summary.push_str(&format!("{}{}\n", prefix, line.content));
                    file_lines += 1;
                    // Limit lines per file to ensure we see all files
                    if file_lines > 50 {
                        changes_summary.push_str("  ... (more changes in this file)\n");
                        break;
                    }
                }
            }
            if file_lines > 50 { break; }
        }
        changes_summary.push('\n');

        // Stop if we're getting too long, but ensure we list remaining files
        if changes_summary.len() > 3000 {
            break;
        }
    }

    // Then summarize metadata files briefly (just list them with key changes)
    if !metadata_diffs.is_empty() {
        changes_summary.push_str("## Metadata/Config changes:\n");
        for diff in &metadata_diffs {
            changes_summary.push_str(&format!("- {} ({})", diff.path, diff.status));
            // For version bumps, try to extract the version change
            if diff.path.contains("package.json") || diff.path.contains("Cargo.toml") || diff.path.contains("tauri.conf") {
                for hunk in &diff.hunks {
                    for line in &hunk.lines {
                        if (line.content.contains("version") || line.content.contains("\"version\""))
                            && (line.line_type == "addition" || line.line_type == "deletion") {
                            let prefix = if line.line_type == "addition" { "+" } else { "-" };
                            changes_summary.push_str(&format!("\n  {}{}", prefix, line.content.trim()));
                        }
                    }
                }
            }
            changes_summary.push('\n');
        }
    }

    // Truncate if still too long
    if changes_summary.len() > 5000 {
        changes_summary = changes_summary[..5000].to_string();
        changes_summary.push_str("\n... (truncated)");
    }

    let prompt = format!(
        r#"Analyze these git changes and generate a commit message.

IMPORTANT: Focus on the actual CODE changes, not just version bumps or lock file updates. If there are both code changes and version/metadata changes, the commit message should describe what the code does, not just "bump version".

Changes:
{}

Respond with JSON only, no markdown:
{{"subject": "short imperative subject line (max 50 chars)", "description": "optional longer description explaining why (can be empty string)"}}

Examples of good subjects: "Add user authentication", "Fix null pointer in parser", "Refactor database queries"
Bad subjects: "Update package.json", "Bump version", "Update dependencies"
Keep the description brief or empty if the subject is self-explanatory."#,
        changes_summary
    );

    let client = reqwest::Client::new();

    let content = if config.is_claude {
        claude_simple_request(
            &client, &api_key, &config.commit_model, &config.endpoint,
            None, &prompt, 0.3, 200,
        ).await?
    } else {
        // OpenAI-compatible path (Groq, OpenAI)
        let request = AiRequest {
            model: config.commit_model.clone(),
            messages: vec![AiMessage::user(&prompt)],
            temperature: if config.supports_temperature { Some(0.3) } else { None },
            max_tokens: if config.use_max_completion_tokens { None } else { Some(config.commit_max_tokens) },
            max_completion_tokens: if config.use_max_completion_tokens { Some(config.commit_max_tokens) } else { None },
            tools: None,
            tool_choice: None,
        };

        let response = client
            .post(&config.endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API error: {}", error_text));
        }

        let ai_response: AiResponse = response.json().await.map_err(|e| e.to_string())?;

        ai_response.choices.first()
            .and_then(|c| c.message.content.clone())
            .ok_or_else(|| "No response from AI".to_string())?
    };

    // Strip markdown code fences if present (e.g., ```json ... ```)
    let json_content = content
        .trim()
        .strip_prefix("```json")
        .or_else(|| content.trim().strip_prefix("```"))
        .unwrap_or(content.trim())
        .trim()
        .strip_suffix("```")
        .unwrap_or(content.trim())
        .trim();

    // Parse the JSON response
    let suggestion: CommitSuggestion = serde_json::from_str(json_content)
        .map_err(|e| format!("Failed to parse AI response: {} - Content: {}", e, json_content))?;
    Ok(suggestion)
}

#[tauri::command]
fn test_ai_connection(
    _provider: String,
    _api_key: String,
    _model: String,
    _endpoint: Option<String>,
) -> Result<(), String> {
    Ok(())
}

// Helper function to detect project context from filesystem
fn detect_project_context(path: &std::path::Path) -> ProjectContext {
    use std::fs;

    let mut snippets: Vec<String> = Vec::new();
    let mut config_files: Vec<String> = Vec::new();

    // Read common config files if they exist (just include their content)
    let files_to_check = [
        ("package.json", 100),
        ("Cargo.toml", 50),
        ("pyproject.toml", 60),
        ("go.mod", 30),
        ("Makefile", 40),
        ("CMakeLists.txt", 40),
    ];

    for (filename, max_lines) in files_to_check {
        let file_path = path.join(filename);
        if file_path.exists() {
            config_files.push(filename.to_string());
            if let Ok(content) = fs::read_to_string(&file_path) {
                let snippet: String = content.lines().take(max_lines).collect::<Vec<_>>().join("\n");
                snippets.push(format!("=== {} ===\n{}", filename, snippet));
            }
        }
    }

    // Check src-tauri for tauri.conf.json
    let tauri_conf_path = path.join("src-tauri/tauri.conf.json");
    if tauri_conf_path.exists() {
        config_files.push("src-tauri/tauri.conf.json".to_string());
        if let Ok(content) = fs::read_to_string(&tauri_conf_path) {
            let snippet: String = content.lines().take(30).collect::<Vec<_>>().join("\n");
            snippets.push(format!("=== src-tauri/tauri.conf.json ===\n{}", snippet));
        }
    }

    let config_snippet = if snippets.is_empty() { None } else { Some(snippets.join("\n\n")) };

    // Get top-level folder structure
    let folder_structure = if let Ok(entries) = fs::read_dir(path) {
        let mut items: Vec<String> = Vec::new();

        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if entry.path().is_dir() {
                items.push(format!("{}/", name));
            } else {
                items.push(name);
            }
        }

        items.sort();
        if items.is_empty() { None } else { Some(items.join("\n")) }
    } else {
        None
    };

    ProjectContext {
        project_type: "unknown".to_string(),
        package_manager: None,
        scripts: None,
        has_docker: path.join("Dockerfile").exists(),
        has_makefile: path.join("Makefile").exists(),
        config_snippet,
        config_files,
        folder_structure,
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory: {}", e))
}

// Project file commands for .orca files (Issue #6)
#[tauri::command]
fn save_project_file(path: String, data: ProjectFileData) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    std::fs::write(&path, &json)
        .map_err(|e| format!("Failed to write project file: {}", e))
}

#[tauri::command]
fn load_project_file(path: String) -> Result<ProjectFileData, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read project file: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse project file: {}", e))
}

#[tauri::command]
fn scan_project_context(cwd: String, _force_refresh: Option<bool>) -> Result<ProjectContext, String> {
    use std::path::Path;

    let path = Path::new(&cwd);
    let context = detect_project_context(path);

    Ok(context)
}

// --- NLT Tool Calling Helpers ---

/// Resolve a relative path against cwd and validate it doesn't escape the project root.
fn resolve_and_validate_path(cwd: &str, rel_path: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(cwd).canonicalize().map_err(|e| format!("Invalid cwd: {}", e))?;
    let resolved = base.join(rel_path).canonicalize()
        .map_err(|e| format!("Path not found: {} ({})", rel_path, e))?;
    if !resolved.starts_with(&base) {
        return Err(format!("Access denied: path '{}' is outside the project directory", rel_path));
    }
    Ok(resolved)
}

/// Flat directory listing suitable for LLM consumption.
fn list_directory_flat(path: &std::path::Path, max_depth: usize) -> Result<String, String> {
    use std::fs;
    let mut lines = Vec::new();
    let skip_dirs = ["node_modules", "target", "__pycache__", "dist", "build", ".git", ".next", "vendor"];

    fn walk(dir: &std::path::Path, base: &std::path::Path, depth: usize, max_depth: usize, skip: &[&str], out: &mut Vec<String>) {
        if depth > max_depth { return; }
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        let mut items: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        items.sort_by_key(|e| e.file_name());
        for entry in items {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".env.example" { continue; }
            if skip.iter().any(|s| *s == name) { continue; }
            let rel = entry.path().strip_prefix(base).map(|p| p.to_string_lossy().to_string()).unwrap_or(name.clone());
            let is_dir = entry.path().is_dir();
            let prefix = "  ".repeat(depth);
            if is_dir {
                out.push(format!("{}{}/", prefix, rel.rsplit('/').next().unwrap_or(&rel)));
                walk(&entry.path(), base, depth + 1, max_depth, skip, out);
            } else {
                out.push(format!("{}{}", prefix, rel.rsplit('/').next().unwrap_or(&rel)));
            }
            if out.len() > 500 { return; }
        }
    }

    walk(path, path, 0, max_depth, &skip_dirs, &mut lines);
    if lines.len() > 500 {
        lines.truncate(500);
        lines.push("... (truncated)".to_string());
    }
    Ok(lines.join("\n"))
}

/// Execute a tool call and return the result as a string.
fn execute_tool_call(tool_name: &str, arguments_json: &str, cwd: &str) -> String {
    let args: serde_json::Value = match serde_json::from_str(arguments_json) {
        Ok(v) => v,
        Err(e) => return format!("Error parsing arguments: {}", e),
    };

    match tool_name {
        "read_file" => {
            let rel_path = args["path"].as_str().unwrap_or("");
            match resolve_and_validate_path(cwd, rel_path) {
                Ok(abs) => {
                    match std::fs::read_to_string(&abs) {
                        Ok(content) => {
                            if content.len() > 102_400 {
                                format!("{}\n... (file truncated at 100KB, total size: {} bytes)", &content[..102_400], content.len())
                            } else {
                                content
                            }
                        }
                        Err(e) => format!("Error reading file: {}", e),
                    }
                }
                Err(e) => e,
            }
        }
        "search_files" => {
            let query = args["query"].as_str().unwrap_or("");
            let sub_path = args["path"].as_str().unwrap_or(".");
            let search_root = match resolve_and_validate_path(cwd, sub_path) {
                Ok(p) => p.to_string_lossy().to_string(),
                Err(e) => return e,
            };
            match search_file_contents(search_root, query.to_string(), false, Some(50)) {
                Ok(result) => {
                    if result.matches.is_empty() {
                        "No matches found.".to_string()
                    } else {
                        let mut out = String::new();
                        for m in &result.matches {
                            out.push_str(&format!("{}:{}: {}\n", m.path, m.line_number, m.line.trim()));
                        }
                        if result.truncated {
                            out.push_str("... (results truncated)\n");
                        }
                        out
                    }
                }
                Err(e) => format!("Search error: {}", e),
            }
        }
        "list_files" => {
            let rel_path = args["path"].as_str().unwrap_or(".");
            let depth = args["depth"].as_u64().unwrap_or(2).min(3) as usize;
            match resolve_and_validate_path(cwd, rel_path) {
                Ok(abs) => list_directory_flat(&abs, depth).unwrap_or_else(|e| format!("Error: {}", e)),
                Err(e) => e,
            }
        }
        "get_git_status" => {
            match GitService::get_status(cwd) {
                Ok(status) => {
                    let mut out = format!("Branch: {}\n", status.branch);
                    if status.ahead > 0 { out.push_str(&format!("Ahead: {}\n", status.ahead)); }
                    if status.behind > 0 { out.push_str(&format!("Behind: {}\n", status.behind)); }
                    if !status.staged.is_empty() {
                        out.push_str(&format!("Staged ({}):\n", status.staged.len()));
                        for f in &status.staged { out.push_str(&format!("  {}\n", f)); }
                    }
                    if !status.unstaged.is_empty() {
                        out.push_str(&format!("Unstaged ({}):\n", status.unstaged.len()));
                        for f in &status.unstaged { out.push_str(&format!("  {}\n", f)); }
                    }
                    if !status.untracked.is_empty() {
                        out.push_str(&format!("Untracked ({}):\n", status.untracked.len()));
                        for f in &status.untracked { out.push_str(&format!("  {}\n", f)); }
                    }
                    if status.staged.is_empty() && status.unstaged.is_empty() && status.untracked.is_empty() {
                        out.push_str("Working tree clean\n");
                    }
                    out
                }
                Err(e) => format!("Not a git repository or error: {}", e),
            }
        }
        _ => format!("Unknown tool: {}", tool_name),
    }
}

/// Build NLT tool definitions for the Groq API.
fn build_nlt_tools() -> Vec<Tool> {
    vec![
        Tool {
            tool_type: "function".into(),
            function: ToolFunction {
                name: "read_file".into(),
                description: "Read the contents of a file. Use this to inspect config files, scripts, source code, etc.".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path to the file from the project root"
                        }
                    },
                    "required": ["path"]
                }),
            },
        },
        Tool {
            tool_type: "function".into(),
            function: ToolFunction {
                name: "search_files".into(),
                description: "Search for a text pattern across project files (case-insensitive grep). Returns matching file paths, line numbers, and line contents.".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The text pattern to search for"
                        },
                        "path": {
                            "type": "string",
                            "description": "Subdirectory to search within (relative to project root, defaults to '.')"
                        }
                    },
                    "required": ["query"]
                }),
            },
        },
        Tool {
            tool_type: "function".into(),
            function: ToolFunction {
                name: "list_files".into(),
                description: "List files and directories in a given path. Returns a tree-like flat listing.".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path to list (defaults to '.')"
                        },
                        "depth": {
                            "type": "integer",
                            "description": "Maximum depth to recurse (1-3, defaults to 2)"
                        }
                    },
                    "required": []
                }),
            },
        },
        Tool {
            tool_type: "function".into(),
            function: ToolFunction {
                name: "get_git_status".into(),
                description: "Get the current git status: branch name, staged/unstaged/untracked files, ahead/behind counts.".into(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {},
                    "required": []
                }),
            },
        },
    ]
}

/// Build the enhanced NLT system prompt.
fn build_nlt_system_prompt(shell_name: &str, folder_info: &str, config_info: &str) -> String {
    let os_name = if cfg!(target_os = "macos") { "macOS" }
        else if cfg!(target_os = "linux") { "Linux" }
        else { "Windows" };

    format!(
        r#"You are a terminal command assistant running on {os_name} with {shell_name} shell.
You help users by suggesting the right terminal command for their request.

You have tools to gather context about the project before suggesting a command. Use them when you need to understand the project structure, read config files, check git status, or search for relevant code.

## Guidelines
- **Safety**: Never suggest destructive commands (rm -rf /, drop database, force push to main) without a clear warning. Prefer reversible operations. Never expose secrets inline.
- **VCS awareness**: Consider the git status when relevant. Suggest standard git workflows.
- **Command quality**: Return shell-compatible commands for {shell_name}. Use project tools (npm/cargo/make/etc.) when available. Chain related commands with &&.
- **Tool usage**: If the user's request is simple and obvious (e.g., "list files"), respond directly. For anything project-specific (e.g., "run the app", "run the tests", "build"), ALWAYS use tools first to read config files (package.json, Cargo.toml, Makefile, etc.) and understand the actual project setup before suggesting a command. Do NOT guess based on folder structure alone.
- **Framework awareness**: Many projects use meta-frameworks (e.g., Tauri wraps a web app — use `npm run tauri dev` not `npm run dev`; Next.js has `next dev` not `vite`). When you see a src-tauri/ directory, this is a Tauri app. Read the relevant configs to find the correct dev/build commands.
- **Efficiency**: Don't call tools unnecessarily. 1-3 tool calls should usually be enough.

## Project Context
{folder_info}
{config_info}

## Critical Rules
- NEVER ask clarifying questions. NEVER present multiple options to the user. NEVER be conversational.
- You MUST always pick the single most likely command and return it.
- If the request is ambiguous (e.g., "run this"), use your tools to inspect the project and choose the best command (e.g., for a Tauri app, choose `npm run tauri dev`).
- Do NOT explain your reasoning. Do NOT describe what you found. Do NOT narrate your thought process.
- Your ENTIRE response must be a single JSON object. No prose before or after it. No markdown fences.

## Response Format
Respond with ONLY this JSON (nothing else):
{{"command": "the shell command", "explanation": "brief optional explanation"}}"#,
        os_name = os_name,
        shell_name = shell_name,
        folder_info = folder_info,
        config_info = config_info
    )
}

/// Try to extract a JSON object containing "command" from a string that may have prose around it.
fn extract_json_object(text: &str) -> Option<NltResponse> {
    // Find the first '{' and try progressively larger substrings ending at each '}'
    let start = text.find('{')?;
    for (i, c) in text[start..].char_indices() {
        if c == '}' {
            let candidate = &text[start..start + i + 1];
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(candidate) {
                if let Some(cmd) = val.get("command").and_then(|v| v.as_str()) {
                    return Some(NltResponse {
                        command: cmd.to_string(),
                        explanation: val.get("explanation").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
                }
            }
        }
    }
    None
}

/// Parse the LLM's final response into an NltResponse, with fallback for plain text.
fn parse_final_response(content: &str) -> NltResponse {
    let trimmed = content.trim();

    // Try stripping markdown fences
    let json_str = trimmed
        .strip_prefix("```json").or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .strip_suffix("```")
        .unwrap_or(trimmed)
        .trim();

    // Try parsing as JSON NltResponse directly
    if let Ok(resp) = serde_json::from_str::<NltResponse>(json_str) {
        return resp;
    }

    // Try parsing as a JSON object with "command"
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
        if let Some(cmd) = val.get("command").and_then(|v| v.as_str()) {
            return NltResponse {
                command: cmd.to_string(),
                explanation: val.get("explanation").and_then(|v| v.as_str()).map(|s| s.to_string()),
            };
        }
    }

    // Try extracting JSON from surrounding prose (models often add reasoning text)
    if let Some(resp) = extract_json_object(trimmed) {
        return resp;
    }

    // Fallback: treat entire content as a raw command
    let command = trimmed
        .trim_matches('`')
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string();
    NltResponse { command, explanation: None }
}

#[tauri::command]
async fn ai_shell_command(
    request: String,
    context: ProjectContext,
    cwd: String,
    api_key: String,
    provider: Option<String>,
    model: Option<String>,
    request_id: String,
    app_handle: tauri::AppHandle,
) -> Result<NltResponse, String> {
    if api_key.is_empty() {
        return Err("No API key provided. Set your API key in Settings.".to_string());
    }

    let provider_str = provider.as_deref().unwrap_or("groq");
    let mut prov_config = get_provider_config(provider_str);
    if let Some(m) = model {
        if !m.is_empty() {
            prov_config.commit_model = m.clone();
            prov_config.nlt_model = m;
        }
    }

    // Detect the user's default shell
    let default_shell = std::env::var("SHELL").unwrap_or_else(|_| {
        #[cfg(target_os = "macos")]
        { "/bin/zsh".to_string() }
        #[cfg(target_os = "linux")]
        { "/bin/bash".to_string() }
        #[cfg(target_os = "windows")]
        { "powershell.exe".to_string() }
    });
    let shell_name = default_shell.rsplit('/').next().unwrap_or(&default_shell);

    let config_info = context.config_snippet.clone()
        .map(|s| format!("\n{}", s))
        .unwrap_or_default();
    let folder_info = context.folder_structure.clone()
        .map(|s| format!("\n=== Project structure ===\n{}", s))
        .unwrap_or_default();

    let system_prompt = build_nlt_system_prompt(shell_name, &folder_info, &config_info);
    let user_msg = format!("User request: {}", request);

    let client = reqwest::Client::new();
    let max_iterations = 8;
    let started = std::time::Instant::now();
    let timeout = Duration::from_secs(30);

    // Emit initial progress
    let _ = app_handle.emit("nlt-progress", NltProgressEvent {
        request_id: request_id.clone(),
        status: "thinking".into(),
        message: "Analyzing your request...".into(),
        tool_name: None,
        iteration: 0,
    });

    if prov_config.is_claude {
        // --- Claude tool-calling path ---
        let claude_tools: Vec<ClaudeTool> = build_nlt_tools().into_iter().map(|t| ClaudeTool {
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
        }).collect();

        let mut claude_messages: Vec<ClaudeMessage> = vec![
            ClaudeMessage { role: "user".into(), content: ClaudeContent::Text(user_msg.clone()) },
        ];

        for iteration in 0..max_iterations {
            if started.elapsed() > timeout {
                let _ = app_handle.emit("nlt-progress", NltProgressEvent {
                    request_id: request_id.clone(),
                    status: "error".into(),
                    message: "Request timed out after 30 seconds".into(),
                    tool_name: None,
                    iteration,
                });
                return Err("Request timed out after 30 seconds".to_string());
            }

            let claude_request = ClaudeRequest {
                model: prov_config.nlt_model.clone(),
                max_tokens: 1024,
                system: Some(system_prompt.clone()),
                messages: claude_messages.clone(),
                temperature: Some(0.1),
                tools: Some(claude_tools.clone()),
            };

            let response = client
                .post(&prov_config.endpoint)
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .json(&claude_request)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("API error: {}", error_text));
            }

            let claude_response: ClaudeResponse = response.json().await.map_err(|e| e.to_string())?;
            let stop_reason = claude_response.stop_reason.as_deref().unwrap_or("end_turn");

            // Check if we have tool_use blocks
            let tool_uses: Vec<&ClaudeResponseBlock> = claude_response.content.iter()
                .filter(|b| matches!(b, ClaudeResponseBlock::ToolUse { .. }))
                .collect();

            if stop_reason == "tool_use" && !tool_uses.is_empty() {
                // Build assistant message with all response blocks
                let assistant_blocks: Vec<ClaudeContentBlock> = claude_response.content.iter().map(|b| {
                    match b {
                        ClaudeResponseBlock::Text { text } => ClaudeContentBlock::Text { text: text.clone() },
                        ClaudeResponseBlock::ToolUse { id, name, input } => ClaudeContentBlock::ToolUse {
                            id: id.clone(), name: name.clone(), input: input.clone(),
                        },
                    }
                }).collect();

                claude_messages.push(ClaudeMessage {
                    role: "assistant".into(),
                    content: ClaudeContent::Blocks(assistant_blocks),
                });

                // Execute each tool call and build tool_result blocks
                let mut result_blocks: Vec<ClaudeContentBlock> = Vec::new();
                for tu in &tool_uses {
                    if let ClaudeResponseBlock::ToolUse { id, name, input } = tu {
                        println!("[NLT] Claude tool call: {}({})", name, input);

                        let _ = app_handle.emit("nlt-progress", NltProgressEvent {
                            request_id: request_id.clone(),
                            status: "tool_call".into(),
                            message: format!("Calling {}...", name),
                            tool_name: Some(name.clone()),
                            iteration: iteration + 1,
                        });

                        let args_str = serde_json::to_string(input).unwrap_or_default();
                        let result = execute_tool_call(name, &args_str, &cwd);
                        let result = if result.len() > 30_000 {
                            format!("{}\n... (output truncated)", &result[..30_000])
                        } else {
                            result
                        };

                        result_blocks.push(ClaudeContentBlock::ToolResult {
                            tool_use_id: id.clone(),
                            content: result,
                        });
                    }
                }

                claude_messages.push(ClaudeMessage {
                    role: "user".into(),
                    content: ClaudeContent::Blocks(result_blocks),
                });
                continue;
            }

            // Final text response
            let text = claude_response.content.iter()
                .filter_map(|b| if let ClaudeResponseBlock::Text { text } = b { Some(text.as_str()) } else { None })
                .collect::<Vec<_>>()
                .join("");

            let nlt_response = parse_final_response(&text);

            let _ = app_handle.emit("nlt-progress", NltProgressEvent {
                request_id: request_id.clone(),
                status: "done".into(),
                message: "Command ready".into(),
                tool_name: None,
                iteration: iteration + 1,
            });

            println!("[NLT] Final response: {:?}", nlt_response);
            return Ok(nlt_response);
        }

        let _ = app_handle.emit("nlt-progress", NltProgressEvent {
            request_id: request_id.clone(),
            status: "error".into(),
            message: "Too many tool-calling iterations".into(),
            tool_name: None,
            iteration: max_iterations,
        });
        Err("AI used too many tool calls without producing a final answer".to_string())
    } else {
        // --- OpenAI-compatible path (Groq, OpenAI) ---
        let mut messages = vec![
            AiMessage::system(&system_prompt),
            AiMessage::user(&user_msg),
        ];

        let tools = build_nlt_tools();
        let mut use_tools = true;

        for iteration in 0..max_iterations {
            if started.elapsed() > timeout {
                let _ = app_handle.emit("nlt-progress", NltProgressEvent {
                    request_id: request_id.clone(),
                    status: "error".into(),
                    message: "Request timed out after 30 seconds".into(),
                    tool_name: None,
                    iteration,
                });
                return Err("Request timed out after 30 seconds".to_string());
            }

            let ai_request = AiRequest {
                model: prov_config.nlt_model.clone(),
                messages: messages.clone(),
                temperature: if prov_config.supports_temperature { Some(0.1) } else { None },
                max_tokens: if prov_config.use_max_completion_tokens { None } else { Some(prov_config.nlt_max_tokens) },
                max_completion_tokens: if prov_config.use_max_completion_tokens { Some(prov_config.nlt_max_tokens) } else { None },
                tools: if use_tools { Some(tools.clone()) } else { None },
                tool_choice: None,
            };

            let response = client
                .post(&prov_config.endpoint)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&ai_request)
                .send()
                .await
                .map_err(|e| e.to_string())?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();

                // If tool calling failed, retry without tools
                if use_tools && (error_text.contains("tool_use_failed") || error_text.contains("tool call validation")) {
                    println!("[NLT] Tool call validation failed, retrying without tools");
                    let _ = app_handle.emit("nlt-progress", NltProgressEvent {
                        request_id: request_id.clone(),
                        status: "thinking".into(),
                        message: "Retrying without tools...".into(),
                        tool_name: None,
                        iteration: iteration + 1,
                    });
                    use_tools = false;
                    messages.truncate(2);
                    continue;
                }

                return Err(format!("API error: {}", error_text));
            }

            let ai_response: AiResponse = response.json().await.map_err(|e| e.to_string())?;
            let choice = ai_response.choices.into_iter().next()
                .ok_or("No response from AI")?;

            let finish_reason = choice.finish_reason.as_deref().unwrap_or("stop");

            if finish_reason == "tool_calls" {
                if let Some(tool_calls) = &choice.message.tool_calls {
                    messages.push(choice.message.clone());

                    for tc in tool_calls {
                        let tool_name = &tc.function.name;
                        println!("[NLT] Tool call: {}({})", tool_name, &tc.function.arguments);

                        let _ = app_handle.emit("nlt-progress", NltProgressEvent {
                            request_id: request_id.clone(),
                            status: "tool_call".into(),
                            message: format!("Calling {}...", tool_name),
                            tool_name: Some(tool_name.clone()),
                            iteration: iteration + 1,
                        });

                        let result = execute_tool_call(tool_name, &tc.function.arguments, &cwd);
                        let result = if result.len() > 30_000 {
                            format!("{}\n... (output truncated)", &result[..30_000])
                        } else {
                            result
                        };

                        messages.push(AiMessage::tool_result(&tc.id, tool_name, &result));
                    }
                    continue;
                }
            }

            // finish_reason == "stop" or no tool calls - parse final response
            let content = choice.message.content.as_deref().unwrap_or("");
            let nlt_response = parse_final_response(content);

            let _ = app_handle.emit("nlt-progress", NltProgressEvent {
                request_id: request_id.clone(),
                status: "done".into(),
                message: "Command ready".into(),
                tool_name: None,
                iteration: iteration + 1,
            });

            println!("[NLT] Final response: {:?}", nlt_response);
            return Ok(nlt_response);
        }

        let _ = app_handle.emit("nlt-progress", NltProgressEvent {
            request_id: request_id.clone(),
            status: "error".into(),
            message: "Too many tool-calling iterations".into(),
            tool_name: None,
            iteration: max_iterations,
        });
        Err("AI used too many tool calls without producing a final answer".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("orca");
    std::fs::create_dir_all(&data_dir).ok();

    let db = Database::new(data_dir.join("orca.db"))
        .expect("Failed to initialize database");

    // Load portal config from database
    let portal_config = db.get_portal_config().unwrap_or_default();
    let portal_was_enabled = portal_config.is_enabled;

    let state = Arc::new(AppState {
        terminals: Mutex::new(HashMap::new()),
        database: Mutex::new(db),
        portal_enabled: Mutex::new(portal_was_enabled),
        git_watchers: Mutex::new(HashMap::new()),
        file_watchers: Mutex::new(HashMap::new()),
        portal: Mutex::new(None),
    });
    let state_for_window_event = state.clone();
    let state_for_portal = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            // Debug
            debug_log,
            get_home_dir,
            request_microphone_permission,
            // Terminal
            spawn_terminal,
            write_terminal,
            write_terminal_bytes,
            resize_terminal,
            kill_terminal,
            kill_terminals,
            list_terminals,
            clear_terminals,
            get_terminal_buffer,
            // Git
            is_git_repo,
            get_status,
            get_diff,
            commit,
            get_branches,
            checkout_branch,
            create_branch,
            get_history,
            get_commit_diff,
            discard_file,
            add_to_gitignore,
            get_remote_url,
            discard_hunk,
            edit_file_line,
            checkout_commit,
            reset_to_commit,
            revert_commit,
            init_repo,
            clone_repo,
            fetch_remote,
            pull_remote,
            push_remote,
            publish_branch,
            watch_repo,
            unwatch_repo,
            list_worktrees,
            create_worktree,
            remove_worktree,
            prune_worktrees,
            lock_worktree,
            unlock_worktree,
            // Project
            add_project,
            remove_project,
            get_project,
            get_all_projects,
            // File system
            open_folder_dialog,
            open_in_finder,
            reveal_in_file_manager,
            open_file_in_editor,
            open_in_terminal_editor,
            list_directories,
            get_shell_history,
            record_project_command,
            get_project_shell_history,
            get_file_tree,
            search_file_contents,
            delete_file,
            rename_file,
            save_clipboard_image,
            read_text_file,
            write_text_file,
            create_directory,
            watch_project_files,
            unwatch_project_files,
            save_project_file,
            load_project_file,
            // Assistants
            check_installed_assistants,
            check_commands_installed,
            install_assistant,
            // AI
            generate_commit_message,
            test_ai_connection,
            scan_project_context,
            ai_shell_command,
            // Portal
            set_portal_enabled,
            get_portal_config,
            set_portal_config,
            portal_enable,
            portal_disable,
            portal_regenerate_pairing,
            portal_get_status,
            portal_send_message,
            portal_register_mobile_terminal,
        ])
        .setup(move |app| {
            // Warm up the PTY system early to avoid first-spawn delays
            // This initializes the native PTY interface before any terminal is created
            std::thread::spawn(|| {
                let _ = native_pty_system();
            });

            // Portal is disabled for now
            // if portal_was_enabled {
            //     log::info!("[Portal] Starting portal connection (was enabled on last run)");
            //     let portal = Portal::new(app.handle().clone(), portal_config);
            //     let state_clone = state_for_portal.clone();
            //     portal.connect(state_clone);
            //     *state_for_portal.portal.lock() = Some(portal);
            // }

            // System tray icon (disabled for now - was used for portal background mode)
            // let new_window_item = MenuItemBuilder::with_id("new_window", "New Window").build(app)?;
            // let show_item = MenuItemBuilder::with_id("show", "Show Orca").build(app)?;
            // let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            // let tray_menu = MenuBuilder::new(app)
            //     .item(&new_window_item)
            //     .item(&show_item)
            //     .separator()
            //     .item(&quit_item)
            //     .build()?;
            // let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
            //     .expect("Failed to load tray icon");
            // let _tray = TrayIconBuilder::new()
            //     .icon(tray_icon)
            //     .menu(&tray_menu)
            //     .tooltip("Orca - Running in background")
            //     .on_menu_event(|app, event| {
            //         match event.id().as_ref() {
            //             "new_window" => { /* ... */ }
            //             "show" => { /* ... */ }
            //             "quit" => { app.exit(0); }
            //             _ => {}
            //         }
            //     })
            //     .on_tray_icon_event(|tray, event| { /* ... */ })
            //     .build(app)?;

            // Create custom macOS menu with proper app name
            #[cfg(target_os = "macos")]
            {
                let check_for_updates_item = MenuItemBuilder::with_id("check_for_updates", "Check for Updates...").build(app)?;
                let app_menu = Submenu::with_items(
                    app,
                    "Orca",
                    true,
                    &[
                        &PredefinedMenuItem::about(app, Some("About Orca"), None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &check_for_updates_item,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, Some("Hide Orca"))?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, Some("Quit Orca"))?,
                    ],
                )?;

                let edit_menu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None)?,
                        &PredefinedMenuItem::redo(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None)?,
                        &PredefinedMenuItem::copy(app, None)?,
                        &PredefinedMenuItem::paste(app, None)?,
                        &PredefinedMenuItem::select_all(app, None)?,
                    ],
                )?;

                let window_menu = Submenu::with_items(
                    app,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app, None)?,
                        &PredefinedMenuItem::maximize(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::close_window(app, None)?,
                    ],
                )?;

                let menu = Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])?;
                app.set_menu(menu)?;
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "check_for_updates" {
                let _ = app.emit("check-for-updates", ());
            }
        })
        .on_window_event(move |window, event| {
            // Only minimize to tray for the main window when portal mode is enabled
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let portal_enabled = *state_for_window_event.portal_enabled.lock();
                    if portal_enabled {
                        // Hide the main window instead of closing it (tray mode)
                        let _ = window.hide();
                        api.prevent_close();
                    }
                }
                // Secondary windows and non-portal mode close normally
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // Handle dock icon click on macOS when no windows are visible
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = &_event {
                if !has_visible_windows {
                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.emit("navigate-home", ());
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }

            // Handle file associations - when a .orca file is double-clicked (macOS only)
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    // Convert URL to file path
                    if let Ok(path) = url.to_file_path() {
                        if let Some(ext) = path.extension() {
                            if ext == "orca" {
                                if let Some(path_str) = path.to_str() {
                                    // Show and focus the main window
                                    if let Some(window) = _app_handle.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        // Emit event to frontend to open the workspace file
                                        let _ = window.emit("open-workspace-file", path_str);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
}
