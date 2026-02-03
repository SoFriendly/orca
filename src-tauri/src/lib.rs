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
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use uuid::Uuid;

mod database;
mod git;

use database::Database;
use git::GitService;

// Types for IPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: String,
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
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
}

// Terminal state management
struct TerminalState {
    pty_pair: PtyPair,
    writer: Box<dyn Write + Send>,
    title: String,  // Command/title for display
    cwd: String,    // Working directory
    output_buffer: Arc<Mutex<Vec<u8>>>,  // Buffer for recent output (for mobile attach)
}

const MAX_OUTPUT_BUFFER_SIZE: usize = 100 * 1024; // 100KB buffer

// Terminal info for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
}

// Git watcher state - holds the debouncer and stop signal
struct GitWatcher {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    _stop_tx: std::sync::mpsc::Sender<()>,
}

struct AppState {
    terminals: Mutex<HashMap<String, TerminalState>>,
    database: Mutex<Database>,
    portal_enabled: Mutex<bool>,
    git_watchers: Mutex<HashMap<String, GitWatcher>>,
}

// Debug command to print to terminal
#[tauri::command]
fn debug_log(message: String) {
    println!("[DEBUG] {}", message);
}

// Terminal commands
#[tauri::command]
fn spawn_terminal(
    shell: String,
    cwd: String,
    cols: Option<u16>,
    rows: Option<u16>,
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

    println!("DEBUG spawn_terminal - shell: {:?}", shell);

    let mut cmd = if shell.is_empty() {
        // Use default shell
        let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
            #[cfg(target_os = "macos")]
            { "/bin/zsh".to_string() }
            #[cfg(target_os = "linux")]
            { "/bin/bash".to_string() }
            #[cfg(target_os = "windows")]
            { "powershell.exe".to_string() }
        });
        CommandBuilder::new(shell_path)
    } else {
        // Parse the shell command
        let parts: Vec<&str> = shell.split_whitespace().collect();
        if parts.is_empty() {
            return Err("Empty command".to_string());
        }

        // Resolve full path for the command if it's not already an absolute path
        let command = parts[0];
        let resolved_command = if command.contains('/') {
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
            // Command not found in PATH - run through user's login shell
            // This ensures shell profile is sourced and command can be found
            let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
                #[cfg(target_os = "macos")]
                { "/bin/zsh".to_string() }
                #[cfg(target_os = "linux")]
                { "/bin/bash".to_string() }
                #[cfg(target_os = "windows")]
                { "powershell.exe".to_string() }
            });

            println!("DEBUG spawn_terminal - running through shell: {} -ilc 'exec {}'", shell_path, shell);

            let mut cmd = CommandBuilder::new(&shell_path);
            cmd.args(["-i", "-l", "-c", &format!("exec {}", shell)]);
            cmd
        }
    };

    cmd.cwd(&cwd);

    // Set UTF-8 locale for proper Unicode rendering
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Build a comprehensive PATH that includes common tool locations
    // This ensures brew, nvm, pyenv, etc. are available when .zshrc sources them
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users".to_string());
    let current_path = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "macos")]
    {
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
    }

    #[cfg(target_os = "linux")]
    {
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

    let mut child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let writer = pty_pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pty_pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let terminal_id = id.clone();
    let handle = app_handle.clone();
    let state_for_read = state.inner().clone();

    // Create output buffer for mobile attach replay
    let output_buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(MAX_OUTPUT_BUFFER_SIZE)));
    let output_buffer_clone = output_buffer.clone();

    // Spawn thread to read terminal output
    thread::spawn(move || {
        let mut buffer = [0u8; 16384]; // Larger buffer for better throughput
        let event_name = format!("terminal-output-{}", terminal_id);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    // Only buffer output if portal mode is enabled (for mobile attach replay)
                    if *state_for_read.portal_enabled.lock() {
                        let mut buf = output_buffer_clone.lock();
                        buf.extend_from_slice(&buffer[..n]);
                        // Trim if over max size (keep most recent data)
                        if buf.len() > MAX_OUTPUT_BUFFER_SIZE {
                            let excess = buf.len() - MAX_OUTPUT_BUFFER_SIZE;
                            buf.drain(0..excess);
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
                Err(_) => break,
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

    let terminal_state = TerminalState {
        pty_pair,
        writer,
        title,
        cwd: cwd.clone(),
        output_buffer,
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
fn resize_terminal(
    id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<Arc<AppState>>,
) -> Result<(), String> {
    let terminals = state.terminals.lock();
    if let Some(terminal) = terminals.get(&id) {
        terminal
            .pty_pair
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

#[tauri::command]
fn kill_terminal(id: String, state: tauri::State<Arc<AppState>>) -> Result<(), String> {
    state.terminals.lock().remove(&id);
    Ok(())
}

#[tauri::command]
fn list_terminals(state: tauri::State<Arc<AppState>>) -> Vec<TerminalInfo> {
    let terminals = state.terminals.lock();
    println!("[list_terminals] Found {} terminals", terminals.len());
    terminals
        .iter()
        .map(|(id, t)| {
            println!("[list_terminals] Terminal: {} title={} cwd={}", id, t.title, t.cwd);
            TerminalInfo {
                id: id.clone(),
                title: t.title.clone(),
                cwd: t.cwd.clone(),
            }
        })
        .collect()
}

#[tauri::command]
fn clear_terminals(state: tauri::State<Arc<AppState>>) {
    let mut terminals = state.terminals.lock();
    terminals.clear();
    println!("[clear_terminals] Cleared all terminals");
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
fn commit(repo_path: String, message: String) -> Result<(), String> {
    GitService::commit(&repo_path, &message)
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
fn discard_file(repo_path: String, file_path: String) -> Result<(), String> {
    GitService::discard_file(&repo_path, &file_path)
}

#[tauri::command]
fn add_to_gitignore(repo_path: String, pattern: String) -> Result<(), String> {
    GitService::add_to_gitignore(&repo_path, &pattern)
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
fn get_file_tree(path: String) -> Result<Vec<FileTreeNode>, String> {
    use std::fs;
    use std::path::Path;

    fn build_tree(dir_path: &Path, base_path: &Path, depth: usize) -> Result<Vec<FileTreeNode>, String> {
        if depth > 10 {
            return Ok(vec![]); // Limit depth to prevent infinite recursion
        }

        let mut nodes = Vec::new();
        let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files/dirs and common ignore patterns
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" || name == "dist" || name == "build" {
                continue;
            }

            let relative_path = path.strip_prefix(base_path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| name.clone());

            let is_dir = path.is_dir();
            let children = if is_dir {
                Some(build_tree(&path, base_path, depth + 1)?)
            } else {
                None
            };

            nodes.push(FileTreeNode {
                name,
                path: relative_path,
                is_dir,
                children,
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
    build_tree(path, path, 0)
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
fn edit_file_line(file_path: String, line_number: usize, new_content: String) -> Result<(), String> {
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

    // If new content is empty, delete the line entirely
    if new_content.is_empty() {
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

// Git file watcher commands
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

    let git_dir = Path::new(&repo_path).join(".git");
    if !git_dir.exists() {
        return Err("Not a git repository".to_string());
    }

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
    let home = std::env::var("HOME").map_err(|_| "Could not find HOME directory")?;
    let limit = limit.unwrap_or(500);

    // Try zsh history first, then bash
    let history_paths = vec![
        format!("{}/.zsh_history", home),
        format!("{}/.bash_history", home),
    ];

    for history_path in history_paths {
        let path = std::path::Path::new(&history_path);
        if path.exists() {
            let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
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

    Ok(installed)
}

#[tauri::command]
fn install_assistant(command: String) -> Result<String, String> {
    let install_cmd = match command.as_str() {
        "claude" => "npm install -g @anthropic-ai/claude-code",
        "aider" => "pip install aider-chat",
        "gemini" => "npm install -g @anthropic-ai/gemini-cli",
        "codex" => "npm install -g @openai/codex",
        "opencode" => "curl -fsSL https://opencode.ai/install | bash",
        _ => return Err(format!("Unknown assistant: {}", command)),
    };

    // Return the install command for the user to run in terminal
    Ok(install_cmd.to_string())
}

// AI commands using Groq
#[derive(Debug, Serialize, Deserialize)]
struct GroqMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct GroqRequest {
    model: String,
    messages: Vec<GroqMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct GroqChoice {
    message: GroqMessage,
}

#[derive(Debug, Deserialize)]
struct GroqResponse {
    choices: Vec<GroqChoice>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CommitSuggestion {
    subject: String,
    description: String,
}

// Portal mode setting command
#[tauri::command]
fn set_portal_enabled(enabled: bool, state: tauri::State<Arc<AppState>>) {
    *state.portal_enabled.lock() = enabled;
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
) -> Result<CommitSuggestion, String> {
    if api_key.is_empty() {
        return Err("No API key provided".to_string());
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
    let request = GroqRequest {
        model: "llama-3.1-8b-instant".to_string(),
        messages: vec![GroqMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        temperature: 0.3,
        max_tokens: 200,
    };

    let response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error: {}", error_text));
    }

    let groq_response: GroqResponse = response.json().await.map_err(|e| e.to_string())?;

    if let Some(choice) = groq_response.choices.first() {
        let content = &choice.message.content;

        // Strip markdown code fences if present (e.g., ```json ... ```)
        let json_content = content
            .trim()
            .strip_prefix("```json")
            .or_else(|| content.trim().strip_prefix("```"))
            .unwrap_or(content)
            .trim()
            .strip_suffix("```")
            .unwrap_or(content)
            .trim();

        // Parse the JSON response
        let suggestion: CommitSuggestion = serde_json::from_str(json_content)
            .map_err(|e| format!("Failed to parse AI response: {} - Content: {}", e, json_content))?;
        Ok(suggestion)
    } else {
        Err("No response from AI".to_string())
    }
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
fn scan_project_context(cwd: String, _force_refresh: Option<bool>) -> Result<ProjectContext, String> {
    use std::path::Path;

    let path = Path::new(&cwd);
    let context = detect_project_context(path);

    Ok(context)
}

#[tauri::command]
async fn ai_shell_command(
    request: String,
    context: ProjectContext,
    api_key: String,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("No API key provided. Set your Groq API key in Settings.".to_string());
    }

    // Include config snippets if available
    let config_info = context.config_snippet.clone()
        .map(|s| format!("\n{}", s))
        .unwrap_or_default();

    let folder_info = context.folder_structure.clone()
        .map(|s| format!("\n=== Project structure ===\n{}", s))
        .unwrap_or_default();

    let prompt = format!(
        r#"You are a terminal command assistant. Analyze the project structure and config files to understand what kind of project this is, then return the appropriate shell command.
{}
{}

User request: "{}"

Consider the full project structure (folders like src-tauri/, mobile/, etc.) and all config files to determine the correct command. Respond with ONLY the shell command. No explanation."#,
        folder_info,
        config_info,
        request
    );

    println!("[SmartShell] Prompt:\n{}", prompt);

    let client = reqwest::Client::new();
    let groq_request = GroqRequest {
        model: "llama-3.3-70b-versatile".to_string(),
        messages: vec![GroqMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        temperature: 0.1,  // Low for deterministic output
        max_tokens: 150,
    };

    let response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&groq_request)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error: {}", error_text));
    }

    let groq_response: GroqResponse = response.json().await.map_err(|e| e.to_string())?;

    if let Some(choice) = groq_response.choices.first() {
        // Clean up the response - remove any markdown formatting or quotes
        let command = choice.message.content
            .trim()
            .trim_matches('`')
            .trim_matches('"')
            .trim_matches('\'')
            .trim()
            .to_string();
        Ok(command)
    } else {
        Err("No response from AI".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("chell");
    std::fs::create_dir_all(&data_dir).ok();

    let db = Database::new(data_dir.join("chell.db"))
        .expect("Failed to initialize database");

    let state = Arc::new(AppState {
        terminals: Mutex::new(HashMap::new()),
        database: Mutex::new(db),
        portal_enabled: Mutex::new(false),
        git_watchers: Mutex::new(HashMap::new()),
    });
    let state_for_window_event = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            // Debug
            debug_log,
            // Terminal
            spawn_terminal,
            write_terminal,
            resize_terminal,
            kill_terminal,
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
            discard_file,
            add_to_gitignore,
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
            watch_repo,
            unwatch_repo,
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
            get_file_tree,
            delete_file,
            rename_file,
            // Assistants
            check_installed_assistants,
            install_assistant,
            // AI
            generate_commit_message,
            test_ai_connection,
            scan_project_context,
            ai_shell_command,
            // Portal
            set_portal_enabled,
        ])
        .setup(|app| {
            // Warm up the PTY system early to avoid first-spawn delays
            // This initializes the native PTY interface before any terminal is created
            std::thread::spawn(|| {
                let _ = native_pty_system();
            });

            // Create system tray icon
            let new_window_item = MenuItemBuilder::with_id("new_window", "New Window").build(app)?;
            let show_item = MenuItemBuilder::with_id("show", "Show Chell").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&new_window_item)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Load custom tray icon
            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))
                .expect("Failed to load tray icon");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .tooltip("Chell - Running in background")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "new_window" | "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, button_state, .. } = event {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Create custom macOS menu with proper app name
            #[cfg(target_os = "macos")]
            {
                let app_menu = Submenu::with_items(
                    app,
                    "Chell",
                    true,
                    &[
                        &PredefinedMenuItem::about(app, Some("About Chell"), None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::services(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::hide(app, Some("Hide Chell"))?,
                        &PredefinedMenuItem::hide_others(app, None)?,
                        &PredefinedMenuItem::show_all(app, None)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, Some("Quit Chell"))?,
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
        .on_window_event(move |window, event| {
            // Only minimize to tray if portal mode is enabled, otherwise quit
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let portal_enabled = *state_for_window_event.portal_enabled.lock();
                if portal_enabled {
                    // Hide the window instead of closing it (tray mode)
                    let _ = window.hide();
                    // Prevent the window from being closed
                    api.prevent_close();
                }
                // If portal is disabled, let the window close normally (quit app)
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // Handle dock icon click on macOS when no windows are visible
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = _event {
                if !has_visible_windows {
                    if let Some(window) = _app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
