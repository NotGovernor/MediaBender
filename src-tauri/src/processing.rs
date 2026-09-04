use crate::executor::{ExecutorEvent, FFmpegExecutor, ProcessTracker};
use crate::models::{FileStatus, VideoFile, WorkQueue};
use crate::persistence::{JsonFileStore, Persistence};
use std::future::Future;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;

pub fn should_delete_output(success: bool, _cancelled: bool) -> bool {
    !success
}

/// Schedule jobs without waiting on them. Acquire the semaphore **inside**
/// each spawned task so the scheduling loop never holds a permit.
pub fn spawn_jobs<F, Fut>(
    files: Vec<VideoFile>,
    semaphore: Arc<tokio::sync::Semaphore>,
    cancel_token: tokio_util::sync::CancellationToken,
    job: F,
) where
    F: Fn(VideoFile) -> Fut + Clone + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    for file in files {
        if cancel_token.is_cancelled() {
            break;
        }
        let semaphore = semaphore.clone();
        let cancel_token = cancel_token.clone();
        let job = job.clone();
        tokio::spawn(async move {
            let Ok(_permit) = semaphore.acquire_owned().await else {
                return;
            };
            if cancel_token.is_cancelled() {
                return;
            }
            job(file).await;
        });
    }
}

async fn persist_started(queue: &Arc<Mutex<WorkQueue>>, store: &JsonFileStore, file_id: &str) {
    let mut q = queue.lock().await;
    if let Some(item) = q.files.iter_mut().find(|f| f.id == file_id) {
        item.status = FileStatus::Processing;
        item.updated_at = chrono::Utc::now().to_rfc3339();
    }
    q.last_modified = chrono::Utc::now().to_rfc3339();
    let _ = store.save_queue(&q);
}

async fn persist_completed(
    queue: &Arc<Mutex<WorkQueue>>,
    store: &JsonFileStore,
    file_id: &str,
    success: bool,
    message: &str,
    output_size: u64,
    processing_duration: f64,
    completed_at: &str,
) {
    let mut q = queue.lock().await;
    if let Some(item) = q.files.iter_mut().find(|f| f.id == file_id) {
        item.status = if success {
            FileStatus::Completed
        } else {
            FileStatus::Error
        };
        item.error_message = if success {
            String::new()
        } else {
            message.to_string()
        };
        item.output_size = output_size as i64;
        item.processing_duration = processing_duration;
        item.completed_at = completed_at.to_string();
        item.updated_at = chrono::Utc::now().to_rfc3339();
    }
    q.last_modified = chrono::Utc::now().to_rfc3339();
    let _ = store.save_queue(&q);
}

