use crate::models::VideoFile;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub enum ExecutorEvent {
    Started { file_id: String },
    Stdout { file_id: String, line: String },
    Stderr { file_id: String, line: String },
    Completed {
        file_id: String,
        success: bool,
        message: String,
        output_size: u64,
        processing_duration: f64,
        completed_at: String,
    },
}

/// Tracks running FFmpeg child processes so they can be cancelled.
pub struct ProcessTracker {
    children: RwLock<Vec<tokio::process::Child>>,
    accepting: AtomicBool,
}

impl ProcessTracker {
    pub fn new() -> Self {
        Self {
            children: RwLock::new(Vec::new()),
            accepting: AtomicBool::new(true),
        }
    }

    pub fn arm(&self) {
        self.accepting.store(true, Ordering::SeqCst);
    }

    pub async fn add(&self, mut child: tokio::process::Child) -> Result<(), std::io::Error> {
        let mut children = self.children.write().await;
        if !self.accepting.load(Ordering::SeqCst) {
            terminate_child(&mut child).await;
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "Process tracker is not accepting children",
            ));
        }
        children.push(child);
        Ok(())
    }

    /// Wait for a specific child and remove it from the tracker.
    /// Polls with try_wait() so the write lock is never held across an await point,
    /// preventing deadlock with kill_all() (which holds the write lock through kill+wait).
    /// NotFound means the child is already gone from the tracker — after kill_all,
    /// that is only after kill+wait, never while the process still holds the output.
    pub async fn wait_and_remove(&self, id: Option<u32>) -> Result<std::process::ExitStatus, std::io::Error> {
        loop {
            let mut children = self.children.write().await;
            let pos = match children.iter().position(|c| c.id() == id) {
                Some(pos) => pos,
                None => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "Child process was cancelled or not found in tracker",
                    ));
                }
            };
            let child = &mut children[pos];
            match child.try_wait() {
                Ok(Some(status)) => {
                    children.remove(pos);
                    return Ok(status);
                }
                Ok(None) => {
                    drop(children);
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                Err(e) => return Err(e),
            }
        }
    }

    pub async fn kill_all(&self) {
        // Disarm before the write lock so a concurrent add cannot push after
        // we clear. add() re-checks accepting only after it holds this lock.
        self.accepting.store(false, Ordering::SeqCst);
        // Keep each Child in the tracker until kill+wait finishes. Replacing the
        // vec first let wait_and_remove return NotFound while ffmpeg still held
        // the output file; execute then deleted (Windows sharing violation).
        // Holding the write lock across kill() also blocks wait_and_remove, so
        // execute cannot emit "Processing was stopped" until the process is gone.
        let mut children = self.children.write().await;
        for child in children.iter_mut() {
            terminate_child(child).await;
        }
        children.clear();
    }
}

