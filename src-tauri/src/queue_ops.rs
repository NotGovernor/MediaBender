use crate::ai;
use crate::command_builder::{assemble_command, resolve_output_path};
use crate::ffprobe::analyze_file;
use crate::models::{AiProviderConfig, AiResponse, FileStatus, VideoFile, WorkQueue};
use crate::scanner::{create_video_file, is_video_file, scan_directory};
use std::collections::HashSet;

fn apply_ai_response(
    file: &mut VideoFile,
    response: AiResponse,
    output_folder: &str,
    naming_template: &str,
    flatten_output_folders: bool,
) {
    if response.command.is_empty() {
        file.error_message = "AI returned an empty command".to_string();
        file.status = FileStatus::Error;
        return;
    }

    file.output_path = resolve_output_path(
        &file.scan_root,
        &file.input_path,
        output_folder,
        naming_template,
        flatten_output_folders,
    );
    file.generated_command = assemble_command(
        &response.command,
        &file.input_path,
        &file.output_path,
    );
    file.command_args = response.command;
    file.description = response.description;
    file.reasoning = response.reasoning;
    file.status = FileStatus::Pending;
}

/// Analyze snapshots without a `WorkQueue`. Callers must copy files out of the
/// queue, drop the mutex, then copy results back (`lib.rs` does this).
pub async fn scan_and_analyze_snapshots(
    files: &mut [VideoFile],
    ffprobe_path: &str,
) -> Result<Vec<VideoFile>, String> {
    if ffprobe_path.is_empty() {
        return Err("FFprobe path is not configured".to_string());
    }

    let mut updated_files = Vec::new();

    for file in files.iter_mut() {
        if file.metadata.is_some() {
            continue;
        }

        match analyze_file(&file.input_path, ffprobe_path).await {
            Ok((metadata, raw_json)) => {
                file.metadata = Some(metadata);
                file.ffprobe_raw = raw_json;
                if let Ok(fs_meta) = std::fs::metadata(&file.input_path) {
                    file.input_size = fs_meta.len() as i64;
                }
            }
            Err(e) => {
                file.error_message = e.to_string();
                file.status = FileStatus::Error;
            }
        }
        file.updated_at = chrono::Utc::now().to_rfc3339();
        updated_files.push(file.clone());
    }

    Ok(updated_files)
}

pub async fn scan_and_analyze(
    queue: &mut WorkQueue,
    file_ids: Vec<String>,
    ffprobe_path: &str,
) -> Result<Vec<VideoFile>, String> {
    let mut snapshots: Vec<VideoFile> = queue
        .files
        .iter()
        .filter(|f| file_ids.iter().any(|id| id == &f.id))
        .cloned()
        .collect();
    let updated = scan_and_analyze_snapshots(&mut snapshots, ffprobe_path).await?;
    for u in &updated {
        if let Some(slot) = queue.files.iter_mut().find(|f| f.id == u.id) {
            *slot = u.clone();
        }
    }
    Ok(updated)
}

pub fn apply_command_template(
    queue: &mut WorkQueue,
    output_folder: &str,
    naming_template: &str,
    flatten_output_folders: bool,
    source_id: &str,
    target_ids: &[String],
) -> Result<Vec<VideoFile>, String> {
    let source = queue
        .files
        .iter()
        .find(|f| f.id == source_id)
        .ok_or("Source item not found")?;

    let command_args = source.command_args.clone();
    let description = source.description.clone();
    let reasoning = source.reasoning.clone();

    if command_args.is_empty() {
        return Err("Source item has no command_args".to_string());
    }

    let mut updated_files = Vec::new();

    for target_id in target_ids {
        if let Some(target) = queue.files.iter_mut().find(|f| f.id == *target_id) {
            if target.metadata.is_none() {
                continue;
            }
            if !target.generated_command.is_empty() {
                continue;
            }

            let resolved_output_path = resolve_output_path(
                &target.scan_root,
                &target.input_path,
                output_folder,
                naming_template,
                flatten_output_folders,
            );

            target.generated_command = assemble_command(
                &command_args,
                &target.input_path,
                &resolved_output_path,
            );
            target.command_args = command_args.clone();
            target.description = description.clone();
            target.reasoning = reasoning.clone();
            target.output_path = resolved_output_path;
            target.status = FileStatus::Pending;
            target.error_message = String::new();
            target.updated_at = chrono::Utc::now().to_rfc3339();

            updated_files.push(target.clone());
        }
    }

    Ok(updated_files)
}

/// Generate commands for file snapshots without a `WorkQueue`. `lib.rs` copies
/// matching files out, drops the queue mutex before HTTP, then copies results in.
pub async fn generate_commands_snapshots(
    mut snapshots: Vec<VideoFile>,
    feedback: Option<String>,
    provider: &AiProviderConfig,
    output_folder: &str,
    naming_template: &str,
    flatten_output_folders: bool,
    guidelines: &str,
) -> Result<Vec<VideoFile>, String> {
    let guidelines = match feedback {
        Some(ref fb) if !fb.trim().is_empty() => {
            format!("{}\n\nUser Feedback: {}", guidelines, fb.trim())
        }
        _ => guidelines.to_string(),
    };
    let mut updated_files = Vec::new();

    for file in &mut snapshots {
        if feedback.is_some() {
            apply_regenerate_reset(file, feedback.as_deref());
        }
        // Skip items that already have command_args (unless regenerating)
        if !file.command_args.is_empty() {
            continue;
        }
        if let Some(ref metadata) = file.metadata {
            match ai::generate_command(provider, &guidelines, metadata).await {
                Ok(response) => {
                    apply_ai_response(file, response, output_folder, naming_template, flatten_output_folders);
                }
                Err(e) => {
                    file.error_message = e.to_string();
                    file.status = FileStatus::Error;
                }
            }
            file.updated_at = chrono::Utc::now().to_rfc3339();
            updated_files.push(file.clone());
        }
    }

    Ok(updated_files)
}

