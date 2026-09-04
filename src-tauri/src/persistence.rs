use std::path::PathBuf;
use std::sync::Mutex;

use crate::models::{AppSettings, WorkQueue};

const APP_CONFIG_DIR_NAME: &str = "com.mediabender.app";

/// Abstracts persistence for settings, guidelines, and work queue.
pub trait Persistence {
    fn load_settings(&self) -> Option<AppSettings>;
    fn save_settings(&self, settings: &AppSettings) -> Result<(), String>;
    fn load_guidelines(&self) -> Option<String>;
    fn save_guidelines(&self, guidelines: &str) -> Result<(), String>;
    fn load_queue(&self) -> Option<WorkQueue>;
    fn save_queue(&self, queue: &WorkQueue) -> Result<(), String>;
}

// ── JsonFileStore ──

/// Production adapter that reads/writes JSON/text files under the app config directory.
#[derive(Clone)]
pub struct JsonFileStore {
    config_dir: PathBuf,
}

impl JsonFileStore {
    pub fn new() -> Result<Self, String> {
        let dir = dirs::config_dir()
            .ok_or("Failed to determine config directory")?
            .join(APP_CONFIG_DIR_NAME);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
        Ok(Self { config_dir: dir })
    }

    /// Create a store backed by a specific directory (useful for tests).
    pub fn with_dir(config_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
        Ok(Self { config_dir })
    }

    fn settings_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    fn guidelines_path(&self) -> PathBuf {
        self.config_dir.join("guidelines.txt")
    }

    fn queue_path(&self) -> PathBuf {
        self.config_dir.join("queue.json")
    }
}

impl Persistence for JsonFileStore {
    fn load_settings(&self) -> Option<AppSettings> {
        let content = std::fs::read_to_string(self.settings_path()).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        std::fs::write(self.settings_path(), json)
            .map_err(|e| format!("Failed to write settings: {}", e))
    }

    fn load_guidelines(&self) -> Option<String> {
        std::fs::read_to_string(self.guidelines_path()).ok()
    }

    fn save_guidelines(&self, guidelines: &str) -> Result<(), String> {
        std::fs::write(self.guidelines_path(), guidelines)
            .map_err(|e| format!("Failed to write guidelines: {}", e))
    }

    fn load_queue(&self) -> Option<WorkQueue> {
        let content = std::fs::read_to_string(self.queue_path()).ok()?;
        serde_json::from_str(&content).ok()
    }

    fn save_queue(&self, queue: &WorkQueue) -> Result<(), String> {
        let json = serde_json::to_string_pretty(queue)
            .map_err(|e| format!("Failed to serialize queue: {}", e))?;
        std::fs::write(self.queue_path(), json)
            .map_err(|e| format!("Failed to write queue: {}", e))
    }
}

// ── MemoryStore ──

/// Test adapter using interior mutability so it satisfies `&self` trait methods.
pub struct MemoryStore {
    settings: Mutex<Option<AppSettings>>,
    guidelines: Mutex<Option<String>>,
    queue: Mutex<Option<WorkQueue>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            settings: Mutex::new(None),
            guidelines: Mutex::new(None),
            queue: Mutex::new(None),
        }
    }
}

impl Persistence for MemoryStore {
    fn load_settings(&self) -> Option<AppSettings> {
        self.settings.lock().ok()?.clone()
    }

    fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let mut guard = self.settings.lock().map_err(|e| e.to_string())?;
        *guard = Some(settings.clone());
        Ok(())
    }

    fn load_guidelines(&self) -> Option<String> {
        self.guidelines.lock().ok()?.clone()
    }

    fn save_guidelines(&self, guidelines: &str) -> Result<(), String> {
        let mut guard = self.guidelines.lock().map_err(|e| e.to_string())?;
        *guard = Some(guidelines.to_string());
        Ok(())
    }

    fn load_queue(&self) -> Option<WorkQueue> {
        self.queue.lock().ok()?.clone()
    }

    fn save_queue(&self, queue: &WorkQueue) -> Result<(), String> {
        let mut guard = self.queue.lock().map_err(|e| e.to_string())?;
        *guard = Some(queue.clone());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defaults::{default_guidelines, default_queue, default_settings};

    #[test]
    fn memory_store_round_trips_settings() {
        let store = MemoryStore::new();
        let original = default_settings();

        assert!(store.load_settings().is_none(), "initial load should be None");

        store.save_settings(&original).expect("save should succeed");
        let loaded = store.load_settings().expect("load should return Some");
        assert_eq!(loaded, original);
    }

    #[test]
    fn memory_store_round_trips_guidelines() {
        let store = MemoryStore::new();
        let original = default_guidelines();

        assert!(store.load_guidelines().is_none(), "initial load should be None");

        store.save_guidelines(&original).expect("save should succeed");
        let loaded = store.load_guidelines().expect("load should return Some");
        assert_eq!(loaded, original);
    }

    #[test]
    fn json_file_store_round_trips_settings() {
        let temp_dir = std::env::temp_dir().join(format!(
            "mediabender_test_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let store = JsonFileStore::with_dir(temp_dir.clone()).expect("store creation should succeed");
        let original = default_settings();

        assert!(store.load_settings().is_none(), "initial load should be None");

        store.save_settings(&original).expect("save should succeed");
        let loaded = store.load_settings().expect("load should return Some");
        assert_eq!(loaded, original);

        // Verify a fresh store instance can read the same data
        let store2 = JsonFileStore::with_dir(temp_dir.clone()).expect("second store creation should succeed");
        let loaded2 = store2.load_settings().expect("load from new instance should return Some");
        assert_eq!(loaded2, original);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn json_file_store_round_trips_guidelines() {
        let temp_dir = std::env::temp_dir().join(format!(
            "mediabender_test_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let store = JsonFileStore::with_dir(temp_dir.clone()).expect("store creation should succeed");
        let original = default_guidelines();

        assert!(store.load_guidelines().is_none(), "initial load should be None");

        store.save_guidelines(&original).expect("save should succeed");
        let loaded = store.load_guidelines().expect("load should return Some");
        assert_eq!(loaded, original);

        let store2 = JsonFileStore::with_dir(temp_dir.clone()).expect("second store creation should succeed");
        let loaded2 = store2.load_guidelines().expect("load from new instance should return Some");
        assert_eq!(loaded2, original);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn json_file_store_round_trips_queue() {
        let temp_dir = std::env::temp_dir().join(format!(
            "mediabender_test_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let store = JsonFileStore::with_dir(temp_dir.clone()).expect("store creation should succeed");
        let original = default_queue(default_guidelines());

        assert!(store.load_queue().is_none(), "initial load should be None");

        store.save_queue(&original).expect("save should succeed");
        let loaded = store.load_queue().expect("load should return Some");
        assert_eq!(loaded, original);

        let store2 = JsonFileStore::with_dir(temp_dir.clone()).expect("second store creation should succeed");
        let loaded2 = store2.load_queue().expect("load from new instance should return Some");
        assert_eq!(loaded2, original);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn json_file_store_is_clone() {
        let temp_dir = std::env::temp_dir().join(format!(
            "mediabender_test_clone_{}_{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let store = JsonFileStore::with_dir(temp_dir.clone()).expect("store creation should succeed");
        let cloned = store.clone();
        let original = default_settings();
        cloned.save_settings(&original).expect("save via clone should succeed");
        let loaded = store.load_settings().expect("original store should see clone writes");
        assert_eq!(loaded, original);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
