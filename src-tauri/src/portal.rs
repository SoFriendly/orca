use crate::database::{LinkedDevice, PortalConfig};
use crate::AppState;
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Write;
use std::sync::Arc;
use tauri::{async_runtime, AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PortalMessage {
    RegisterDesktop {
        id: String,
        #[serde(rename = "deviceId")]
        device_id: String,
        #[serde(rename = "deviceName")]
        device_name: String,
        #[serde(rename = "pairingCode")]
        pairing_code: String,
        #[serde(rename = "pairingPassphrase")]
        pairing_passphrase: String,
    },
    DeviceList {
        devices: Vec<LinkedDevice>,
    },
    RequestStatus {
        id: String,
    },
    StatusUpdate {
        id: String,
        timestamp: i64,
        #[serde(rename = "connectionStatus")]
        connection_status: String,
        projects: Vec<ProjectInfo>,
        #[serde(rename = "activeProjectId")]
        active_project_id: Option<String>,
        terminals: Vec<TerminalInfo>,
        theme: Option<String>,
    },
    Command {
        id: String,
        command: String,
        params: Value,
    },
    CommandResponse {
        id: String,
        #[serde(rename = "requestId")]
        request_id: String,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    TerminalInput {
        #[serde(rename = "terminalId")]
        terminal_id: String,
        data: String,
    },
    TerminalOutput {
        id: String,
        #[serde(rename = "terminalId")]
        terminal_id: String,
        data: String,
    },
    AttachTerminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
    },
    AttachTerminalResponse {
        id: String,
        #[serde(rename = "terminalId")]
        terminal_id: String,
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    DetachTerminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
    },
    KillTerminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
    },
    SelectProject {
        #[serde(rename = "projectId")]
        project_id: String,
    },
    ProjectChanged {
        id: String,
        timestamp: i64,
        #[serde(rename = "projectId")]
        project_id: String,
    },
    GitFilesChanged {
        id: String,
        #[serde(rename = "repoPath")]
        repo_path: String,
    },
    Error {
        code: String,
        message: String,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFolderInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folders: Option<Vec<ProjectFolderInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    #[serde(rename = "type")]
    pub terminal_type: String,
}

pub struct Portal {
    pub config: Arc<Mutex<PortalConfig>>,
    pub is_connected: Arc<Mutex<bool>>,
    pub mobile_terminal_ids: Arc<Mutex<HashSet<String>>>,
    sender: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    app_handle: AppHandle,
}

impl Portal {
    pub fn new(app_handle: AppHandle, config: PortalConfig) -> Self {
        Self {
            config: Arc::new(Mutex::new(config)),
            is_connected: Arc::new(Mutex::new(false)),
            mobile_terminal_ids: Arc::new(Mutex::new(HashSet::new())),
            sender: Arc::new(Mutex::new(None)),
            app_handle,
        }
    }

    pub fn is_connected(&self) -> bool {
        *self.is_connected.lock()
    }

    pub fn is_mobile_terminal(&self, terminal_id: &str) -> bool {
        self.mobile_terminal_ids.lock().contains(terminal_id)
    }

    pub fn add_mobile_terminal(&self, terminal_id: String) {
        self.mobile_terminal_ids.lock().insert(terminal_id);
    }

    pub fn remove_mobile_terminal(&self, terminal_id: &str) {
        self.mobile_terminal_ids.lock().remove(terminal_id);
    }

    pub fn send_message(&self, message: &Value) {
        if let Some(sender) = self.sender.lock().as_ref() {
            if let Ok(json) = serde_json::to_string(message) {
                let _ = sender.send(json);
            }
        }
    }

    pub fn connect(&self, state: Arc<AppState>) {
        let config = self.config.lock().clone();
        let relay_url = format!("{}/ws", config.relay_url);

        log::info!("[Portal] Connecting to relay: {}", relay_url);

        let is_connected = self.is_connected.clone();
        let sender_holder = self.sender.clone();
        let config_holder = self.config.clone();
        let mobile_terminals = self.mobile_terminal_ids.clone();
        let app_handle = self.app_handle.clone();

        async_runtime::spawn(async move {
            loop {
                let config = config_holder.lock().clone();
                if !config.is_enabled {
                    log::info!("[Portal] Portal disabled, stopping connection loop");
                    *is_connected.lock() = false;
                    break;
                }

                match connect_async(&relay_url).await {
                    Ok((ws_stream, _)) => {
                        log::info!("[Portal] Connected to relay");
                        *is_connected.lock() = true;

                        // Emit connection state to frontend
                        let _ = app_handle.emit("portal-state-changed", json!({
                            "isConnected": true
                        }));

                        let (mut write, mut read) = ws_stream.split();

                        // Create channel for sending messages
                        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                        *sender_holder.lock() = Some(tx.clone());

                        // Send registration message
                        let register_msg = json!({
                            "type": "register_desktop",
                            "id": uuid::Uuid::new_v4().to_string(),
                            "deviceId": config.device_id,
                            "deviceName": config.device_name,
                            "pairingCode": config.pairing_code,
                            "pairingPassphrase": config.pairing_passphrase,
                        });
                        if let Ok(json) = serde_json::to_string(&register_msg) {
                            let _ = write.send(Message::Text(json.into())).await;
                        }

                        // Spawn task to handle outgoing messages
                        let write_handle = tokio::spawn(async move {
                            while let Some(msg) = rx.recv().await {
                                if write.send(Message::Text(msg.into())).await.is_err() {
                                    break;
                                }
                            }
                        });

                        // Handle incoming messages
                        while let Some(msg_result) = read.next().await {
                            match msg_result {
                                Ok(Message::Text(text)) => {
                                    if let Ok(message) = serde_json::from_str::<Value>(&text) {
                                        handle_message(
                                            &message,
                                            &tx,
                                            &state,
                                            &app_handle,
                                            &config_holder,
                                            &mobile_terminals,
                                        )
                                        .await;
                                    }
                                }
                                Ok(Message::Close(_)) => {
                                    log::info!("[Portal] WebSocket closed by server");
                                    break;
                                }
                                Err(e) => {
                                    log::error!("[Portal] WebSocket error: {}", e);
                                    break;
                                }
                                _ => {}
                            }
                        }

                        // Cleanup
                        write_handle.abort();
                        *sender_holder.lock() = None;
                        *is_connected.lock() = false;

                        // Emit disconnection to frontend
                        let _ = app_handle.emit("portal-state-changed", json!({
                            "isConnected": false
                        }));

                        log::info!("[Portal] Disconnected from relay");
                    }
                    Err(e) => {
                        log::error!("[Portal] Failed to connect: {}", e);
                        *is_connected.lock() = false;
                    }
                }

                // Check if still enabled before reconnecting
                let config = config_holder.lock().clone();
                if !config.is_enabled {
                    break;
                }

                // Wait before reconnecting
                log::info!("[Portal] Reconnecting in 5 seconds...");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        });
    }

    pub fn disconnect(&self) {
        *self.sender.lock() = None;
    }
}

async fn handle_message(
    message: &Value,
    sender: &mpsc::UnboundedSender<String>,
    state: &Arc<AppState>,
    app_handle: &AppHandle,
    config_holder: &Arc<Mutex<PortalConfig>>,
    mobile_terminals: &Arc<Mutex<HashSet<String>>>,
) {
    let msg_type = message.get("type").and_then(|t| t.as_str()).unwrap_or("");
    log::info!("[Portal] Received message type: {}", msg_type);

    match msg_type {
        "device_list" => {
            if let Ok(devices) = serde_json::from_value::<Vec<LinkedDevice>>(
                message.get("devices").cloned().unwrap_or(Value::Array(vec![])),
            ) {
                let mut config = config_holder.lock();
                config.linked_devices = devices.clone();

                // Save to database
                let db = state.database.lock();
                let _ = db.set_portal_config(&config);

                // Emit to frontend
                let _ = app_handle.emit("portal-devices-updated", &devices);
            }
        }

        "request_status" => {
            log::info!("[Portal] Handling request_status");

            // Get projects from database
            let projects: Vec<ProjectInfo> = state
                .database
                .lock()
                .get_all_projects()
                .unwrap_or_default()
                .into_iter()
                .map(|p| ProjectInfo {
                    id: p.id.clone(),
                    name: p.name,
                    path: p.path.clone(),
                    last_opened: p.last_opened,
                    folders: p.folders.map(|folders| {
                        folders.into_iter().map(|f| ProjectFolderInfo {
                            id: f.id,
                            name: f.name,
                            path: f.path,
                        }).collect()
                    }),
                })
                .collect();

            // Get terminals from state
            let terminals: Vec<TerminalInfo> = state
                .terminals
                .lock()
                .iter()
                .map(|(id, t)| TerminalInfo {
                    id: id.clone(),
                    title: t.title.clone(),
                    cwd: t.cwd.clone(),
                    terminal_type: t.terminal_type.clone(),
                })
                .collect();

            log::info!("[Portal] Sending status with {} projects and {} terminals", projects.len(), terminals.len());

            let status_update = json!({
                "type": "status_update",
                "id": uuid::Uuid::new_v4().to_string(),
                "timestamp": chrono::Utc::now().timestamp_millis(),
                "connectionStatus": "connected",
                "projects": projects,
                "activeProjectId": null,
                "terminals": terminals,
                "theme": "tokyo",
            });

            if let Ok(json) = serde_json::to_string(&status_update) {
                let _ = sender.send(json);
            }
        }

        "command" => {
            // Forward command to frontend via event
            let _ = app_handle.emit("portal-command", message);
        }

        "terminal_input" => {
            let terminal_id = message
                .get("terminalId")
                .and_then(|t| t.as_str())
                .unwrap_or("");
            let data = message.get("data").and_then(|d| d.as_str()).unwrap_or("");

            log::info!("[Portal] Terminal input for {}: {:?}", terminal_id, data);

            // Ensure terminal is tracked for output forwarding
            mobile_terminals.lock().insert(terminal_id.to_string());

            // Write to terminal directly - need mutable access
            let mut terminals = state.terminals.lock();
            if let Some(terminal) = terminals.get_mut(terminal_id) {
                let _ = terminal.writer.write_all(data.as_bytes());
                let _ = terminal.writer.flush();
            }
        }

        "attach_terminal" => {
            let terminal_id = message
                .get("terminalId")
                .and_then(|t| t.as_str())
                .unwrap_or("");

            log::info!("[Portal] Mobile attaching to terminal: {}", terminal_id);

            // Get terminal buffer and send to mobile
            let buffer_data = state
                .terminals
                .lock()
                .get(terminal_id)
                .map(|t| {
                    let buffer = t.output_buffer.lock();
                    // Buffer is raw bytes, decode and convert to string
                    String::from_utf8_lossy(&buffer).to_string()
                })
                .unwrap_or_default();

            if !buffer_data.is_empty() {
                let output_msg = json!({
                    "type": "terminal_output",
                    "id": uuid::Uuid::new_v4().to_string(),
                    "terminalId": terminal_id,
                    "data": buffer_data,
                });
                if let Ok(json) = serde_json::to_string(&output_msg) {
                    let _ = sender.send(json);
                }
            }

            // Add to mobile terminals for live output forwarding
            mobile_terminals.lock().insert(terminal_id.to_string());

            // Send confirmation
            let response = json!({
                "type": "attach_terminal_response",
                "id": uuid::Uuid::new_v4().to_string(),
                "terminalId": terminal_id,
                "success": true,
            });
            if let Ok(json) = serde_json::to_string(&response) {
                let _ = sender.send(json);
            }
        }

        "detach_terminal" => {
            let terminal_id = message
                .get("terminalId")
                .and_then(|t| t.as_str())
                .unwrap_or("");

            log::info!("[Portal] Mobile detaching from terminal: {}", terminal_id);
            mobile_terminals.lock().remove(terminal_id);
        }

        "kill_terminal" => {
            let terminal_id = message
                .get("terminalId")
                .and_then(|t| t.as_str())
                .unwrap_or("");

            log::info!("[Portal] Mobile killing terminal: {}", terminal_id);
            mobile_terminals.lock().remove(terminal_id);
            if let Some(terminal) = state.terminals.lock().remove(terminal_id) {
                crate::kill_terminal_process(terminal);
            }
        }

        "select_project" => {
            // Forward to frontend - it needs to open the project tab
            let _ = app_handle.emit("portal-select-project", message);
        }

        "error" => {
            let code = message
                .get("code")
                .and_then(|c| c.as_str())
                .unwrap_or("unknown");
            let msg = message
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Unknown error");
            log::error!("[Portal] Error from relay: {} - {}", code, msg);

            let _ = app_handle.emit("portal-error", json!({
                "code": code,
                "message": msg,
            }));
        }

        _ => {
            log::debug!("[Portal] Unhandled message type: {}", msg_type);
        }
    }
}

// Function to send terminal output to mobile (called from terminal output handler)
pub fn forward_terminal_output(portal: &Portal, terminal_id: &str, data: &str) {
    if !portal.is_mobile_terminal(terminal_id) {
        return;
    }

    let msg = json!({
        "type": "terminal_output",
        "id": uuid::Uuid::new_v4().to_string(),
        "terminalId": terminal_id,
        "data": data,
    });

    portal.send_message(&msg);
}