pub async fn generate_commands(
    queue: &mut WorkQueue,
    file_ids: Vec<String>,
    feedback: Option<String>,
    provider: &AiProviderConfig,
    output_folder: &str,
    naming_template: &str,
    flatten_output_folders: bool,
) -> Result<Vec<VideoFile>, String> {
    let snapshots: Vec<VideoFile> = queue
        .files
        .iter()
        .filter(|f| file_ids.iter().any(|id| id == &f.id))
        .cloned()
        .collect();
    let guidelines = queue.guidelines.clone();
    let results = generate_commands_snapshots(
        snapshots,
        feedback,
        provider,
        output_folder,
        naming_template,
        flatten_output_folders,
        &guidelines,
    )
    .await?;
    for updated in &results {
        if let Some(slot) = queue.files.iter_mut().find(|f| f.id == updated.id) {
            *slot = updated.clone();
        }
    }
    Ok(results)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MergeGenerated {
    Applied,
    Refused,
}

/// Merge an HTTP generate result onto the live Work Queue row.
/// Refuses Skipped / Completed / Processing and missing ids so a skip/reset
/// that won during HTTP is not undone. Frozen (FIFO) is the caller's check.
pub fn try_merge_generated(queue: &mut WorkQueue, updated: &VideoFile) -> MergeGenerated {
    match queue.files.iter_mut().find(|f| f.id == updated.id) {
        Some(slot) => {
            if matches!(
                slot.status,
                FileStatus::Skipped | FileStatus::Completed | FileStatus::Processing
            ) {
                return MergeGenerated::Refused;
            }
            *slot = updated.clone();
            MergeGenerated::Applied
        }
        None => MergeGenerated::Refused,
    }
}

fn find_file_mut<'a>(queue: &'a mut WorkQueue, id: &str) -> Result<&'a mut VideoFile, String> {
    queue
        .files
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("File not found: {id}"))
}

pub fn ensure_not_frozen(status: FileStatus, in_fifo: bool) -> Result<(), String> {
    if in_fifo || status == FileStatus::Processing {
        return Err("File is in the encode queue".to_string());
    }
    Ok(())
}

pub fn is_pickup_eligible(file: &VideoFile) -> bool {
    file.is_approved
        && file.status == FileStatus::Pending
        && !file.command_args.trim().is_empty()
}

pub fn approve_file(
    queue: &mut WorkQueue,
    id: &str,
    command_args: &str,
    output_folder: &str,
    naming_template: &str,
    flatten_output_folders: bool,
) -> Result<(), String> {
    let command_args = command_args.trim();
    if command_args.is_empty() {
        return Err("command_args must not be empty".to_string());
    }

    let file = find_file_mut(queue, id)?;
    if file.metadata.is_none() {
        return Err("File has no metadata".to_string());
    }
    if matches!(file.status, FileStatus::Processing | FileStatus::Completed | FileStatus::Skipped) {
        return Err("File cannot be approved from this status".to_string());
    }

    file.output_path = resolve_output_path(
        &file.scan_root,
        &file.input_path,
        output_folder,
        naming_template,
        flatten_output_folders,
    );
    file.generated_command = assemble_command(command_args, &file.input_path, &file.output_path);
    file.command_args = command_args.to_string();
    file.is_approved = true;
    file.status = FileStatus::Pending;
    file.error_message.clear();
    file.updated_at = chrono::Utc::now().to_rfc3339();
    Ok(())
}

pub fn unapprove_file(queue: &mut WorkQueue, id: &str) -> Result<(), String> {
    let file = find_file_mut(queue, id)?;
    ensure_not_frozen(file.status.clone(), false)?;
    file.is_approved = false;
    file.updated_at = chrono::Utc::now().to_rfc3339();
    Ok(())
}

pub fn reset_file(queue: &mut WorkQueue, id: &str) -> Result<(), String> {
    let file = find_file_mut(queue, id)?;
    ensure_not_frozen(file.status.clone(), false)?;
    file.status = FileStatus::Pending;
    file.is_approved = false;
    file.error_message.clear();
    file.updated_at = chrono::Utc::now().to_rfc3339();
    Ok(())
}

pub fn prepare_reprocess(queue: &mut WorkQueue, id: &str) -> Result<(), String> {
    let file = find_file_mut(queue, id)?;
    if file.command_args.trim().is_empty() {
        return Err("No command to reprocess".into());
    }
    match file.status {
        FileStatus::Error | FileStatus::Completed | FileStatus::Pending => {}
        FileStatus::Skipped | FileStatus::Processing | FileStatus::Generating => {
            return Err("File cannot be reprocessed from this status".into());
        }
    }
    file.status = FileStatus::Pending;
    file.is_approved = true;
    file.error_message.clear();
    file.updated_at = chrono::Utc::now().to_rfc3339();
    Ok(())
}

