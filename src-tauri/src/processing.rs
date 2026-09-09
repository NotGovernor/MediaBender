use crate::executor::{ExecutorEvent, FFmpegExecutor, ProcessTracker};
use crate::job_fifo::JobFifoState;
use crate::models::{FileStatus, VideoFile, WorkQueue};
use crate::persistence::{JsonFileStore, Persistence};
#[cfg(test)]
use std::future::Future;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio::sync::Mutex;

pub fn should_delete_output(success: bool, _cancelled: bool) -> bool {
    !success
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

pub async fn emit_pipeline_event(app: &tauri::AppHandle, state: &JobFifoState) {
    let scheduled_ids = {
        let fifo = state.fifo.lock().await;
        fifo.scheduled_ids()
    };
    let payload = serde_json::json!({ "scheduledIds": scheduled_ids });
    let _ = app.emit("pipeline-event", payload);
}

fn spawn_executor_event_receiver(
    mut rx: mpsc::Receiver<ExecutorEvent>,
    app: tauri::AppHandle,
    queue: Arc<Mutex<WorkQueue>>,
    store: JsonFileStore,
) {
    // Spawn the event receiver FIRST so it consumes events in real time
    // and prevents the mpsc channel from filling up and deadlocking producers.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            // Persist Started/Completed before emit to shrink crash desync.
            match &event {
                ExecutorEvent::Started { file_id } => {
                    persist_started(&queue, &store, file_id).await;
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
                        &queue,
                        &store,
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
                ExecutorEvent::Completed {
                    file_id,
                    success,
                    message,
                    output_size,
                    processing_duration,
                    completed_at,
                } => {
                    serde_json::json!({"type": "completed", "fileId": file_id, "success": success, "message": message, "outputSize": output_size, "processingDuration": processing_duration, "completedAt": completed_at })
                }
            };
            let _ = app.emit("executor-event", payload);
        }
    });
}

async fn run_execute_job(
    file: VideoFile,
    ffmpeg_path: String,
    tracker: Arc<ProcessTracker>,
    tx: mpsc::Sender<ExecutorEvent>,
) {
    let executor = FFmpegExecutor::new(tracker);
    let result = executor.execute(&file, &ffmpeg_path, tx).await;
    let success = result.is_ok();
    let cancelled = matches!(&result, Err(e) if e == "Processing was stopped");
    if should_delete_output(success, cancelled) {
        let _ = crate::fs_ops::delete_output_file(file.output_path.clone()).await;
    }
}

async fn fifo_worker(
    state: Arc<JobFifoState>,
    token: tokio_util::sync::CancellationToken,
    app: tauri::AppHandle,
    queue: Arc<Mutex<WorkQueue>>,
    tracker: Arc<ProcessTracker>,
    ffmpeg_path: String,
    tx: mpsc::Sender<ExecutorEvent>,
) {
    loop {
        if token.is_cancelled() {
            break;
        }
        let notified = state.notify.notified();
        tokio::pin!(notified);
        let id = {
            let mut fifo = state.fifo.lock().await;
            fifo.pop_front()
        };
        if let Some(file_id) = id {
            drop(notified);
            emit_pipeline_event(&app, &state).await;
            let file = {
                let q = queue.lock().await;
                q.files.iter().find(|f| f.id == file_id).cloned()
            };
            if let Some(file) = file.filter(crate::queue_ops::is_pickup_eligible) {
                run_execute_job(file, ffmpeg_path.clone(), tracker.clone(), tx.clone()).await;
            }
            {
                let mut fifo = state.fifo.lock().await;
                fifo.finish(&file_id);
            }
            emit_pipeline_event(&app, &state).await;
            state.notify.notify_waiters();
            continue;
        }
        tokio::select! {
            _ = token.cancelled() => break,
            _ = notified => {}
        }
    }
}

