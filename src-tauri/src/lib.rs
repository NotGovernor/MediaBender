mod models;
mod scanner;
mod ffprobe;
mod ai;
mod executor;
mod command_builder;
mod defaults;
mod binary_discovery;
mod persistence;
mod settings_ops;
mod queue_ops;
mod processing;
mod job_fifo;
mod app_startup;
mod fs_ops;
mod process_cmd;
mod interview_ops;

use models::*;
use app_startup::{AppState, build_app_state};
use persistence::{JsonFileStore, Persistence};
use settings_ops::{
    clamp_max_parallel, clamp_settings_max_parallel,
    verify_ffmpeg_paths as verify_ffmpeg_paths_impl,
};
use queue_ops::{
    add_files as add_files_impl, add_folder as add_folder_impl, add_paths as add_paths_impl,
    apply_command_template as apply_command_template_impl, approve_file as approve_file_impl,
    clear_files as clear_files_impl, generate_commands_snapshots, merge_generated_file,
    prepare_reprocess, remove_file as remove_file_impl, reset_file as reset_file_impl,
    scan_and_analyze_snapshots, skip_file as skip_file_impl, unapprove_file as unapprove_file_impl,
};
use tauri::Emitter;

fn persist_queue(store: &JsonFileStore, queue: &mut WorkQueue) -> Result<WorkQueue, String> {
    queue.last_modified = chrono::Utc::now().to_rfc3339();
    store.save_queue(queue)?;
    Ok(queue.clone())
}

async fn file_in_fifo(state: &AppState, id: &str) -> bool {
    state.job_fifo.fifo.lock().await.contains(id)
}

async fn ensure_id_not_frozen(state: &AppState, id: &str) -> Result<(), String> {
    let in_fifo = file_in_fifo(state, id).await;
    let status = {
        let queue = state.queue.lock().await;
        queue.files.iter().find(|f| f.id == id).map(|f| f.status.clone())
    };
    match status {
        Some(status) => queue_ops::ensure_not_frozen(status, in_fifo),
        None => Ok(()), // let the mutator return File not found
    }
}

fn active_provider_or_err(settings: &AppSettings) -> Result<AiProviderConfig, String> {
    let provider = settings
        .providers
        .get(settings.active_provider_index)
        .cloned()
        .ok_or_else(|| "No active provider configured".to_string())?;
    if provider.base_url.trim().is_empty()
        || provider.api_key.trim().is_empty()
        || provider.model.trim().is_empty()
    {
        return Err("No active provider configured".into());
    }
    Ok(provider)
}