pub async fn spawn_processing_pipeline(
    files: Vec<VideoFile>,
    ffmpeg_path: String,
    max_parallel: usize,
    tracker: Arc<ProcessTracker>,
    cancel_token: tokio_util::sync::CancellationToken,
    app: tauri::AppHandle,
    queue: Arc<Mutex<WorkQueue>>,
    store: JsonFileStore,
) -> Result<(), String> {
    // Caller already filtered; clone so the slice/vec is owned for spawn.
    let files_to_process = files.clone();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<ExecutorEvent>(100);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_parallel.max(1)));

    // Spawn the event receiver FIRST so it consumes events in real time
    // and prevents the mpsc channel from filling up and deadlocking producers.
    let recv_queue = queue.clone();
    let recv_store = store.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            // Persist Started/Completed before emit to shrink crash desync.
            match &event {
                ExecutorEvent::Started { file_id } => {
                    persist_started(&recv_queue, &recv_store, file_id).await;
                }
                ExecutorEvent::Completed {
                    file_id,
                    success,
                    message,
                    output_size,
                    processing_duration,
                    completed_at,
                } => {
                    persist_completed(
                        &recv_queue,
                        &recv_store,
                        file_id,
                        *success,
                        message,
                        *output_size,
                        *processing_duration,
                        completed_at,
                    )
                    .await;
                }
                _ => {}
            }
            let payload = match event {
                ExecutorEvent::Started { file_id } => {
                    serde_json::json!({"type": "started", "fileId": file_id })
                }
                ExecutorEvent::Stdout { file_id, line } => {
                    serde_json::json!({"type": "stdout", "fileId": file_id, "line": line })
                }
                ExecutorEvent::Stderr { file_id, line } => {
                    serde_json::json!({"type": "stderr", "fileId": file_id, "line": line })
                }
                ExecutorEvent::Completed { file_id, success, message, output_size, processing_duration, completed_at } => {
                    serde_json::json!({"type": "completed", "fileId": file_id, "success": success, "message": message, "outputSize": output_size, "processingDuration": processing_duration, "completedAt": completed_at })
                }
            };
            let _ = app.emit("executor-event", payload);
        }
    });

    spawn_jobs(files_to_process, semaphore, cancel_token, move |file| {
        let tx = tx.clone();
        let ffmpeg_path = ffmpeg_path.clone();
        let tracker = tracker.clone();
        async move {
            let executor = FFmpegExecutor::new(tracker);
            let result = executor.execute(&file, &ffmpeg_path, tx).await;
            let success = result.is_ok();
            let cancelled = matches!(&result, Err(e) if e == "Processing was stopped");
            if should_delete_output(success, cancelled) {
                let _ = crate::fs_ops::delete_output_file(file.output_path.clone()).await;
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::FileStatus;
    use std::sync::Arc;

    fn dummy_file(id: &str) -> VideoFile {
        VideoFile {
            id: id.to_string(),
            input_path: String::new(),
            output_path: String::new(),
            scan_root: String::new(),
            ffprobe_raw: String::new(),
            metadata: None,
            generated_command: String::new(),
            command_args: String::new(),
            description: String::new(),
            reasoning: String::new(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: String::new(),
        }
    }

    async fn spawn_jobs_for_test(n_files: usize, max_parallel: usize) {
        let files: Vec<VideoFile> = (0..n_files).map(|i| dummy_file(&i.to_string())).collect();
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_parallel.max(1)));
        let cancel_token = tokio_util::sync::CancellationToken::new();
        spawn_jobs(files, semaphore, cancel_token, |_file| async {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        });
    }

    #[tokio::test]
    async fn spawn_jobs_acquires_permits_inside_tasks_not_in_the_loop() {
        // Zero available permits: if acquire lived in the scheduling loop,
        // this would hang. Spawn, then acquire inside each task.
        let files = vec![dummy_file("a"), dummy_file("b")];
        let semaphore = Arc::new(tokio::sync::Semaphore::new(0));
        let cancel_token = tokio_util::sync::CancellationToken::new();
        let started = std::time::Instant::now();
        spawn_jobs(files, semaphore, cancel_token, |_file| async {
            panic!("job must not run without a permit");
        });
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
    }

    #[tokio::test]
    async fn spawn_jobs_returns_before_tasks_finish() {
        let started = std::time::Instant::now();
        // spawn 2 tasks that sleep 2s with max_parallel=1
        spawn_jobs_for_test(2, 1).await;
        assert!(started.elapsed() < std::time::Duration::from_millis(500));
    }

    #[test]
    fn should_delete_incomplete_output_on_failure() {
        assert!(should_delete_output(false, /* cancelled */ false));
        assert!(should_delete_output(false, true));
        assert!(!should_delete_output(true, false));
    }

    #[tokio::test]
    async fn delete_output_file_removes_existing() {
        let p = std::env::temp_dir().join(format!("mb_del_{}.mkv", std::process::id()));
        std::fs::write(&p, b"partial").unwrap();
        crate::fs_ops::delete_output_file(p.to_string_lossy().to_string()).await.unwrap();
        assert!(!p.exists());
    }
}