/// Test-only worker loop: same pop/finish/Notify as `fifo_worker`, with a fake job.
#[cfg(test)]
async fn fifo_worker_with_job<F, Fut>(
    state: Arc<JobFifoState>,
    token: tokio_util::sync::CancellationToken,
    job: F,
) where
    F: Fn(String) -> Fut,
    Fut: Future<Output = ()>,
{
    loop {
        if token.is_cancelled() {
            break;
        }
        let notified = state.notify.notified();
        tokio::pin!(notified);
        let id = {
            let mut fifo = state.fifo.lock().await;
            fifo.pop_front()
        };
        if let Some(file_id) = id {
            drop(notified);
            job(file_id.clone()).await;
            {
                let mut fifo = state.fifo.lock().await;
                fifo.finish(&file_id);
            }
            state.notify.notify_waiters();
            continue;
        }
        tokio::select! {
            _ = token.cancelled() => break,
            _ = notified => {}
        }
    }
}

/// Cancel the live FIFO session: waiting workers exit; pending is cleared so a later
/// session cannot start leftover ids. Does not `finish()` running ids.
pub async fn stop_fifo(
    job_fifo: &JobFifoState,
    token: Option<&tokio_util::sync::CancellationToken>,
) {
    if let Some(token) = token {
        token.cancel();
    }
    {
        let mut fifo = job_fifo.fifo.lock().await;
        fifo.clear_pending();
    }
    // Wait out an in-flight claim/spawn (ensure_workers holds executor_tx across CAS).
    let _tx = job_fifo.executor_tx.lock().await;
    job_fifo.workers_live.store(0, Ordering::SeqCst);
    job_fifo.notify.notify_waiters();
}

fn claim_worker_deficit(live: &std::sync::atomic::AtomicUsize, desired: usize) -> usize {
    loop {
        let current = live.load(Ordering::SeqCst);
        if current >= desired {
            return 0;
        }
        if live
            .compare_exchange(current, desired, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            return desired - current;
        }
    }
}

fn claim_worker_deficit_if_live(
    live: &std::sync::atomic::AtomicUsize,
    desired: usize,
    token: &tokio_util::sync::CancellationToken,
) -> usize {
    let to_spawn = claim_worker_deficit(live, desired);
    if token.is_cancelled() {
        // Session is stopping. Zero live while the caller still holds current_token
        // so a new session cannot have claimed yet.
        live.store(0, Ordering::SeqCst);
        return 0;
    }
    to_spawn
}

