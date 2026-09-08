use std::sync::Arc;
use tokio::sync::Mutex;

use crate::binary_discovery::find_binary;
use crate::defaults::{default_guidelines, default_queue, default_settings};
use crate::executor::ProcessTracker;
use crate::job_fifo::JobFifoState;
use crate::models::{AppSettings, FileStatus, WorkQueue};
use crate::persistence::{JsonFileStore, Persistence};

pub struct AppState {
    pub queue: Arc<Mutex<WorkQueue>>,
    pub settings: Arc<Mutex<AppSettings>>,
    pub tracker: Arc<ProcessTracker>,
    /// Cancellation token for the currently running processing pipeline.
    /// Replaced only when the previous token is missing or cancelled, not on every Start.
    pub current_token: Arc<Mutex<Option<tokio_util::sync::CancellationToken>>>,
    pub job_fifo: Arc<crate::job_fifo::JobFifoState>,
    pub store: JsonFileStore,
}

/// Map leftover Processing items from a previous process to Error.
/// Returns true if any file was rewritten.
pub fn map_interrupted_processing(queue: &mut WorkQueue) -> bool {
    let mut changed = false;
    let now = chrono::Utc::now().to_rfc3339();
    for file in &mut queue.files {
        if file.status == FileStatus::Processing {
            file.status = FileStatus::Error;
            file.error_message = "Processing was interrupted (app restarted)".to_string();
            file.updated_at = now.clone();
            changed = true;
        }
    }
    changed
}

pub fn build_app_state() -> AppState {
    let store = JsonFileStore::new().expect("Failed to create JsonFileStore");
    let guidelines = store.load_guidelines().unwrap_or_else(|| default_guidelines());
    let mut queue = store.load_queue().unwrap_or_else(|| default_queue(guidelines.clone()));
    if map_interrupted_processing(&mut queue) {
        let _ = store.save_queue(&queue);
    }
    let mut settings = store.load_settings().unwrap_or_else(|| default_settings());
    crate::settings_ops::clamp_settings_max_parallel(&mut settings);

    // Auto-discover FFmpeg/FFprobe on startup if paths are empty
    if settings.ffmpeg_path.is_empty() {
        if let Some(path) = find_binary("ffmpeg") {
            settings.ffmpeg_path = path;
        }
    }
    if settings.ffprobe_path.is_empty() {
        if let Some(path) = find_binary("ffprobe") {
            settings.ffprobe_path = path;
        }
    }

    AppState {
        queue: Arc::new(Mutex::new(queue)),
        settings: Arc::new(Mutex::new(settings)),
        tracker: Arc::new(ProcessTracker::new()),
        current_token: Arc::new(Mutex::new(None)),
        job_fifo: Arc::new(JobFifoState::new()),
        store,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::VideoFile;

    fn sample_file(id: &str, status: FileStatus) -> VideoFile {
        VideoFile {
            id: id.to_string(),
            input_path: format!("/media/{id}.mkv"),
            output_path: String::new(),
            scan_root: "/media".to_string(),
            ffprobe_raw: String::new(),
            metadata: None,
            generated_command: String::new(),
            command_args: String::new(),
            description: String::new(),
            reasoning: String::new(),
            status,
            is_approved: false,
            error_message: String::new(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: String::new(),
        }
    }

    #[test]
    fn map_interrupted_processing_sets_error_and_message() {
        let mut queue = WorkQueue {
            output_folder: String::new(),
            guidelines: String::new(),
            files: vec![
                sample_file("a", FileStatus::Processing),
                sample_file("b", FileStatus::Pending),
                sample_file("c", FileStatus::Completed),
            ],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            last_modified: "2024-01-01T00:00:00Z".to_string(),
        };

        let changed = map_interrupted_processing(&mut queue);
        assert!(changed);
        assert_eq!(queue.files[0].status, FileStatus::Error);
        assert_eq!(
            queue.files[0].error_message,
            "Processing was interrupted (app restarted)"
        );
        assert_eq!(queue.files[1].status, FileStatus::Pending);
        assert_eq!(queue.files[2].status, FileStatus::Completed);
    }

    #[test]
    fn map_interrupted_processing_noop_when_none_processing() {
        let mut queue = WorkQueue {
            output_folder: String::new(),
            guidelines: String::new(),
            files: vec![sample_file("a", FileStatus::Pending)],
            created_at: "2024-01-01T00:00:00Z".to_string(),
            last_modified: "2024-01-01T00:00:00Z".to_string(),
        };
        assert!(!map_interrupted_processing(&mut queue));
        assert_eq!(queue.files[0].status, FileStatus::Pending);
        assert!(queue.files[0].error_message.is_empty());
    }
}