#[tauri::command]
async fn add_files(paths: Vec<String>, state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    let mut queue = state.queue.lock().await;
    add_files_impl(&mut queue, paths);
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn add_folder(folder_path: String, state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    let mut queue = state.queue.lock().await;
    add_folder_impl(&mut queue, &folder_path);
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn add_paths(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<AddPathsResult, String> {
    let mut queue = state.queue.lock().await;
    let stats = add_paths_impl(&mut queue, paths);
    let queue = persist_queue(&state.store, &mut queue)?;
    Ok(AddPathsResult {
        queue,
        added: stats.added,
        skipped_non_video: stats.skipped_non_video,
        skipped_duplicates: stats.skipped_duplicates,
    })
}

#[tauri::command]
async fn remove_file(file_id: String, state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    ensure_id_not_frozen(&state, &file_id).await?;
    let mut queue = state.queue.lock().await;
    remove_file_impl(&mut queue, &file_id)?;
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn clear_queue(state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    let mut queue = state.queue.lock().await;
    clear_files_impl(&mut queue);
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn approve_file(
    file_id: String,
    command_args: String,
    state: tauri::State<'_, AppState>,
) -> Result<WorkQueue, String> {
    let (output_folder, naming_template) = {
        let settings = state.settings.lock().await;
        (settings.default_output_folder.clone(), settings.naming_template.clone())
    };
    ensure_id_not_frozen(&state, &file_id).await?;
    let mut queue = state.queue.lock().await;
    approve_file_impl(&mut queue, &file_id, &command_args, &output_folder, &naming_template)?;
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn unapprove_file(file_id: String, state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    ensure_id_not_frozen(&state, &file_id).await?;
    let mut queue = state.queue.lock().await;
    unapprove_file_impl(&mut queue, &file_id)?;
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn skip_file(file_id: String, state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    ensure_id_not_frozen(&state, &file_id).await?;
    let mut queue = state.queue.lock().await;
    skip_file_impl(&mut queue, &file_id)?;
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn reset_file(file_id: String, state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    ensure_id_not_frozen(&state, &file_id).await?;
    let mut queue = state.queue.lock().await;
    reset_file_impl(&mut queue, &file_id)?;
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn scan_and_analyze(
    file_ids: Vec<String>,
    ffprobe_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<WorkQueue, String> {
    let mut snapshots = {
        let queue = state.queue.lock().await;
        queue
            .files
            .iter()
            .filter(|f| file_ids.iter().any(|id| id == &f.id))
            .cloned()
            .collect::<Vec<VideoFile>>()
    }; // mutex released before ffprobe

    let results = scan_and_analyze_snapshots(&mut snapshots, &ffprobe_path).await?;

    let mut queue = state.queue.lock().await;
    for updated in results {
        if let Some(slot) = queue.files.iter_mut().find(|f| f.id == updated.id) {
            *slot = updated;
        }
    }
    persist_queue(&state.store, &mut queue)
}

#[tauri::command]
async fn generate_commands(
    file_ids: Vec<String>,
    feedback: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<WorkQueue, String> {
    let (provider, output_folder, naming_template, guidelines, snapshots) = {
        let settings = state.settings.lock().await;
        let provider = settings
            .providers
            .get(settings.active_provider_index)
            .cloned()
            .ok_or("No active provider configured")?;
        let output_folder = settings.default_output_folder.clone();
        let naming_template = settings.naming_template.clone();
        drop(settings);
        let queue = state.queue.lock().await;
        let guidelines = queue.guidelines.clone();
        let snapshots: Vec<VideoFile> = queue
            .files
            .iter()
            .filter(|f| file_ids.iter().any(|id| id == &f.id))
            .cloned()
            .collect();
        (provider, output_folder, naming_template, guidelines, snapshots)
    }; // mutexes released before HTTP

    let mut allowed = Vec::new();
    for snap in snapshots {
        if ensure_id_not_frozen(&state, &snap.id).await.is_err() {
            if feedback.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
                return Err("File is in the encode queue".into());
            }
            continue;
        }
        allowed.push(snap);
    }
    if allowed.is_empty() {
        let queue = state.queue.lock().await;
        return Ok(queue.clone());
    }

    for snapshot in allowed {
        let results = generate_commands_snapshots(
            vec![snapshot],
            feedback.clone(),
            &provider,
            &output_folder,
            &naming_template,
            &guidelines,
        )
        .await?;
        for updated in results {
            if ensure_id_not_frozen(&state, &updated.id).await.is_err() {
                continue;
            }
            let mut queue = state.queue.lock().await;
            // Skip/reset/remove can win during HTTP; do not restore Pending + command.
            let live_ok = match queue.files.iter().find(|f| f.id == updated.id) {
                Some(live) => !matches!(
                    live.status,
                    FileStatus::Skipped | FileStatus::Completed | FileStatus::Processing
                ),
                None => false,
            };
            if !live_ok {
                continue;
            }
            merge_generated_file(&mut queue, &updated);
            persist_queue(&state.store, &mut queue)?;
            drop(queue);
            let _ = app.emit("generate-event", updated);
        }
    }

    let queue = state.queue.lock().await;
    Ok(queue.clone())
}

#[tauri::command]
async fn apply_command_template(
    source_id: String,
    target_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<WorkQueue, String> {
    ensure_id_not_frozen(&state, &source_id).await?;
    let mut allowed_targets = Vec::new();
    for id in target_ids {
        if ensure_id_not_frozen(&state, &id).await.is_ok() {
            allowed_targets.push(id);
        }
    }
    let (output_folder, naming_template) = {
        let settings = state.settings.lock().await;
        (settings.default_output_folder.clone(), settings.naming_template.clone())
    };
    let mut queue = state.queue.lock().await;
    apply_command_template_impl(&mut queue, &output_folder, &naming_template, &source_id, &allowed_targets)?;
    persist_queue(&state.store, &mut queue)
}

#[tauri::command] async fn fetch_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    ai::fetch_models(&base_url, &api_key).await.map_err(|e| e.to_string())
}

#[tauri::command] async fn start_processing(file_ids: Vec<String>, ffmpeg_path: String, state: tauri::State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let max_parallel = {
        let s = state.settings.lock().await;
        clamp_max_parallel(s.max_parallel) as usize
    };
    let already_scheduled: std::collections::HashSet<String> = {
        let fifo = state.job_fifo.fifo.lock().await;
        fifo.scheduled_ids().into_iter().collect()
    };
    let mut to_queue = Vec::new();
    {
        let queue = state.queue.lock().await;
        for id in &file_ids {
            if already_scheduled.contains(id) {
                continue;
            }
            if let Some(f) = queue.files.iter().find(|f| f.id == *id) {
                if f.is_approved && f.status == FileStatus::Pending && !f.command_args.trim().is_empty() {
                    to_queue.push(id.clone());
                }
            }
        }
    }
    if to_queue.is_empty() {
        let fifo = state.job_fifo.fifo.lock().await;
        if fifo.is_active() {
            return Ok(());
        }
        return Err("No eligible files to process".into());
    }
    {
        let mut fifo = state.job_fifo.fifo.lock().await;
        fifo.push_back(to_queue);
    }
    processing::ensure_workers(
        ffmpeg_path,
        max_parallel,
        state.tracker.clone(),
        state.current_token.clone(),
        state.job_fifo.clone(),
        app.clone(),
        state.queue.clone(),
        state.store.clone(),
    )
    .await;
    processing::emit_pipeline_event(&app, &state.job_fifo).await;
    Ok(())
}

#[tauri::command]
async fn reprocess_file(
    file_id: String,
    ffmpeg_path: String,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<WorkQueue, String> {
    let max_parallel = {
        let s = state.settings.lock().await;
        clamp_max_parallel(s.max_parallel) as usize
    };
    {
        let fifo = state.job_fifo.fifo.lock().await;
        if fifo.is_running(&file_id) {
            return Err("File is already processing".into());
        }
    }
    {
        let mut queue = state.queue.lock().await;
        prepare_reprocess(&mut queue, &file_id)?;
        persist_queue(&state.store, &mut queue)?;
    }
    {
        let mut fifo = state.job_fifo.fifo.lock().await;
        fifo.push_front(file_id.clone());
    }
    processing::ensure_workers(
        ffmpeg_path,
        max_parallel,
        state.tracker.clone(),
        state.current_token.clone(),
        state.job_fifo.clone(),
        app.clone(),
        state.queue.clone(),
        state.store.clone(),
    )
    .await;
    processing::emit_pipeline_event(&app, &state.job_fifo).await;
    let queue = state.queue.lock().await;
    Ok(queue.clone())
}

#[tauri::command] async fn stop_processing(state: tauri::State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    // Cancel first so idle workers exit; clear_pending so leftover ids are not started.
    let token = state.current_token.lock().await.clone();
    processing::stop_fifo(&state.job_fifo, token.as_ref()).await;
    // Then kill any children that are already running.
    state.tracker.kill_all().await;
    processing::emit_pipeline_event(&app, &state.job_fifo).await;
    Ok(())
}

#[tauri::command] async fn delete_output_file(output_path: String) -> Result<(), String> {
    fs_ops::delete_output_file(output_path).await
}

#[tauri::command]
fn output_file_exists(output_path: String) -> bool {
    fs_ops::output_file_exists(&output_path)
}

#[tauri::command] async fn save_queue(queue_json: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let queue: WorkQueue = serde_json::from_str(&queue_json).map_err(|e| format!("Invalid queue JSON: {}", e))?;
    state.store.save_queue(&queue)?;
    let mut mem_queue = state.queue.lock().await;
    *mem_queue = queue;
    Ok(())
}

#[tauri::command] async fn load_queue(state: tauri::State<'_, AppState>) -> Result<WorkQueue, String> {
    let queue = state.queue.lock().await;
    Ok(queue.clone())
}

#[tauri::command] async fn load_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

#[tauri::command] async fn save_settings(mut new_settings: AppSettings, state: tauri::State<'_, AppState>) -> Result<(), String> {
    clamp_settings_max_parallel(&mut new_settings);
    state.store.save_settings(&new_settings)?;
    let mut settings = state.settings.lock().await;
    *settings = new_settings;
    Ok(())
}

#[tauri::command] async fn verify_ffmpeg_paths(state: tauri::State<'_, AppState>) -> Result<(bool, bool), String> {
    let mut settings = state.settings.lock().await;
    Ok(verify_ffmpeg_paths_impl(&mut settings))
}

#[tauri::command] async fn load_guidelines(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let queue = state.queue.lock().await;
    Ok(queue.guidelines.clone())
}

#[tauri::command] async fn save_guidelines(guidelines: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.store.save_guidelines(&guidelines)?;
    let mut queue = state.queue.lock().await;
    queue.guidelines = guidelines;
    Ok(())
}

#[tauri::command] async fn get_default_guidelines() -> Result<String, String> {
    Ok(defaults::default_guidelines())
}

