use crate::Project;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkedDevice {
    pub id: String,
    pub name: String,
    pub device_type: String,
    pub paired_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortalConfig {
    pub is_enabled: bool,
    pub relay_url: String,
    pub device_id: String,
    pub device_name: String,
    pub pairing_code: String,
    pub pairing_passphrase: String,
    pub linked_devices: Vec<LinkedDevice>,
}

impl Default for PortalConfig {
    fn default() -> Self {
        Self {
            is_enabled: false,
            relay_url: "wss://relay.chell.app".to_string(),
            device_id: uuid::Uuid::new_v4().to_string().replace("-", "")[..32].to_string(),
            device_name: get_device_name(),
            pairing_code: generate_pairing_code(),
            pairing_passphrase: generate_passphrase(),
            linked_devices: Vec::new(),
        }
    }
}

fn get_device_name() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "Desktop".to_string())
}

fn generate_pairing_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("{:06}", rng.gen_range(0..1000000))
}

fn generate_passphrase() -> String {
    use rand::seq::SliceRandom;
    const WORDS: &[&str] = &[
        "apple", "banana", "cherry", "dolphin", "eagle", "forest",
        "garden", "harbor", "island", "jungle", "kitten", "lemon",
        "mountain", "nectar", "ocean", "palace", "quartz", "river",
        "sunset", "temple", "umbrella", "valley", "willow", "yellow",
    ];
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| *WORDS.choose(&mut rng).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                last_opened TEXT NOT NULL,
                folders TEXT
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        // Migration: Add folders column if it doesn't exist
        conn.execute(
            "ALTER TABLE projects ADD COLUMN folders TEXT",
            [],
        )
        .ok(); // Ignore if column already exists

        conn.execute(
            "CREATE TABLE IF NOT EXISTS portal_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )
        .map_err(|e| e.to_string())?;

        // Clean up duplicate projects (keep the most recently opened one for each path)
        conn.execute(
            "DELETE FROM projects WHERE id NOT IN (
                SELECT id FROM (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY path ORDER BY last_opened DESC) as rn
                    FROM projects
                ) WHERE rn = 1
            )",
            [],
        )
        .ok(); // Ignore errors if table is empty or query fails

        // Create unique index on path if it doesn't exist
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path)",
            [],
        )
        .ok(); // Ignore if already exists

        Ok(Self { conn })
    }

    pub fn add_project(&self, project: &Project) -> Result<(), String> {
        // Serialize folders to JSON
        let folders_json = project.folders.as_ref()
            .map(|f| serde_json::to_string(f).unwrap_or_default());

        // Check if project with same path already exists
        let existing_id: Option<String> = self.conn
            .query_row(
                "SELECT id FROM projects WHERE path = ?1",
                params![project.path],
                |row| row.get(0),
            )
            .ok();

        if let Some(existing) = existing_id {
            // Update existing project by path
            self.conn
                .execute(
                    "UPDATE projects SET name = ?1, last_opened = ?2, folders = ?3 WHERE id = ?4",
                    params![project.name, project.last_opened, folders_json, existing],
                )
                .map_err(|e| e.to_string())?;
        } else {
            // Insert new project
            self.conn
                .execute(
                    "INSERT INTO projects (id, name, path, last_opened, folders) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![project.id, project.name, project.path, project.last_opened, folders_json],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn remove_project(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, path, last_opened, folders FROM projects WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let mut rows = stmt
            .query(params![id])
            .map_err(|e| e.to_string())?;

        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let folders_json: Option<String> = row.get(4).ok();
            let folders = folders_json.and_then(|json| serde_json::from_str(&json).ok());

            Ok(Some(Project {
                id: row.get(0).map_err(|e| e.to_string())?,
                name: row.get(1).map_err(|e| e.to_string())?,
                path: row.get(2).map_err(|e| e.to_string())?,
                last_opened: row.get(3).map_err(|e| e.to_string())?,
                folders,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_all_projects(&self) -> Result<Vec<Project>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, path, last_opened, folders FROM projects ORDER BY last_opened DESC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let folders_json: Option<String> = row.get(4).ok();
                let folders = folders_json.and_then(|json| serde_json::from_str(&json).ok());

                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    last_opened: row.get(3)?,
                    folders,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut projects = Vec::new();
        for row in rows {
            projects.push(row.map_err(|e| e.to_string())?);
        }

        Ok(projects)
    }

    pub fn get_portal_config(&self) -> Result<PortalConfig, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM portal_config WHERE key = 'config'")
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let value: String = row.get(0).map_err(|e| e.to_string())?;
            serde_json::from_str(&value).map_err(|e| e.to_string())
        } else {
            // Return default config if none exists
            let config = PortalConfig::default();
            self.set_portal_config(&config)?;
            Ok(config)
        }
    }

    pub fn set_portal_config(&self, config: &PortalConfig) -> Result<(), String> {
        let value = serde_json::to_string(config).map_err(|e| e.to_string())?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO portal_config (key, value) VALUES ('config', ?1)",
                params![value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
