use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileStatus {
    Pending,
    Generating,
    Processing,
    Completed,
    Error,
    Skipped,
}

impl Default for FileStatus {
    fn default() -> Self {
        FileStatus::Pending
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct AudioStream {
    pub index: i32,
    pub codec: String,
    pub channels: i32,
    pub layout: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct SubtitleStream {
    pub index: i32,
    pub codec: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct VideoMetadata {
    pub codec: String,
    pub width: i32,
    pub height: i32,
    pub hdr: bool,
    pub bit_depth: i32,
    pub fps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct FileMetadata {
    pub container: String,
    pub video: VideoMetadata,
    pub audio_streams: Vec<AudioStream>,
    pub subtitle_streams: Vec<SubtitleStream>,
    pub subtitle_count: i32,
    pub has_chapters: bool,
    pub duration: f64,
    pub bitrate: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoFile {
    pub id: String,
    pub input_path: String,
    pub output_path: String,
    pub scan_root: String,
    pub ffprobe_raw: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<FileMetadata>,
    pub generated_command: String,
    pub command_args: String,
    pub description: String,
    pub reasoning: String,
    #[serde(default)]
    pub status: FileStatus,
    #[serde(default)]
    pub is_approved: bool,
    pub error_message: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub input_size: i64,
    #[serde(default)]
    pub output_size: i64,
    #[serde(default)]
    pub processing_duration: f64,
    pub completed_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_status_serializes_to_capitalized_strings() {
        assert_eq!(
            serde_json::to_string(&FileStatus::Pending).unwrap(),
            "\"Pending\""
        );
        assert_eq!(
            serde_json::to_string(&FileStatus::Generating).unwrap(),
            "\"Generating\""
        );
        assert_eq!(
            serde_json::to_string(&FileStatus::Processing).unwrap(),
            "\"Processing\""
        );
        assert_eq!(
            serde_json::to_string(&FileStatus::Completed).unwrap(),
            "\"Completed\""
        );
        assert_eq!(
            serde_json::to_string(&FileStatus::Error).unwrap(),
            "\"Error\""
        );
        assert_eq!(
            serde_json::to_string(&FileStatus::Skipped).unwrap(),
            "\"Skipped\""
        );
    }

    #[test]
    fn file_status_deserializes_from_capitalized_strings() {
        assert_eq!(
            serde_json::from_str::<FileStatus>("\"Pending\"").unwrap(),
            FileStatus::Pending
        );
        assert_eq!(
            serde_json::from_str::<FileStatus>("\"Generating\"").unwrap(),
            FileStatus::Generating
        );
        assert_eq!(
            serde_json::from_str::<FileStatus>("\"Processing\"").unwrap(),
            FileStatus::Processing
        );
        assert_eq!(
            serde_json::from_str::<FileStatus>("\"Completed\"").unwrap(),
            FileStatus::Completed
        );
        assert_eq!(
            serde_json::from_str::<FileStatus>("\"Error\"").unwrap(),
            FileStatus::Error
        );
        assert_eq!(
            serde_json::from_str::<FileStatus>("\"Skipped\"").unwrap(),
            FileStatus::Skipped
        );
    }

    #[test]
    fn missing_check_updates_on_startup_defaults_true() {
        let json = r#"{
            "providers": [],
            "active_provider_index": 0,
            "ffmpeg_path": "",
            "ffprobe_path": "",
            "default_output_folder": "",
            "naming_template": "{name}.mkv",
            "max_parallel": 1
        }"#;
        let s: AppSettings = serde_json::from_str(json).expect("old settings must deserialize");
        assert!(s.check_updates_on_startup);
    }

    #[test]
    fn check_updates_on_startup_false_roundtrips() {
        let json = r#"{
            "providers": [],
            "active_provider_index": 0,
            "ffmpeg_path": "",
            "ffprobe_path": "",
            "default_output_folder": "",
            "naming_template": "{name}.mkv",
            "max_parallel": 1,
            "check_updates_on_startup": false
        }"#;
        let s: AppSettings = serde_json::from_str(json).unwrap();
        assert!(!s.check_updates_on_startup);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AiProviderConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InterviewResponse {
    Message { content: String },
    Complete { guidelines_markdown: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkQueue {
    pub output_folder: String,
    pub guidelines: String,
    pub files: Vec<VideoFile>,
    pub created_at: String,
    pub last_modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AddPathsResult {
    pub queue: WorkQueue,
    pub added: usize,
    pub skipped_non_video: usize,
    pub skipped_duplicates: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResponse {
    pub command: String,
    pub description: String,
    #[serde(default)]
    pub reasoning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    pub providers: Vec<AiProviderConfig>,
    pub active_provider_index: usize,
    pub ffmpeg_path: String,
    pub ffprobe_path: String,
    pub default_output_folder: String,
    pub naming_template: String,
    pub max_parallel: i32,
    #[serde(default = "default_check_updates_on_startup")]
    pub check_updates_on_startup: bool,
}

fn default_check_updates_on_startup() -> bool {
    true
}