pub fn skip_file(queue: &mut WorkQueue, id: &str) -> Result<(), String> {
    let file = find_file_mut(queue, id)?;
    ensure_not_frozen(file.status.clone(), false)?;
    file.status = FileStatus::Skipped;
    file.updated_at = chrono::Utc::now().to_rfc3339();
    Ok(())
}

pub fn remove_file(queue: &mut WorkQueue, id: &str) -> Result<(), String> {
    let status = queue
        .files
        .iter()
        .find(|f| f.id == id)
        .map(|f| f.status.clone())
        .ok_or_else(|| format!("File not found: {id}"))?;
    ensure_not_frozen(status, false)?;
    queue.files.retain(|f| f.id != id);
    Ok(())
}

pub fn clear_files(queue: &mut WorkQueue) {
    queue.files.clear();
}

fn normalize_path_key(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    #[cfg(windows)]
    {
        replaced.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        replaced
    }
}

pub fn add_files(queue: &mut WorkQueue, paths: Vec<String>) -> usize {
    let mut seen: HashSet<String> = queue
        .files
        .iter()
        .map(|f| normalize_path_key(&f.input_path))
        .collect();
    let mut added = 0;
    for path in paths {
        let key = normalize_path_key(&path);
        if !seen.insert(key) {
            continue;
        }
        if let Some(file) = create_video_file(&path, None) {
            queue.files.push(file);
            added += 1;
        }
    }
    added
}