pub async fn ensure_workers(
    ffmpeg_path: String,
    max_parallel: usize,
    tracker: Arc<ProcessTracker>,
    current_token: Arc<Mutex<Option<tokio_util::sync::CancellationToken>>>,
    job_fifo: Arc<JobFifoState>,
    app: tauri::AppHandle,
    queue: Arc<Mutex<WorkQueue>>,
    store: JsonFileStore,
) {
    let mut token_slot = current_token.lock().await;
    let need_new = token_slot.as_ref().map(|t| t.is_cancelled()).unwrap_or(true);
    if need_new {
        tracker.arm();
        let t = tokio_util::sync::CancellationToken::new();
        *token_slot = Some(t);
        job_fifo.workers_live.store(0, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel::<ExecutorEvent>(100);
        spawn_executor_event_receiver(rx, app.clone(), queue.clone(), store);
        *job_fifo.executor_tx.lock().await = Some(tx);
    }
    let token = token_slot.as_ref().unwrap().clone();

    let desired = max_parallel.max(1);
    let tx_slot = job_fifo.executor_tx.lock().await;
    let tx = tx_slot.clone().expect("executor_tx must be set for a live session");
    let to_spawn = claim_worker_deficit_if_live(&job_fifo.workers_live, desired, &token);
    for _ in 0..to_spawn {
        let state = job_fifo.clone();
        let token = token.clone();
        let app = app.clone();
        let queue = queue.clone();
        let tracker = tracker.clone();
        let ffmpeg_path = ffmpeg_path.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            fifo_worker(state, token, app, queue, tracker, ffmpeg_path, tx).await;
        });
    }
    job_fifo.notify.notify_waiters();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct FifoFakeHarness {
        state: Arc<crate::job_fifo::JobFifoState>,
        current_token: Arc<Mutex<Option<Arc<tokio_util::sync::CancellationToken>>>>,
        started: Arc<Mutex<Vec<String>>>,
    }

    impl FifoFakeHarness {
        fn new() -> Self {
            Self {
                state: Arc::new(crate::job_fifo::JobFifoState::new()),
                current_token: Arc::new(Mutex::new(None)),
                started: Arc::new(Mutex::new(Vec::new())),
            }
        }

        async fn session_token(&self) -> Arc<tokio_util::sync::CancellationToken> {
            self.current_token
                .lock()
                .await
                .as_ref()
                .expect("session token")
                .clone()
        }

        async fn started_ids(&self) -> Vec<String> {
            self.started.lock().await.clone()
        }

        async fn wait_idle(&self) {
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
            loop {
                {
                    let fifo = self.state.fifo.lock().await;
                    if !fifo.is_active() {
                        return;
                    }
                }
                if tokio::time::Instant::now() > deadline {
                    panic!("fifo did not drain");
                }
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        }

        async fn wait_started_contains(&self, id: &str) {
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
            loop {
                if self.started.lock().await.iter().any(|x| x == id) {
                    return;
                }
                if tokio::time::Instant::now() > deadline {
                    panic!("job {id} did not start");
                }
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
            }
        }
    }

    struct HoldGate {
        open: std::sync::atomic::AtomicBool,
        notify: tokio::sync::Notify,
    }

    impl HoldGate {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                open: std::sync::atomic::AtomicBool::new(false),
                notify: tokio::sync::Notify::new(),
            })
        }

        async fn wait(&self) {
            while !self.open.load(Ordering::SeqCst) {
                self.notify.notified().await;
            }
        }

        fn release(&self) {
            self.open.store(true, Ordering::SeqCst);
            self.notify.notify_waiters();
        }
    }

    /// Test-only: max_parallel fake workers, no ffmpeg. Records job start order.
    async fn run_fifo_with_fake_job(harness: &FifoFakeHarness, max_parallel: usize) {
        spawn_fifo_fake_workers(harness, max_parallel, None).await;
    }

    async fn spawn_fifo_fake_workers(
        harness: &FifoFakeHarness,
        max_parallel: usize,
        hold: Option<Arc<HoldGate>>,
    ) {
        let mut slot = harness.current_token.lock().await;
        let need_new = slot.as_ref().map(|t| t.is_cancelled()).unwrap_or(true);
        if need_new {
            *slot = Some(Arc::new(tokio_util::sync::CancellationToken::new()));
            harness
                .state
                .workers_live
                .store(0, Ordering::SeqCst);
        }
        let token = slot.as_ref().unwrap().clone();

        let desired = max_parallel.max(1);
        let to_spawn = claim_worker_deficit_if_live(&harness.state.workers_live, desired, token.as_ref());
        for _ in 0..to_spawn {
            let state = harness.state.clone();
            let token = (*token).clone();
            let started = harness.started.clone();
            let hold = hold.clone();
            tokio::spawn(async move {
                fifo_worker_with_job(state, token, move |file_id| {
                    let started = started.clone();
                    let hold = hold.clone();
                    async move {
                        started.lock().await.push(file_id);
                        if let Some(ref hold) = hold {
                            hold.wait().await;
                        } else {
                            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                        }
                    }
                })
                .await;
            });
        }
        harness.state.notify.notify_waiters();
    }

    #[tokio::test]
    async fn stop_clears_pending_keeps_caller_from_starting_cleared_ids() {
        let h = FifoFakeHarness::new();
        let hold = HoldGate::new();
        spawn_fifo_fake_workers(&h, 1, Some(hold.clone())).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["a".into(), "b".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_started_contains("a").await;

        stop_fifo(&h.state, Some(h.session_token().await.as_ref())).await;

        {
            let fifo = h.state.fifo.lock().await;
            assert_eq!(fifo.pending_len(), 0);
            let scheduled = fifo.scheduled_ids();
            assert!(scheduled.contains(&"a".to_string()));
            assert!(!scheduled.contains(&"b".to_string()));
        }
        assert_eq!(h.started_ids().await, vec!["a"]);

        hold.release();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(h.started_ids().await, vec!["a"]);

        spawn_fifo_fake_workers(&h, 1, None).await;
        h.wait_idle().await;
        assert_eq!(h.started_ids().await, vec!["a"]);
    }

    #[tokio::test]
    async fn fifo_workers_start_jobs_in_push_back_order() {
        let h = FifoFakeHarness::new();
        run_fifo_with_fake_job(&h, 1).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["a".into(), "b".into(), "c".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_idle().await;
        assert_eq!(h.started_ids().await, vec!["a", "b", "c"]);
    }

    #[tokio::test]
    async fn fifo_workers_run_two_jobs_concurrently_when_max_parallel_2() {
        let h = FifoFakeHarness::new();
        let hold = HoldGate::new();
        spawn_fifo_fake_workers(&h, 2, Some(hold.clone())).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["a".into(), "b".into(), "c".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_started_contains("a").await;
        h.wait_started_contains("b").await;
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        let started = h.started_ids().await;
        assert!(started.contains(&"a".to_string()));
        assert!(started.contains(&"b".to_string()));
        assert!(!started.contains(&"c".to_string()), "third job must wait for a slot");
        assert_eq!(started.len(), 2);

        hold.release();
        h.wait_idle().await;
        let done = h.started_ids().await;
        assert_eq!(done.len(), 3);
        assert!(done.contains(&"c".to_string()));
    }

    #[tokio::test]
    async fn add_while_slot_free_starts_immediately() {
        let h = FifoFakeHarness::new();
        let hold = HoldGate::new();
        spawn_fifo_fake_workers(&h, 3, Some(hold.clone())).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["a".into(), "b".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_started_contains("a").await;
        h.wait_started_contains("b").await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(h.started_ids().await.len(), 2);

        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["c".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_started_contains("c").await;
        assert_eq!(h.started_ids().await.len(), 3, "c must start on the idle worker without waiting for a or b");

        hold.release();
        h.wait_idle().await;
    }

    #[tokio::test]
    async fn second_enqueue_appends_without_new_session() {
        let h = FifoFakeHarness::new();
        run_fifo_with_fake_job(&h, 1).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["a".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_started_contains("a").await;
        let token_before = h.session_token().await;
        run_fifo_with_fake_job(&h, 1).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["b".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_idle().await;
        assert_eq!(h.started_ids().await, vec!["a", "b"]);
        let token_after = h.session_token().await;
        assert!(Arc::ptr_eq(&token_before, &token_after));
    }

    #[tokio::test]
    async fn push_front_runs_before_remaining_pending() {
        let h = FifoFakeHarness::new();
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["b".into(), "c".into()]);
            assert!(fifo.scheduled_ids().iter().all(|id| id != "a"));
            fifo.push_front("a".into());
        }
        run_fifo_with_fake_job(&h, 1).await;
        h.wait_idle().await;
        let order = h.started_ids().await;
        assert_eq!(order.first().map(String::as_str), Some("a"));
    }

    #[tokio::test]
    async fn ensure_workers_scales_up_without_stopping_in_flight() {
        let h = FifoFakeHarness::new();
        let hold = HoldGate::new();
        spawn_fifo_fake_workers(&h, 1, Some(hold.clone())).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["a".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_started_contains("a").await;

        spawn_fifo_fake_workers(&h, 3, Some(hold.clone())).await;
        {
            let mut fifo = h.state.fifo.lock().await;
            fifo.push_back(["b".into(), "c".into()]);
        }
        h.state.notify.notify_waiters();
        h.wait_started_contains("b").await;
        h.wait_started_contains("c").await;
        let started = h.started_ids().await;
        assert_eq!(started.len(), 3, "a must still be in-flight; b and c must have started on new workers");
        assert_eq!(h.state.workers_live.load(Ordering::SeqCst), 3);

        hold.release();
        h.wait_idle().await;
    }

    #[tokio::test]
    async fn ensure_workers_does_not_scale_down_live_count() {
        let h = FifoFakeHarness::new();
        spawn_fifo_fake_workers(&h, 3, None).await;
        assert_eq!(h.state.workers_live.load(Ordering::SeqCst), 3);
        spawn_fifo_fake_workers(&h, 1, None).await;
        assert_eq!(h.state.workers_live.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn cancelled_session_does_not_keep_worker_deficit_claim() {
        let live = std::sync::atomic::AtomicUsize::new(0);
        let token = tokio_util::sync::CancellationToken::new();
        token.cancel();
        let to_spawn = claim_worker_deficit_if_live(&live, 3, &token);
        assert_eq!(to_spawn, 0);
        assert_eq!(live.load(Ordering::SeqCst), 0);
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
