use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use tauri::Emitter;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
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
}

struct AppState {
    terminals: Mutex<HashMap<String, TerminalState>>,
    database: Mutex<Database>,
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
        let mut cmd = CommandBuilder::new(parts[0]);
        for arg in parts.iter().skip(1) {
            cmd.arg(*arg);
        }
        cmd
    };

    cmd.cwd(&cwd);

    // Set UTF-8 locale for proper Unicode rendering
    cmd.env("LANG", "en_US.UTF-8");
    cmd.env("LC_ALL", "en_US.UTF-8");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let writer = pty_pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pty_pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let terminal_id = id.clone();
    let handle = app_handle.clone();

    // Spawn thread to read terminal output
    thread::spawn(move || {
        let mut buffer = [0u8; 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = handle.emit(&format!("terminal-output-{}", terminal_id), data);
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

    let terminal_state = TerminalState {
        pty_pair,
        writer,
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
    }
    Ok(())
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
    let mut lines: Vec<&str> = content.lines().collect();

    if line_number == 0 || line_number > lines.len() {
        return Err(format!("Line number {} out of range (1-{})", line_number, lines.len()));
    }

    // Convert to 0-indexed
    let idx = line_number - 1;

    // Create a new vector with the updated line
    let mut new_lines: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    new_lines[idx] = new_content;

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

// Assistant commands
#[tauri::command]
fn check_installed_assistants() -> Result<Vec<String>, String> {
    let mut installed = Vec::new();

    // Check for Claude Code
    if which::which("claude").is_ok() {
        installed.push("claude".to_string());
    }

    // Check for Aider
    if which::which("aider").is_ok() {
        installed.push("aider".to_string());
    }

    // Check for Gemini CLI
    if which::which("gemini").is_ok() {
        installed.push("gemini".to_string());
    }

    // Check for OpenAI Codex CLI
    if which::which("codex").is_ok() {
        installed.push("codex".to_string());
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

#[tauri::command]
async fn generate_commit_message(
    diffs: Vec<FileDiff>,
    api_key: String,
) -> Result<CommitSuggestion, String> {
    if api_key.is_empty() {
        return Err("No API key provided".to_string());
    }

    // Build a summary of changes
    let mut changes_summary = String::new();
    for diff in &diffs {
        changes_summary.push_str(&format!("- {} ({})\n", diff.path, diff.status));
        for hunk in &diff.hunks {
            for line in &hunk.lines {
                if line.line_type == "addition" || line.line_type == "deletion" {
                    let prefix = if line.line_type == "addition" { "+" } else { "-" };
                    changes_summary.push_str(&format!("  {}{}\n", prefix, line.content));
                }
            }
        }
    }

    // Truncate if too long
    if changes_summary.len() > 4000 {
        changes_summary = changes_summary[..4000].to_string();
        changes_summary.push_str("\n... (truncated)");
    }

    let prompt = format!(
        r#"Analyze these git changes and generate a commit message.

Changes:
{}

Respond with JSON only, no markdown:
{{"subject": "short imperative subject line (max 50 chars)", "description": "optional longer description explaining why (can be empty string)"}}

Examples of good subjects: "Add user authentication", "Fix null pointer in parser", "Refactor database queries"
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
        // Parse the JSON response
        let suggestion: CommitSuggestion = serde_json::from_str(content)
            .map_err(|e| format!("Failed to parse AI response: {} - Content: {}", e, content))?;
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
    });

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
            // Project
            add_project,
            remove_project,
            get_project,
            get_all_projects,
            // File system
            open_folder_dialog,
            open_in_finder,
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
        ])
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