/// Kill the child and any descendants. `Child::kill` is TerminateProcess on
/// Windows and does not walk the tree — a wrapper/stub dying leaves ffmpeg
/// encoding in the background while the UI thinks Stop finished.
async fn terminate_child(child: &mut tokio::process::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.id() {
        let mut cmd = crate::process_cmd::media_command("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = cmd.status().await;
    }
    // Always wait after kill so we never drop a live Child.
    let _ = child.kill().await;
}

pub struct FFmpegExecutor {
    tracker: Arc<ProcessTracker>,
}

impl FFmpegExecutor {
    pub fn new(tracker: Arc<ProcessTracker>) -> Self {
        Self { tracker }
    }

    pub async fn execute(
        &self,
        file: &VideoFile,
        ffmpeg_path: &str,
        tx: mpsc::Sender<ExecutorEvent>,
    ) -> Result<(), String> {
        if file.command_args.trim().is_empty() {
            let completed_at = chrono::Utc::now().to_rfc3339();
            let _ = tx
                .send(ExecutorEvent::Completed {
                    file_id: file.id.clone(),
                    success: false,
                    message: "No command to execute".to_string(),
                    output_size: 0,
                    processing_duration: 0.0,
                    completed_at,
                })
                .await;
            return Err("No command to execute".to_string());
        }
        let args = crate::command_builder::assemble_argv(
            &file.command_args,
            &file.input_path,
            &file.output_path,
        );

        let mut cmd = crate::process_cmd::media_command(ffmpeg_path);
        for arg in &args {
            cmd.arg(arg);
        }

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let start_time = std::time::Instant::now();
        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                let completed_at = chrono::Utc::now().to_rfc3339();
                let message = format!("Failed to spawn ffmpeg: {}", e);
                let _ = tx
                    .send(ExecutorEvent::Completed {
                        file_id: file.id.clone(),
                        success: false,
                        message: message.clone(),
                        output_size: 0,
                        processing_duration: 0.0,
                        completed_at,
                    })
                    .await;
                return Err(message);
            }
        };
        let child_id = child.id();
        // Take pipes before any await so they cannot be dropped with the Child
        // if add() rejects (add kills the child on reject).
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        match self.tracker.add(child).await {
            Err(_) => {
                let duration = start_time.elapsed().as_secs_f64();
                let completed_at = chrono::Utc::now().to_rfc3339();
                let _ = tx
                    .send(ExecutorEvent::Completed {
                        file_id: file.id.clone(),
                        success: false,
                        message: "Processing was stopped".to_string(),
                        output_size: 0,
                        processing_duration: duration,
                        completed_at,
                    })
                    .await;
                return Err("Processing was stopped".to_string());
            }
            Ok(()) => {
                let _ = tx
                    .send(ExecutorEvent::Started {
                        file_id: file.id.clone(),
                    })
                    .await;
            }
        }

        let file_id = file.id.clone();
        let tx_clone = tx.clone();

        // Spawn stdout reader
        if let Some(stdout) = stdout {
            let tx = tx_clone.clone();
            let fid = file_id.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stdout);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx
                        .send(ExecutorEvent::Stdout {
                            file_id: fid.clone(),
                            line,
                        })
                        .await;
                }
            });
        }

        // Spawn stderr reader (ffmpeg outputs progress to stderr)
        if let Some(stderr) = stderr {
            let tx = tx_clone.clone();
            let fid = file_id.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = tx
                        .send(ExecutorEvent::Stderr {
                            file_id: fid.clone(),
                            line,
                        })
                        .await;
                }
            });
        }

        // Wait for process to complete (child stays in tracker until done)
        let status = match self.tracker.wait_and_remove(child_id).await {
            Ok(status) => status,
            Err(_) => {
                // Child was killed or lost — report as cancelled
                let duration = start_time.elapsed().as_secs_f64();
                let completed_at = chrono::Utc::now().to_rfc3339();
                let _ = tx
                    .send(ExecutorEvent::Completed {
                        file_id: file_id.clone(),
                        success: false,
                        message: "Processing was stopped".to_string(),
                        output_size: 0,
                        processing_duration: duration,
                        completed_at,
                    })
                    .await;
                return Err("Processing was stopped".to_string());
            }
        };

        let success = status.success();
        let message = if success {
            "Transcoding completed successfully".to_string()
        } else {
            format!("Transcoding failed with exit code: {:?}", status.code())
        };

        // Get output file size on success
        let output_size = if success {
            let path = PathBuf::from(&file.output_path);
            if path.exists() {
                fs::metadata(&path).await.map(|m| m.len()).unwrap_or(0)
            } else {
                0
            }
        } else {
            0
        };

        let duration = start_time.elapsed().as_secs_f64();
        let completed_at = chrono::Utc::now().to_rfc3339();

        let _ = tx
            .send(ExecutorEvent::Completed {
                file_id: file_id.clone(),
                success,
                message: message.clone(),
                output_size,
                processing_duration: duration,
                completed_at,
            })
            .await;

        if success {
            Ok(())
        } else {
            Err(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FileStatus, VideoFile};

    // ── Regression test for Stop button bug ──
    // Ensures that cancelling the pipeline token prevents queued tasks from
    // acquiring a released semaphore permit and starting new work.

    #[tokio::test]
    async fn pipeline_queued_tasks_must_not_start_after_stop() {
        // Simulates the fixed spawn_processing_pipeline with max_parallel=1 and 2 files.
        // After cancel_token.cancel() + kill_all(), the second task must NOT start.
        let semaphore = Arc::new(tokio::sync::Semaphore::new(1));
        let cancel_token = tokio_util::sync::CancellationToken::new();
        let (started_tx, mut started_rx) = tokio::sync::mpsc::channel::<String>(10);

        // Task 1: holds the sole permit for 10s
        let permit1 = semaphore.clone().acquire_owned().await.unwrap();
        let started_tx1 = started_tx.clone();
        let task1 = tokio::spawn(async move {
            let _permit = permit1;
            let _ = started_tx1.send("file1".to_string()).await;
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        });

        // Wait for file1 to actually start
        let first = tokio::time::timeout(std::time::Duration::from_secs(2), started_rx.recv()).await;
        assert!(first.is_ok() && first.unwrap().is_some(), "file1 should have started");

        // Simulate the pipeline main loop spawning task 2.
        // In the real code, the loop does:
        //   if cancel_token.is_cancelled() { break; }
        //   let permit = semaphore.acquire_owned().await.unwrap();
        //   tokio::spawn(async move {
        //       if cancel_token.is_cancelled() { drop(permit); return; }
        //       ...
        //   });
        let semaphore2 = semaphore.clone();
        let cancel_token2 = cancel_token.clone();
        let started_tx2 = started_tx.clone();
        let task2 = tokio::spawn(async move {
            // Main-loop guard (before acquiring permit)
            if cancel_token2.is_cancelled() {
                return;
            }
            let permit = semaphore2.acquire_owned().await.unwrap();
            // Inner guard (after acquiring permit, inside spawned task)
            if cancel_token2.is_cancelled() {
                drop(permit);
                return;
            }
            let _permit = permit;
            let _ = started_tx2.send("file2".to_string()).await;
        });

        // Give task 2 time to block on the semaphore
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // User clicks Stop
        cancel_token.cancel();

        // Simulate kill_all killing task 1's child (abort the sleeping task)
        task1.abort();
        let _ = task1.await;

        // Wait for task 2 to process the released permit
        let task2_result = tokio::time::timeout(std::time::Duration::from_secs(2), task2).await;
        assert!(task2_result.is_ok(), "task2 should complete within 2s");

        // CRITICAL: file2 must NEVER start.
        let maybe_file2 = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            started_rx.recv(),
        )
        .await;

        assert!(
            maybe_file2.is_err() || maybe_file2.unwrap().is_none(),
            "BUG: file2 started after kill_all — queued tasks are not being cancelled"
        );
    }

    // ── Regression test for ProcessTracker deadlock ──
    // Ensures kill_all() is not blocked when wait_and_remove() is awaiting a child.

    #[tokio::test]
    async fn kill_all_can_interrupt_child_being_waited_on() {
        let tracker = Arc::new(ProcessTracker::new());

        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("python");
            c.args(["-c", "import time; time.sleep(600)"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("600");
            c
        };
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
        let child = cmd.spawn().expect("spawn long-running child");
        let child_id = child.id();
        tracker.add(child).await.expect("add child");

        let tracker_wait = tracker.clone();
        let wait_handle = tokio::spawn(async move { tracker_wait.wait_and_remove(child_id).await });

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let kill_result =
            tokio::time::timeout(std::time::Duration::from_secs(1), tracker.kill_all()).await;
        assert!(
            kill_result.is_ok(),
            "kill_all should complete within 1s, not deadlock"
        );

        let wait_result = tokio::time::timeout(std::time::Duration::from_secs(2), wait_handle).await;
        assert!(
            wait_result.is_ok(),
            "wait_and_remove should complete after kill_all"
        );
        let wait_result = wait_result.unwrap().expect("wait task should not panic");
        assert!(
            wait_result.is_err(),
            "child should be gone from tracker after kill_all"
        );
    }

    fn process_exists(pid: u32) -> bool {
        if cfg!(windows) {
            let output = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
                .output()
                .expect("tasklist");
            String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
        } else {
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    }

    fn force_kill_tree(pid: u32) {
        if cfg!(windows) {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        } else {
            let _ = std::process::Command::new("pkill")
                .args(["-KILL", "-P", &pid.to_string()])
                .output();
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .output();
        }
    }

    /// Parent python that spawns a child sleeper and writes the child's pid to `pid_path`.
    fn spawn_python_tree(pid_path: &std::path::Path) -> Command {
        let script = format!(
            "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(600)']); open(r'{}','w').write(str(p.pid)); p.wait()",
            pid_path.display().to_string().replace('\\', "\\\\")
        );
        let mut cmd = Command::new("python");
        cmd.args(["-c", &script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
        cmd
    }

    #[tokio::test]
    async fn kill_all_terminates_the_os_process_and_its_children() {
        let pid_path = std::env::temp_dir().join(format!(
            "mb_kill_tree_{}_{}.pid",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&pid_path);

        let tracker = Arc::new(ProcessTracker::new());
        let child = spawn_python_tree(&pid_path)
            .spawn()
            .expect("spawn python tree");
        let parent_pid = child.id().expect("parent pid");
        tracker.add(child).await.expect("add child");

        let grandchild_pid = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if let Ok(s) = std::fs::read_to_string(&pid_path) {
                    if let Ok(pid) = s.trim().parse::<u32>() {
                        return pid;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("grandchild pid file");

        assert!(process_exists(parent_pid), "parent should be running before kill");
        assert!(
            process_exists(grandchild_pid),
            "grandchild should be running before kill"
        );

        tracker.kill_all().await;
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        let parent_alive = process_exists(parent_pid);
        let grandchild_alive = process_exists(grandchild_pid);
        // Do not leak 600s sleepers if kill_all is still broken.
        if parent_alive || grandchild_alive {
            force_kill_tree(parent_pid);
            force_kill_tree(grandchild_pid);
        }
        let _ = std::fs::remove_file(&pid_path);
        assert!(
            !parent_alive,
            "kill_all must terminate the tracked process, not only drop it from the tracker"
        );
        assert!(
            !grandchild_alive,
            "kill_all must terminate descendant processes (ffmpeg trees), not only the wrapper"
        );
    }

    #[tokio::test]
    async fn execute_emits_started_before_completed_on_success() {
        let tracker = Arc::new(ProcessTracker::new());
        let executor = FFmpegExecutor::new(tracker);
        let (tx, mut rx) = mpsc::channel::<ExecutorEvent>(10);

        let file = VideoFile {
            id: "test-id".to_string(),
            input_path: "/tmp/input.mkv".to_string(),
            output_path: "/tmp/output.mkv".to_string(),
            scan_root: "/tmp".to_string(),
            ffprobe_raw: "".to_string(),
            metadata: None,
            generated_command: "".to_string(),
            command_args: "-c:v copy".to_string(),
            description: "".to_string(),
            reasoning: "".to_string(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: "".to_string(),
            created_at: "".to_string(),
            updated_at: "".to_string(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: "".to_string(),
        };

        // PATH `true` (Git usr/bin on Windows) — CreateProcess cannot use /usr/bin/true
        let result = executor.execute(&file, "true", tx).await;
        assert!(result.is_ok());

        let first_event = rx.recv().await.expect("Should receive a Started event");
        match first_event {
            ExecutorEvent::Started { file_id } => {
                assert_eq!(file_id, "test-id");
            }
            other => panic!("Expected Started event, got {:?}", other),
        }

        let second_event = rx.recv().await.expect("Should receive a Completed event");
        match second_event {
            ExecutorEvent::Completed {
                file_id,
                success,
                ..
            } => {
                assert_eq!(file_id, "test-id");
                assert!(success);
            }
            other => panic!("Expected Completed event, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_after_kill_all_reports_stopped_without_started() {
        let tracker = Arc::new(ProcessTracker::new());
        tracker.kill_all().await;
        let executor = FFmpegExecutor::new(tracker);
        let (tx, mut rx) = mpsc::channel::<ExecutorEvent>(10);

        let file = VideoFile {
            id: "test-id".to_string(),
            input_path: "/tmp/input.mkv".to_string(),
            output_path: "/tmp/output.mkv".to_string(),
            scan_root: "/tmp".to_string(),
            ffprobe_raw: "".to_string(),
            metadata: None,
            generated_command: "".to_string(),
            command_args: "-c:v copy".to_string(),
            description: "".to_string(),
            reasoning: "".to_string(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: "".to_string(),
            created_at: "".to_string(),
            updated_at: "".to_string(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: "".to_string(),
        };

        let result = executor.execute(&file, "true", tx).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Processing was stopped");

        let first_event = rx.recv().await.expect("Should receive a Completed event");
        match first_event {
            ExecutorEvent::Completed {
                file_id,
                success,
                message,
                ..
            } => {
                assert_eq!(file_id, "test-id");
                assert!(!success);
                assert_eq!(message, "Processing was stopped");
            }
            other => panic!("Expected Completed event, got {:?}", other),
        }

        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn execute_emits_completed_on_empty_command() {
        let tracker = Arc::new(ProcessTracker::new());
        let executor = FFmpegExecutor::new(tracker);
        let (tx, mut rx) = mpsc::channel::<ExecutorEvent>(10);

        let file = VideoFile {
            id: "test-id".to_string(),
            input_path: "/tmp/input.mkv".to_string(),
            output_path: "/tmp/output.mkv".to_string(),
            scan_root: "/tmp".to_string(),
            ffprobe_raw: "".to_string(),
            metadata: None,
            generated_command: "".to_string(),
            command_args: "".to_string(),
            description: "".to_string(),
            reasoning: "".to_string(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: "".to_string(),
            created_at: "".to_string(),
            updated_at: "".to_string(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: "".to_string(),
        };

        let result = executor.execute(&file, "/usr/bin/ffmpeg", tx).await;
        assert!(result.is_err());

        let event = rx.recv().await.expect("Should receive a Completed event");
        match event {
            ExecutorEvent::Completed {
                file_id,
                success,
                message,
                output_size,
                ..
            } => {
                assert_eq!(file_id, "test-id");
                assert!(!success);
                assert_eq!(message, "No command to execute");
                assert_eq!(output_size, 0);
            }
            other => panic!("Expected Completed event, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_rejects_empty_command_args() {
        let tracker = Arc::new(ProcessTracker::new());
        let executor = FFmpegExecutor::new(tracker);
        let (tx, mut rx) = mpsc::channel::<ExecutorEvent>(10);
        let file = VideoFile {
            id: "test-id".to_string(),
            input_path: "/tmp/input.mkv".to_string(),
            output_path: "/tmp/output.mkv".to_string(),
            scan_root: "/tmp".to_string(),
            ffprobe_raw: "".to_string(),
            metadata: None,
            generated_command: "-c:v copy".to_string(),
            command_args: "".to_string(),
            description: "".to_string(),
            reasoning: "".to_string(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: "".to_string(),
            created_at: "".to_string(),
            updated_at: "".to_string(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: "".to_string(),
        };
        let result = executor.execute(&file, "/usr/bin/true", tx).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "No command to execute");
        let ev = rx.recv().await.unwrap();
        match ev {
            ExecutorEvent::Completed { success, .. } => assert!(!success),
            other => panic!("{:?}", other),
        }
    }

    #[test]
    fn assemble_argv_is_what_execute_would_pass() {
        // documents the contract execute uses
        let argv = crate::command_builder::assemble_argv(
            "-c:v copy",
            "/tmp/input.mkv",
            "/tmp/output.mkv",
        );
        assert_eq!(argv[0], "-i");
        assert_eq!(argv[1], "/tmp/input.mkv");
    }

    #[tokio::test]
    async fn execute_emits_completed_on_spawn_failure() {
        let tracker = Arc::new(ProcessTracker::new());
        let executor = FFmpegExecutor::new(tracker);
        let (tx, mut rx) = mpsc::channel::<ExecutorEvent>(10);

        let file = VideoFile {
            id: "test-id".to_string(),
            input_path: "/tmp/input.mkv".to_string(),
            output_path: "/tmp/output.mkv".to_string(),
            scan_root: "/tmp".to_string(),
            ffprobe_raw: "".to_string(),
            metadata: None,
            generated_command: "".to_string(),
            command_args: "-c:v copy".to_string(),
            description: "".to_string(),
            reasoning: "".to_string(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: "".to_string(),
            created_at: "".to_string(),
            updated_at: "".to_string(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: "".to_string(),
        };

        let result = executor.execute(&file, "/nonexistent/ffmpeg_binary", tx).await;
        assert!(result.is_err());

        let event = rx.recv().await.expect("Should receive a Completed event");
        match event {
            ExecutorEvent::Completed {
                file_id,
                success,
                message,
                output_size,
                ..
            } => {
                assert_eq!(file_id, "test-id");
                assert!(!success);
                assert!(message.contains("Failed to spawn ffmpeg"));
                assert_eq!(output_size, 0);
            }
            other => panic!("Expected Completed event, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn execute_emits_completed_on_success() {
        let tracker = Arc::new(ProcessTracker::new());
        let executor = FFmpegExecutor::new(tracker);
        let (tx, mut rx) = mpsc::channel::<ExecutorEvent>(10);

        let file = VideoFile {
            id: "test-id".to_string(),
            input_path: "/tmp/input.mkv".to_string(),
            output_path: "/tmp/output.mkv".to_string(),
            scan_root: "/tmp".to_string(),
            ffprobe_raw: "".to_string(),
            metadata: None,
            generated_command: "".to_string(),
            command_args: "-c:v copy".to_string(),
            description: "".to_string(),
            reasoning: "".to_string(),
            status: FileStatus::Pending,
            is_approved: false,
            error_message: "".to_string(),
            created_at: "".to_string(),
            updated_at: "".to_string(),
            input_size: 0,
            output_size: 0,
            processing_duration: 0.0,
            completed_at: "".to_string(),
        };

        // PATH `true` (Git usr/bin on Windows) — CreateProcess cannot use /usr/bin/true
        let result = executor.execute(&file, "true", tx).await;
        assert!(result.is_ok());

        let first_event = rx.recv().await.expect("Should receive a Started event");
        match first_event {
            ExecutorEvent::Started { file_id } => {
                assert_eq!(file_id, "test-id");
            }
            other => panic!("Expected Started event, got {:?}", other),
        }

        let second_event = rx.recv().await.expect("Should receive a Completed event");
        match second_event {
            ExecutorEvent::Completed {
                file_id,
                success,
                message,
                output_size,
                processing_duration,
                completed_at,
                ..
            } => {
                assert_eq!(file_id, "test-id");
                assert!(success);
                assert!(message.contains("successfully"));
                assert_eq!(output_size, 0);
                assert!(processing_duration >= 0.0);
                assert!(!completed_at.is_empty());
            }
            other => panic!("Expected Completed event, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn add_after_kill_all_kills_the_child() {
        let tracker = Arc::new(ProcessTracker::new());
        tracker.kill_all().await;

        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("python");
            c.args(["-c", "import time; time.sleep(600)"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("600");
            c
        };
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
        let child = cmd.spawn().expect("spawn long-running child");
        let added = tracker.add(child).await;
        // On RED, add succeeded so child is in tracker — clean up:
        if added.is_ok() {
            tracker.kill_all().await;
        }
        assert!(
            added.is_err(),
            "add after kill_all must reject and kill the child"
        );
    }

    #[tokio::test]
    async fn arm_allows_add_after_kill_all() {
        let tracker = Arc::new(ProcessTracker::new());
        tracker.kill_all().await;
        tracker.arm();
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("python");
            c.args(["-c", "import time; time.sleep(600)"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("600");
            c
        };
        cmd.stdout(Stdio::null())
            .stderr(Stdio::null())
            .stdin(Stdio::null());
        let child = cmd.spawn().expect("spawn long-running child");
        tracker
            .add(child)
            .await
            .expect("add must succeed after arm");
        tracker.kill_all().await;
    }
}