#[tauri::command]
async fn interview_guidelines(
    messages: Vec<ChatMessage>,
    state: tauri::State<'_, AppState>,
) -> Result<InterviewResponse, String> {
    let provider = {
        let settings = state.settings.lock().await;
        active_provider_or_err(&settings)?
    }; // mutex released before HTTP

    ai::interview_turn(&provider, messages)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = build_app_state();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            add_files, add_folder, add_paths, remove_file, clear_queue, approve_file, unapprove_file,
            skip_file, reset_file, scan_and_analyze, generate_commands, apply_command_template,
            fetch_models, verify_ffmpeg_paths, start_processing, reprocess_file, stop_processing, delete_output_file, output_file_exists,
            save_queue, load_queue, load_settings, save_settings, load_guidelines, save_guidelines, get_default_guidelines, interview_guidelines,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn receiver_spawned_before_producers_prevents_deadlock() {
        let buffer_size = 5;
        let event_count = 50;
        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(buffer_size);
        let receiver_handle = tokio::spawn(async move {
            let mut received = 0;
            while let Some(_) = rx.recv().await { received += 1; }
            received
        });
        let tx_clone = tx.clone();
        let producer_handle = tokio::spawn(async move {
            for i in 0..event_count { let _ = tx_clone.send(format!("event-{}", i)).await; }
        });
        let producer_result = tokio::time::timeout(std::time::Duration::from_secs(5), producer_handle).await.expect("Producer should not deadlock");
        assert!(producer_result.is_ok(), "Producer task should complete");
        drop(tx);
        let receiver_result = tokio::time::timeout(std::time::Duration::from_secs(5), receiver_handle).await.expect("Receiver should not deadlock");
        let received = receiver_result.expect("Receiver task should complete");
        assert_eq!(received, event_count, "All events should be received");
    }
}