pub fn add_folder(queue: &mut WorkQueue, folder: &str) -> usize {
    let mut seen: HashSet<String> = queue
        .files
        .iter()
        .map(|f| normalize_path_key(&f.input_path))
        .collect();
    let mut added = 0;
    for file in scan_directory(folder, true) {
        let key = normalize_path_key(&file.input_path);
        if !seen.insert(key) {
            continue;
        }
        queue.files.push(file);
        added += 1;
    }
    added
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AddPathsStats {
    pub added: usize,
    pub skipped_non_video: usize,
    pub skipped_duplicates: usize,
}

pub fn add_paths(queue: &mut WorkQueue, paths: Vec<String>) -> AddPathsStats {
    let mut seen: HashSet<String> = queue
        .files
        .iter()
        .map(|f| normalize_path_key(&f.input_path))
        .collect();
    let mut stats = AddPathsStats::default();

    for path in paths {
        if std::path::Path::new(&path).is_dir() {
            for file in scan_directory(&path, true) {
                let key = normalize_path_key(&file.input_path);
                if !seen.insert(key) {
                    stats.skipped_duplicates += 1;
                    continue;
                }
                queue.files.push(file);
                stats.added += 1;
            }
            continue;
        }

        if !is_video_file(&path) {
            stats.skipped_non_video += 1;
            continue;
        }

        let key = normalize_path_key(&path);
        if !seen.insert(key) {
            stats.skipped_duplicates += 1;
            continue;
        }
        if let Some(file) = create_video_file(&path, None) {
            queue.files.push(file);
            stats.added += 1;
        }
    }

    stats
}

fn apply_regenerate_reset(file: &mut VideoFile, feedback: Option<&str>) {
    if feedback.is_none() {
        return;
    }
    file.generated_command.clear();
    file.command_args.clear();
    file.description.clear();
    file.reasoning.clear();
    file.error_message.clear();
    file.status = FileStatus::Pending;
    file.is_approved = false;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_video_file(id: &str, overrides: Option<fn(&mut VideoFile)>) -> VideoFile {
        let mut file = VideoFile {
            id: id.to_string(),
            input_path: format!("/media/Show/Season 01/{}.mkv", id),
            output_path: String::new(),
            scan_root: "/media/Show".to_string(),
            ffprobe_raw: String::new(),
            metadata: Some(crate::models::FileMetadata {
                container: "mkv".to_string(),
                video: crate::models::VideoMetadata {
                    codec: "h264".to_string(),
                    width: 1920,
                    height: 1080,
                    hdr: false,
                    bit_depth: 8,
                    fps: 24.0,
                },
                audio_streams: vec![],
                subtitle_streams: vec![],
                subtitle_count: 0,
                has_chapters: false,
                duration: 3600.0,
                bitrate: 5000000,
            }),
            generated_command: String::new(),
            command_args: String::new(),
            description: String::new(),
            reasoning: String::new(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: String::new(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: String::new(),
        };
        if let Some(f) = overrides {
            f(&mut file);
        }
        file
    }

    // ── scan_and_analyze tests ──

    #[tokio::test]
    async fn scan_and_analyze_returns_error_for_empty_ffprobe_path() {
        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = scan_and_analyze(&mut queue, vec![], "").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("FFprobe path is not configured"));
    }

    #[tokio::test]
    async fn scan_and_analyze_skips_already_analyzed_items() {
        let file = create_test_video_file("file1", None); // metadata is Some by default

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![file],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = scan_and_analyze(&mut queue, vec!["file1".to_string()], "/usr/bin/ffprobe")
            .await;
        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 0); // skipped, so not in updated_files
    }

    #[tokio::test]
    async fn scan_and_analyze_sets_error_status_on_ffprobe_failure() {
        let mut file = create_test_video_file("file1", None);
        file.metadata = None; // ensure no metadata so ffprobe is attempted

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![file],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = scan_and_analyze(
            &mut queue,
            vec!["file1".to_string()],
            "/nonexistent/ffprobe",
        )
        .await;

        // Function returns Ok because it handles per-file errors internally
        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 1);

        let updated_file = &updated[0];
        assert_eq!(updated_file.status, FileStatus::Error);
        assert!(!updated_file.error_message.is_empty());

        // Verify queue was mutated in-place
        let queue_file = queue.files.iter().find(|f| f.id == "file1").unwrap();
        assert_eq!(queue_file.status, FileStatus::Error);
        assert!(!queue_file.error_message.is_empty());
    }

    // ── apply_command_template tests ──

    #[test]
    fn apply_template_assembles_command_per_target() {
        let source = create_test_video_file("source", Some(|f| {
            f.command_args = "-c:v copy -c:a opus".to_string();
            f.description = "Copy video, re-encode audio".to_string();
            f.reasoning = "AAC is compatible".to_string();
        }));
        let target = create_test_video_file("target", None);

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source.clone(), target.clone()],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        );

        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 1);

        let updated_target = &updated[0];
        assert!(updated_target.generated_command.contains("ffmpeg"));
        assert!(updated_target.generated_command.contains("target.mkv"));
        assert_eq!(updated_target.command_args, "-c:v copy -c:a opus");
        assert_eq!(updated_target.description, "Copy video, re-encode audio");
        assert_eq!(updated_target.reasoning, "AAC is compatible");
        assert!(!updated_target.output_path.is_empty());
    }

    #[test]
    fn apply_template_skips_targets_without_metadata() {
        let source = create_test_video_file("source", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        let mut target = create_test_video_file("target", None);
        target.metadata = None;

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source, target],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        );

        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 0);
    }

    #[test]
    fn apply_template_skips_targets_with_existing_command() {
        let source = create_test_video_file("source", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        let mut target = create_test_video_file("target", None);
        target.generated_command = "ffmpeg -i input.mkv output.mkv".to_string();

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source, target],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        );

        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 0);
    }

    #[test]
    fn apply_template_returns_error_if_source_not_found() {
        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "missing",
            &["target".to_string()],
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn apply_template_returns_error_if_source_has_no_command_args() {
        let source = create_test_video_file("source", None);

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("no command_args"));
    }

    #[test]
    fn apply_template_returns_empty_list_when_no_targets_eligible() {
        let source = create_test_video_file("source", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        let mut target = create_test_video_file("target", None);
        target.metadata = None;

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source, target],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        );

        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 0);
    }

    #[test]
    fn apply_template_resolves_per_target_output_paths() {
        let source = create_test_video_file("source", Some(|f| {
            f.input_path = "/media/Show/Season 01/Episode01.mkv".to_string();
            f.scan_root = "/media/Show".to_string();
            f.command_args = "-c:v copy".to_string();
        }));
        let target = create_test_video_file("target", Some(|f| {
            f.input_path = "/media/Show/Season 01/Episode02.mkv".to_string();
            f.scan_root = "/media/Show".to_string();
        }));

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source, target],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        );

        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 1);

        let updated_target = &updated[0];
        assert_eq!(updated_target.output_path, "/transcoded/Season 01/Episode02.mkv");
        assert!(updated_target.generated_command.contains("Episode02.mkv"));
    }

    #[test]
    fn apply_template_resets_status_and_clears_error_message() {
        let source = create_test_video_file("source", Some(|f| {
            f.command_args = "-c:v copy".to_string();
            f.description = "Copy video".to_string();
            f.reasoning = "Fast transcode".to_string();
        }));
        let mut target = create_test_video_file("target", None);
        target.status = FileStatus::Error;
        target.error_message = "Previous generation failed".to_string();

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source, target],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        let result = apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        );

        assert!(result.is_ok());
        let updated = result.unwrap();
        assert_eq!(updated.len(), 1);

        let updated_target = &updated[0];
        assert_eq!(updated_target.status, FileStatus::Pending);
        assert_eq!(updated_target.error_message, "");

        // Also verify the queue was mutated in-place
        let queue_target = queue.files.iter().find(|f| f.id == "target").unwrap();
        assert_eq!(queue_target.status, FileStatus::Pending);
        assert_eq!(queue_target.error_message, "");
    }

    #[test]
    fn apply_ai_response_rejects_empty_command() {
        let mut file = create_test_video_file("file1", None);
        let response = crate::models::AiResponse {
            command: String::new(),
            description: "noop".to_string(),
            reasoning: "none".to_string(),
        };

        apply_ai_response(&mut file, response, "/transcoded", "{name}.mkv", false);

        assert_eq!(file.status, FileStatus::Error);
        assert_eq!(file.error_message, "AI returned an empty command");
        assert!(file.generated_command.is_empty());
        assert!(file.command_args.is_empty());
    }

    fn test_queue(files: Vec<VideoFile>) -> WorkQueue {
        WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: "keep quality".to_string(),
            files,
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn approve_file_sets_approved_and_command_args() {
        let file = create_test_video_file("file1", None);
        let mut queue = test_queue(vec![file]);

        approve_file(
            &mut queue,
            "file1",
            "-c:v copy -c:a copy",
            "/transcoded",
            "{name}.mkv",
            false,
        )
        .unwrap();

        let f = &queue.files[0];
        assert!(f.is_approved);
        assert_eq!(f.command_args, "-c:v copy -c:a copy");
        assert!(f.generated_command.contains("-i"));
        assert!(!f.output_path.is_empty());
    }

    #[test]
    fn approve_file_flatten_output_folders_writes_flat_output_path() {
        let file = create_test_video_file("ep", Some(|f| {
            f.scan_root = "/media".to_string();
            f.input_path = "/media/TV/Show/ep.mkv".to_string();
        }));
        let mut queue = test_queue(vec![file]);

        approve_file(
            &mut queue,
            "ep",
            "-c:v copy",
            "/transcoded",
            "{name}.mkv",
            true,
        )
        .unwrap();

        let output_path = &queue.files[0].output_path;
        assert!(
            output_path.ends_with("/ep.mkv"),
            "expected flat filename, got {output_path}"
        );
        assert!(
            !output_path.contains("/TV/"),
            "flattened path must not contain /TV/, got {output_path}"
        );
    }

    #[test]
    fn approve_file_rejects_without_metadata() {
        let mut file = create_test_video_file("file1", None);
        file.metadata = None;
        let mut queue = test_queue(vec![file]);

        assert!(approve_file(
            &mut queue,
            "file1",
            "-c:v copy",
            "/transcoded",
            "{name}.mkv",
            false,
        )
        .is_err());
    }

    #[test]
    fn approve_file_rejects_empty_or_whitespace_command_args() {
        let file = create_test_video_file("file1", None);
        let mut queue = test_queue(vec![file]);

        assert!(approve_file(&mut queue, "file1", "", "/transcoded", "{name}.mkv", false).is_err());
        assert!(approve_file(&mut queue, "file1", "   ", "/transcoded", "{name}.mkv", false).is_err());
    }

    #[test]
    fn approve_file_rejects_missing_id() {
        let mut queue = test_queue(vec![]);

        assert!(approve_file(
            &mut queue,
            "missing",
            "-c:v copy",
            "/transcoded",
            "{name}.mkv",
            false,
        )
        .is_err());
    }

    #[test]
    fn ensure_not_frozen_errors_when_in_fifo_or_processing() {
        assert!(ensure_not_frozen(FileStatus::Pending, true).is_err());
        assert!(ensure_not_frozen(FileStatus::Processing, false).is_err());
        assert!(ensure_not_frozen(FileStatus::Pending, false).is_ok());
        assert!(ensure_not_frozen(FileStatus::Completed, false).is_ok());
    }

    #[test]
    fn is_pickup_eligible_true_for_approved_pending_with_args() {
        let file = create_test_video_file("a", Some(|f| {
            f.is_approved = true;
            f.status = FileStatus::Pending;
            f.command_args = "-c:v copy".to_string();
        }));
        assert!(is_pickup_eligible(&file));
    }

    #[test]
    fn is_pickup_eligible_false_when_command_args_blank() {
        let file = create_test_video_file("a", Some(|f| {
            f.is_approved = true;
            f.status = FileStatus::Pending;
            f.command_args = "  ".to_string();
        }));
        assert!(!is_pickup_eligible(&file));
    }

    #[test]
    fn is_pickup_eligible_false_when_not_approved_or_not_pending() {
        let not_approved = create_test_video_file("a", Some(|f| {
            f.is_approved = false;
            f.command_args = "-c:v copy".to_string();
        }));
        let processing = create_test_video_file("b", Some(|f| {
            f.is_approved = true;
            f.status = FileStatus::Processing;
            f.command_args = "-c:v copy".to_string();
        }));
        assert!(!is_pickup_eligible(&not_approved));
        assert!(!is_pickup_eligible(&processing));
    }

    #[test]
    fn approve_file_rejects_processing_completed_skipped() {
        for status in [FileStatus::Processing, FileStatus::Completed, FileStatus::Skipped] {
            let mut file = create_test_video_file("file1", Some(|f| {
                f.command_args = "-c:v copy".to_string();
                f.generated_command = "ffmpeg".to_string();
            }));
            file.status = status.clone();
            let mut queue = test_queue(vec![file]);
            assert!(approve_file(&mut queue, "file1", "-c:v copy", "/transcoded", "{name}.mkv", false).is_err());
            assert_eq!(queue.files[0].status, status);
        }
    }

    #[test]
    fn unapprove_skip_reset_remove_reject_processing() {
        let file = create_test_video_file("file1", Some(|f| {
            f.status = FileStatus::Processing;
            f.is_approved = true;
            f.command_args = "-c:v copy".to_string();
        }));
        let mut queue = test_queue(vec![file.clone()]);
        assert!(unapprove_file(&mut queue, "file1").is_err());
        assert!(queue.files[0].is_approved);
        assert!(skip_file(&mut queue, "file1").is_err());
        assert_eq!(queue.files[0].status, FileStatus::Processing);
        assert!(reset_file(&mut queue, "file1").is_err());
        assert!(remove_file(&mut queue, "file1").is_err());
        assert_eq!(queue.files.len(), 1);
    }

    #[test]
    fn unapprove_file_clears_approved_only() {
        let file = create_test_video_file("file1", None);
        let mut queue = test_queue(vec![file]);

        approve_file(
            &mut queue,
            "file1",
            "-c:v copy -c:a copy",
            "/transcoded",
            "{name}.mkv",
            false,
        )
        .unwrap();
        unapprove_file(&mut queue, "file1").unwrap();

        assert!(!queue.files[0].is_approved);
        assert!(!queue.files[0].command_args.is_empty());
    }

    #[test]
    fn reset_file_from_completed_goes_pending_unapproved_keeps_args() {
        let file = create_test_video_file("file1", Some(|f| {
            f.status = FileStatus::Completed;
            f.is_approved = true;
            f.command_args = "-c:v copy -c:a copy".to_string();
            f.generated_command = "ffmpeg -i in.mkv -c:v copy out.mkv".to_string();
            f.error_message = "old".to_string();
        }));
        let mut queue = test_queue(vec![file]);

        reset_file(&mut queue, "file1").unwrap();

        let f = &queue.files[0];
        assert_eq!(f.status, FileStatus::Pending);
        assert!(!f.is_approved);
        assert!(!f.command_args.is_empty());
        assert!(f.metadata.is_some());
        assert_eq!(f.command_args, "-c:v copy -c:a copy");
        assert!(f.error_message.is_empty());
    }

    #[test]
    fn prepare_reprocess_from_error_pending_approved_clears_error_keeps_args() {
        let file = create_test_video_file("file1", Some(|f| {
            f.status = FileStatus::Error;
            f.is_approved = false;
            f.command_args = "-c:v copy -c:a copy".to_string();
            f.generated_command = "ffmpeg -i in.mkv -c:v copy out.mkv".to_string();
            f.output_path = "/transcoded/file1.mkv".to_string();
            f.error_message = "encode failed".to_string();
        }));
        let mut queue = test_queue(vec![file]);

        prepare_reprocess(&mut queue, "file1").unwrap();

        let f = &queue.files[0];
        assert_eq!(f.status, FileStatus::Pending);
        assert!(f.is_approved);
        assert!(f.error_message.is_empty());
        assert_eq!(f.command_args, "-c:v copy -c:a copy");
        assert_eq!(f.generated_command, "ffmpeg -i in.mkv -c:v copy out.mkv");
        assert_eq!(f.output_path, "/transcoded/file1.mkv");
    }

    #[test]
    fn prepare_reprocess_from_completed_pending_approved_keeps_output_path() {
        let file = create_test_video_file("file1", Some(|f| {
            f.status = FileStatus::Completed;
            f.is_approved = true;
            f.command_args = "-c:v copy".to_string();
            f.generated_command = "ffmpeg -i in.mkv out.mkv".to_string();
            f.output_path = "/transcoded/file1.mkv".to_string();
            f.output_size = 12345;
            f.completed_at = "2024-01-01T00:00:00Z".to_string();
            f.processing_duration = 12.5;
        }));
        let mut queue = test_queue(vec![file]);

        prepare_reprocess(&mut queue, "file1").unwrap();

        let f = &queue.files[0];
        assert_eq!(f.status, FileStatus::Pending);
        assert!(f.is_approved);
        assert_eq!(f.output_path, "/transcoded/file1.mkv");
        assert_eq!(f.command_args, "-c:v copy");
        assert_eq!(f.generated_command, "ffmpeg -i in.mkv out.mkv");
        assert_eq!(f.output_size, 12345);
        assert_eq!(f.completed_at, "2024-01-01T00:00:00Z");
        assert_eq!(f.processing_duration, 12.5);
    }

    #[test]
    fn prepare_reprocess_rejects_empty_command_args() {
        let file = create_test_video_file("file1", Some(|f| {
            f.status = FileStatus::Error;
            f.command_args = String::new();
        }));
        let mut queue = test_queue(vec![file]);

        let err = prepare_reprocess(&mut queue, "file1").unwrap_err();
        assert_eq!(err, "No command to reprocess");
    }

    #[test]
    fn prepare_reprocess_rejects_skipped() {
        let file = create_test_video_file("file1", Some(|f| {
            f.status = FileStatus::Skipped;
            f.command_args = "-c:v copy".to_string();
        }));
        let mut queue = test_queue(vec![file]);

        let err = prepare_reprocess(&mut queue, "file1").unwrap_err();
        assert_eq!(err, "File cannot be reprocessed from this status");
    }

    #[tokio::test]
    async fn generate_commands_skips_when_command_args_already_set() {
        let file = create_test_video_file("file1", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        let mut queue = test_queue(vec![file]);
        let provider = AiProviderConfig {
            base_url: "http://127.0.0.1:1".to_string(),
            api_key: String::new(),
            model: "none".to_string(),
        };

        let result = generate_commands(
            &mut queue,
            vec!["file1".to_string()],
            None,
            &provider,
            "/transcoded",
            "{name}.mkv",
            false,
        )
        .await
        .unwrap();

        assert!(result.is_empty());
        assert_eq!(queue.files[0].command_args, "-c:v copy");
    }

    #[test]
    fn generate_regenerate_clears_approved() {
        let mut file = create_test_video_file("file1", Some(|f| {
            f.is_approved = true;
            f.command_args = "-c:v copy".to_string();
            f.generated_command = "ffmpeg -i in.mkv out.mkv".to_string();
        }));

        apply_regenerate_reset(&mut file, Some("make it smaller"));

        assert!(!file.is_approved);
        assert!(file.command_args.is_empty());
        assert!(file.generated_command.is_empty());
    }

    #[test]
    fn skip_file_sets_skipped() {
        let file = create_test_video_file("file1", None);
        let mut queue = test_queue(vec![file]);

        skip_file(&mut queue, "file1").unwrap();

        assert_eq!(queue.files[0].status, FileStatus::Skipped);
    }

    #[test]
    fn clear_files_keeps_guidelines() {
        let file = create_test_video_file("file1", None);
        let mut queue = test_queue(vec![file]);
        queue.guidelines = "do not crop".to_string();

        clear_files(&mut queue);

        assert!(queue.files.is_empty());
        assert_eq!(queue.guidelines, "do not crop");
    }

    #[test]
    fn remove_file_removes_item() {
        let file1 = create_test_video_file("file1", None);
        let file2 = create_test_video_file("file2", None);
        let mut queue = test_queue(vec![file1, file2]);

        remove_file(&mut queue, "file1").unwrap();

        assert_eq!(queue.files.len(), 1);
        assert_eq!(queue.files[0].id, "file2");
    }

    #[test]
    fn remove_file_rejects_missing_id() {
        let mut queue = test_queue(vec![]);

        assert!(remove_file(&mut queue, "missing").is_err());
    }

    #[test]
    fn add_files_skips_duplicate_paths_windows_insensitive() {
        // If you cannot detect OS, always normalize: replace \\ with / and to_lowercase on windows cfg
        let mut queue = test_queue(vec![]);
        let added = add_files(
            &mut queue,
            vec!["C:/A.mkv".to_string(), "c:\\a.mkv".to_string()],
        );
        #[cfg(windows)]
        {
            assert_eq!(added, 1);
            assert_eq!(queue.files.len(), 1);
        }
        #[cfg(not(windows))]
        {
            assert_eq!(added, 2);
            assert_eq!(queue.files.len(), 2);
        }

        let added_again = add_files(&mut queue, vec!["C:/A.mkv".to_string()]);
        assert_eq!(added_again, 0);
        #[cfg(windows)]
        assert_eq!(queue.files.len(), 1);
        #[cfg(not(windows))]
        assert_eq!(queue.files.len(), 2);
    }

    #[test]
    fn add_folder_adds_scanned_videos_and_skips_existing_paths() {
        let dir = std::env::temp_dir().join(format!("mb_add_folder_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("one.mkv"), b"x").unwrap();
        std::fs::write(dir.join("two.mkv"), b"x").unwrap();
        std::fs::write(dir.join("skip.txt"), b"x").unwrap();

        let mut queue = test_queue(vec![]);
        let first = add_folder(&mut queue, dir.to_str().unwrap());
        assert_eq!(first, 2);
        assert_eq!(queue.files.len(), 2);

        let expected_root = dir
            .parent()
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string();
        let added_dir = dir
            .to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string();
        for file in &queue.files {
            let root = file
                .scan_root
                .replace('\\', "/")
                .trim_end_matches('/')
                .to_string();
            assert_eq!(root, expected_root);
            assert_ne!(root, added_dir);
        }

        let second = add_folder(&mut queue, dir.to_str().unwrap());
        assert_eq!(second, 0);
        assert_eq!(queue.files.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_folder_skips_paths_already_added_via_add_files() {
        let dir = std::env::temp_dir().join(format!("mb_add_folder_exist_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let one = dir.join("one.mkv");
        std::fs::write(&one, b"x").unwrap();
        std::fs::write(dir.join("two.mkv"), b"x").unwrap();

        let mut queue = test_queue(vec![]);
        let added_file = add_files(&mut queue, vec![one.to_string_lossy().to_string()]);
        assert_eq!(added_file, 1);

        let added_folder = add_folder(&mut queue, dir.to_str().unwrap());
        assert_eq!(added_folder, 1);
        assert_eq!(queue.files.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_paths_adds_loose_videos_skips_non_video() {
        let dir = std::env::temp_dir().join(format!(
            "mb_add_paths_loose_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mkv = dir.join("a.mkv");
        let txt = dir.join("notes.txt");
        std::fs::write(&mkv, b"x").unwrap();
        std::fs::write(&txt, b"x").unwrap();

        let mut queue = test_queue(vec![]);
        let stats = add_paths(
            &mut queue,
            vec![
                mkv.to_string_lossy().to_string(),
                txt.to_string_lossy().to_string(),
            ],
        );
        assert_eq!(stats.added, 1);
        assert_eq!(stats.skipped_non_video, 1);
        assert_eq!(stats.skipped_duplicates, 0);
        assert_eq!(queue.files.len(), 1);
        assert!(queue.files[0].input_path.ends_with("a.mkv"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_paths_recurses_folders_like_add_folder() {
        let dir = std::env::temp_dir().join(format!(
            "mb_add_paths_folder_{}",
            std::process::id()
        ));
        let nested = dir.join("season");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(dir.join("root.mkv"), b"x").unwrap();
        std::fs::write(nested.join("ep.mkv"), b"x").unwrap();
        std::fs::write(dir.join("readme.txt"), b"x").unwrap();

        let mut queue = test_queue(vec![]);
        let stats = add_paths(&mut queue, vec![dir.to_string_lossy().to_string()]);
        assert_eq!(stats.added, 2);
        assert_eq!(stats.skipped_non_video, 0);
        assert_eq!(stats.skipped_duplicates, 0);
        assert_eq!(queue.files.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_paths_mixed_files_and_folder_dedupes() {
        let dir = std::env::temp_dir().join(format!(
            "mb_add_paths_mixed_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let one = dir.join("one.mkv");
        let two = dir.join("two.mkv");
        std::fs::write(&one, b"x").unwrap();
        std::fs::write(&two, b"x").unwrap();

        let mut queue = test_queue(vec![]);
        let stats = add_paths(
            &mut queue,
            vec![
                one.to_string_lossy().to_string(),
                dir.to_string_lossy().to_string(),
            ],
        );
        assert_eq!(stats.added, 2);
        assert_eq!(stats.skipped_duplicates, 1);
        assert_eq!(stats.skipped_non_video, 0);
        assert_eq!(queue.files.len(), 2);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_paths_counts_duplicate_loose_file() {
        let dir = std::env::temp_dir().join(format!(
            "mb_add_paths_dupe_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let mkv = dir.join("a.mkv");
        std::fs::write(&mkv, b"x").unwrap();

        let mut queue = test_queue(vec![]);
        let path = mkv.to_string_lossy().to_string();
        let first = add_paths(&mut queue, vec![path.clone()]);
        assert_eq!(first.added, 1);
        let second = add_paths(&mut queue, vec![path]);
        assert_eq!(second.added, 0);
        assert_eq!(second.skipped_duplicates, 1);
        assert_eq!(queue.files.len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn try_merge_generated_applies_on_pending() {
        let mut queue = test_queue(vec![create_test_video_file("a", None)]);
        let updated = create_test_video_file("a", Some(|f| {
            f.command_args = "-c:v copy".to_string();
            f.description = "copy".to_string();
        }));
        assert_eq!(try_merge_generated(&mut queue, &updated), MergeGenerated::Applied);
        assert_eq!(queue.files[0].command_args, "-c:v copy");
        assert_eq!(queue.files[0].description, "copy");
    }

    #[test]
    fn try_merge_generated_applies_on_error() {
        let live = create_test_video_file("a", Some(|f| {
            f.status = FileStatus::Error;
            f.error_message = "old".to_string();
        }));
        let mut queue = test_queue(vec![live]);
        let updated = create_test_video_file("a", Some(|f| {
            f.status = FileStatus::Pending;
            f.command_args = "-c:v copy".to_string();
            f.error_message.clear();
        }));
        assert_eq!(try_merge_generated(&mut queue, &updated), MergeGenerated::Applied);
        assert_eq!(queue.files[0].status, FileStatus::Pending);
        assert_eq!(queue.files[0].command_args, "-c:v copy");
    }

    #[test]
    fn try_merge_generated_refuses_skipped() {
        let live = create_test_video_file("a", Some(|f| f.status = FileStatus::Skipped));
        let mut queue = test_queue(vec![live]);
        let updated = create_test_video_file("a", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        assert_eq!(try_merge_generated(&mut queue, &updated), MergeGenerated::Refused);
        assert!(queue.files[0].command_args.is_empty());
        assert_eq!(queue.files[0].status, FileStatus::Skipped);
    }

    #[test]
    fn try_merge_generated_refuses_completed() {
        let live = create_test_video_file("a", Some(|f| f.status = FileStatus::Completed));
        let mut queue = test_queue(vec![live]);
        let updated = create_test_video_file("a", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        assert_eq!(try_merge_generated(&mut queue, &updated), MergeGenerated::Refused);
        assert_eq!(queue.files[0].status, FileStatus::Completed);
        assert!(queue.files[0].command_args.is_empty());
    }

    #[test]
    fn try_merge_generated_refuses_processing() {
        let live = create_test_video_file("a", Some(|f| f.status = FileStatus::Processing));
        let mut queue = test_queue(vec![live]);
        let updated = create_test_video_file("a", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        assert_eq!(try_merge_generated(&mut queue, &updated), MergeGenerated::Refused);
        assert_eq!(queue.files[0].status, FileStatus::Processing);
    }

    #[test]
    fn try_merge_generated_refuses_missing_id() {
        let mut queue = test_queue(vec![create_test_video_file("a", None)]);
        let other = create_test_video_file("nope", Some(|f| {
            f.command_args = "-c:v copy".to_string();
        }));
        assert_eq!(try_merge_generated(&mut queue, &other), MergeGenerated::Refused);
        assert_eq!(queue.files.len(), 1);
        assert!(queue.files[0].command_args.is_empty());
    }
}
