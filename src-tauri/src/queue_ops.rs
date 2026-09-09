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

pub async fn probe_one_snapshot(file: &mut VideoFile, ffprobe_path: &str) {
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

        probe_one_snapshot(file, ffprobe_path).await;
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
    repair: bool,
    provider: &AiProviderConfig,
    output_folder: &str,
    naming_template: &str,
    flatten_output_folders: bool,
    guidelines: &str,
) -> Result<Vec<VideoFile>, String> {
    let mut updated_files = Vec::new();

    for file in &mut snapshots {
        let Some(ctx) = generate_ctx(file, feedback.as_deref(), repair) else {
            continue;
        };
        if let Some(ref metadata) = file.metadata {
            let mut notes_for_prompt = ctx.notes.clone();
            if let Some(ref note) = ctx.append_note {
                notes_for_prompt.push(note.clone());
            }
            let result = ai::generate_command(
                provider,
                guidelines,
                metadata,
                &ctx.previous_command,
                &notes_for_prompt,
                &ctx.error_for_prompt,
            )
            .await
            .map_err(|e| e.to_string());
            apply_generate_result(
                file,
                result,
                output_folder,
                naming_template,
                flatten_output_folders,
                feedback.as_deref(),
            );
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
    repair: bool,
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
        repair,
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

pub fn merge_probed_file(queue: &mut WorkQueue, updated: &VideoFile) -> bool {
    let Some(slot) = queue.files.iter_mut().find(|f| f.id == updated.id) else {
        return false;
    };
    if !probe_gate(Some(&slot.status)) {
        return false;
    }
    *slot = updated.clone();
    true
}

pub fn probe_gate(live_status: Option<&FileStatus>) -> bool {
    match live_status {
        None => false,
        Some(FileStatus::Skipped | FileStatus::Completed | FileStatus::Processing) => false,
        Some(_) => true,
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
    file.user_notes.clear();
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

fn apply_regenerate_reset(file: &mut VideoFile) {
    file.generated_command.clear();
    file.command_args.clear();
    file.description.clear();
    file.reasoning.clear();
    file.error_message.clear();
    file.status = FileStatus::Pending;
    file.is_approved = false;
}

pub(crate) struct GenerateCtx {
    pub previous_command: String,
    pub notes: Vec<String>,
    pub error_for_prompt: String,
    pub append_note: Option<String>,
}

pub(crate) fn generate_ctx(file: &VideoFile, feedback: Option<&str>, repair: bool) -> Option<GenerateCtx> {
    let feedback_empty = feedback.map(|s| s.trim().is_empty()).unwrap_or(true);
    if !repair && feedback_empty && !file.command_args.is_empty() {
        return None;
    }
    let append_note = feedback
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Some(GenerateCtx {
        previous_command: file.command_args.clone(),
        notes: file.user_notes.clone(),
        error_for_prompt: if repair {
            file.error_message.clone()
        } else {
            String::new()
        },
        append_note,
    })
}

pub(crate) fn apply_generate_result(
    file: &mut VideoFile,
    result: Result<AiResponse, String>,
    output_folder: &str,
    naming_template: &str,
    flatten_output_folders: bool,
    feedback: Option<&str>,
) {
    match result {
        Ok(response) => {
            if let Some(fb) = feedback {
                append_user_note(&mut file.user_notes, fb);
            }
            apply_regenerate_reset(file);
            apply_ai_response(
                file,
                response,
                output_folder,
                naming_template,
                flatten_output_folders,
            );
        }
        Err(e) => {
            file.error_message = e;
            file.status = FileStatus::Error;
        }
    }
}

pub(crate) fn append_user_note(notes: &mut Vec<String>, note: &str) {
    let trimmed = note.trim();
    if trimmed.is_empty() {
        return;
    }
    notes.push(trimmed.to_string());
    const MAX_COUNT: usize = 20;
    const MAX_BYTES: usize = 8192;
    while notes.len() > MAX_COUNT {
        notes.remove(0);
    }
    while notes.len() > 1 && notes.iter().map(|s| s.len()).sum::<usize>() > MAX_BYTES {
        notes.remove(0);
    }
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
            user_notes: vec![],
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
    fn apply_template_does_not_copy_user_notes() {
        let source = create_test_video_file("source", Some(|f| {
            f.command_args = "-c:v copy".to_string();
            f.user_notes = vec!["keep grain".into()];
        }));
        let mut target = create_test_video_file("target", None);
        target.user_notes = vec!["other".into()];

        let mut queue = WorkQueue {
            output_folder: "/transcoded".to_string(),
            guidelines: String::new(),
            files: vec![source, target],
            created_at: chrono::Utc::now().to_rfc3339(),
            last_modified: chrono::Utc::now().to_rfc3339(),
        };

        apply_command_template(
            &mut queue,
            "/transcoded",
            "{name}.mkv",
            false,
            "source",
            &["target".to_string()],
        )
        .unwrap();

        let queue_target = queue.files.iter().find(|f| f.id == "target").unwrap();
        assert_eq!(queue_target.user_notes, vec!["other".to_string()]);
        assert_eq!(queue_target.command_args, "-c:v copy");
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
    fn probe_gate_allows_pending_and_error() {
        assert!(probe_gate(Some(&FileStatus::Pending)));
        assert!(probe_gate(Some(&FileStatus::Error)));
    }

    #[test]
    fn probe_gate_refuses_missing_skipped_completed_processing() {
        assert!(!probe_gate(None));
        assert!(!probe_gate(Some(&FileStatus::Skipped)));
        assert!(!probe_gate(Some(&FileStatus::Completed)));
        assert!(!probe_gate(Some(&FileStatus::Processing)));
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
    fn reset_file_clears_user_notes() {
        let file = create_test_video_file("file1", Some(|f| {
            f.status = FileStatus::Completed;
            f.user_notes = vec!["use HEVC".into()];
        }));
        let mut queue = test_queue(vec![file]);

        reset_file(&mut queue, "file1").unwrap();

        assert!(queue.files[0].user_notes.is_empty());
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
            false,
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

        apply_regenerate_reset(&mut file);

        assert!(!file.is_approved);
        assert!(file.command_args.is_empty());
        assert!(file.generated_command.is_empty());
    }

    #[test]
    fn generate_success_with_feedback_appends_user_note() {
        let mut file = create_test_video_file("file1", Some(|f| {
            f.command_args = "-c:v copy".to_string();
            f.user_notes = vec!["older note".to_string()];
            f.error_message = "stale encode error".to_string();
        }));

        let ctx = generate_ctx(&file, Some("  make it smaller  "), false).expect("should generate");
        assert_eq!(ctx.previous_command, "-c:v copy");
        assert_eq!(ctx.notes, vec!["older note".to_string()]);
        assert_eq!(ctx.error_for_prompt, "");
        assert_eq!(ctx.append_note.as_deref(), Some("make it smaller"));

        apply_generate_result(
            &mut file,
            Ok(crate::models::AiResponse {
                command: "-c:v libx265".to_string(),
                description: "hevc".to_string(),
                reasoning: String::new(),
            }),
            "/transcoded",
            "{name}.mkv",
            false,
            Some("  make it smaller  "),
        );

        assert_eq!(
            file.user_notes,
            vec!["older note".to_string(), "make it smaller".to_string()]
        );
        assert_eq!(file.command_args, "-c:v libx265");
    }

    #[test]
    fn generate_repair_does_not_skip_existing_command() {
        let file = create_test_video_file("file1", Some(|f| {
            f.command_args = "-c:v copy".to_string();
            f.user_notes = vec!["standing".to_string()];
            f.error_message = "NVENC session limit".to_string();
        }));

        let ctx = generate_ctx(&file, None, true).expect("repair should not skip");
        assert_eq!(ctx.previous_command, "-c:v copy");
        assert_eq!(ctx.notes, vec!["standing".to_string()]);
        assert_eq!(ctx.error_for_prompt, "NVENC session limit");
        assert_eq!(ctx.append_note, None);

        let ctx_empty = generate_ctx(&file, Some("   "), true).expect("repair with blank feedback");
        assert_eq!(ctx_empty.error_for_prompt, "NVENC session limit");
        assert_eq!(ctx_empty.append_note, None);
    }

    #[test]
    fn generate_without_feedback_or_repair_still_skips_existing_command() {
        let file = create_test_video_file("file1", Some(|f| {
            f.command_args = "-c:v copy".to_string();
            f.error_message = "stale encode error".to_string();
        }));

        assert!(generate_ctx(&file, None, false).is_none());
        assert!(generate_ctx(&file, Some(""), false).is_none());
        assert!(generate_ctx(&file, Some("   "), false).is_none());

        let first = create_test_video_file("file2", None);
        assert!(generate_ctx(&first, None, false).is_some());
        assert!(generate_ctx(&file, Some("make it smaller"), false).is_some());
    }

    #[test]
    fn generate_regenerate_failure_keeps_previous_command_args() {
        let mut file = create_test_video_file(
            "file1",
            Some(|f| {
                f.command_args = "-c:v copy".to_string();
                f.generated_command = "ffmpeg -i in.mkv -c:v copy out.mkv".to_string();
                f.is_approved = true;
                f.error_message = String::new();
                f.status = FileStatus::Pending;
                f.user_notes = vec!["standing".to_string()];
            }),
        );

        apply_generate_result(
            &mut file,
            Err("AI provider unavailable".to_string()),
            "/transcoded",
            "{name}.mkv",
            false,
            Some("make it smaller"),
        );

        assert_eq!(file.command_args, "-c:v copy");
        assert_eq!(
            file.generated_command,
            "ffmpeg -i in.mkv -c:v copy out.mkv"
        );
        assert_eq!(file.error_message, "AI provider unavailable");
        assert_eq!(file.status, FileStatus::Error);
        assert!(!file.command_args.is_empty());
        assert!(!file.generated_command.is_empty());
        assert_eq!(file.user_notes, vec!["standing".to_string()]);
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

    #[test]
    fn merge_probed_file_replaces_pending_slot() {
        let pending = create_test_video_file("a", Some(|f| {
            f.metadata = None;
        }));
        let mut queue = test_queue(vec![pending]);
        let mut updated = queue.files[0].clone();
        updated.metadata = create_test_video_file("a", None).metadata;
        updated.ffprobe_raw = "{\"ok\":true}".to_string();

        assert!(merge_probed_file(&mut queue, &updated));
        assert!(queue.files[0].metadata.is_some());
        assert_eq!(queue.files[0].ffprobe_raw, "{\"ok\":true}");
    }

    #[test]
    fn merge_probed_file_ignores_unknown_id() {
        let mut queue = test_queue(vec![create_test_video_file("a", None)]);
        let other = create_test_video_file("nope", None);
        assert!(!merge_probed_file(&mut queue, &other));
        assert_eq!(queue.files.len(), 1);
        assert_eq!(queue.files[0].id, "a");
    }

    #[test]
    fn merge_probed_file_refuses_skipped_completed_processing() {
        for status in [FileStatus::Skipped, FileStatus::Completed, FileStatus::Processing] {
            let mut live = create_test_video_file("a", None);
            live.status = status.clone();
            let mut queue = test_queue(vec![live]);
            let pre_raw = queue.files[0].ffprobe_raw.clone();
            let mut updated = create_test_video_file("a", None);
            updated.ffprobe_raw = "raw".to_string();
            assert_eq!(updated.status, FileStatus::Pending);
            assert!(updated.metadata.is_some());

            assert!(!merge_probed_file(&mut queue, &updated));
            assert_eq!(queue.files[0].status, status);
            assert_ne!(queue.files[0].ffprobe_raw, "raw");
            assert_eq!(queue.files[0].ffprobe_raw, pre_raw);
        }
    }

    #[test]
    fn append_user_note_ignores_blank() {
        let mut notes = vec!["keep".to_string()];
        append_user_note(&mut notes, "");
        append_user_note(&mut notes, "   ");
        append_user_note(&mut notes, "\t\n");
        assert_eq!(notes, vec!["keep".to_string()]);
    }

    #[test]
    fn append_user_note_keeps_last_20() {
        let mut notes = Vec::new();
        for i in 0..21 {
            append_user_note(&mut notes, &format!("n{i}"));
        }
        assert_eq!(notes.len(), 20);
        assert_eq!(notes[0], "n1");
        assert_eq!(notes[19], "n20");
    }

    #[test]
    fn append_user_note_drops_oldest_when_joined_exceeds_8192() {
        let mut notes = vec!["a".repeat(4000), "b".repeat(4000)];
        append_user_note(&mut notes, &"c".repeat(2000));
        // 4000+4000+2000 = 10000 > 8192; drop oldest until under cap
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0], "b".repeat(4000));
        assert_eq!(notes[1], "c".repeat(2000));
        assert_eq!(notes.iter().map(|s| s.len()).sum::<usize>(), 6000);

        // Single note over 8192 bytes is kept (stop at len == 1)
        let mut oversized = Vec::new();
        append_user_note(&mut oversized, &"x".repeat(9000));
        assert_eq!(oversized.len(), 1);
        assert_eq!(oversized[0].len(), 9000);
    }
}
