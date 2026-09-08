use crate::executor::ExecutorEvent;
use std::collections::{HashSet, VecDeque};

#[derive(Default)]
pub struct JobFifo {
    pending: VecDeque<String>,
    running: HashSet<String>,
}

impl JobFifo {
    pub fn new() -> Self { Self::default() }
    pub fn contains(&self, id: &str) -> bool {
        self.pending.iter().any(|x| x == id) || self.running.contains(id)
    }
    pub fn is_running(&self, id: &str) -> bool {
        self.running.contains(id)
    }
    pub fn push_back<I: IntoIterator<Item = String>>(&mut self, ids: I) {
        for id in ids {
            if !self.contains(&id) {
                self.pending.push_back(id);
            }
        }
    }
    pub fn push_front(&mut self, id: String) {
        if self.running.contains(&id) {
            return;
        }
        if self.pending.iter().any(|x| x == &id) {
            self.pending.retain(|x| x != &id);
            self.pending.push_front(id);
        } else {
            self.pending.push_front(id);
        }
    }
    pub fn pop_front(&mut self) -> Option<String> {
        let id = self.pending.pop_front()?;
        self.running.insert(id.clone());
        Some(id)
    }
    pub fn finish(&mut self, id: &str) {
        self.running.remove(id);
    }
    pub fn clear_pending(&mut self) {
        self.pending.clear();
    }
    pub fn scheduled_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.pending.iter().cloned().collect();
        ids.extend(self.running.iter().cloned());
        ids
    }
    pub fn is_active(&self) -> bool {
        !self.pending.is_empty() || !self.running.is_empty()
    }
    pub fn pending_len(&self) -> usize { self.pending.len() }
}

pub struct JobFifoState {
    pub fifo: tokio::sync::Mutex<JobFifo>,
    pub notify: tokio::sync::Notify,
    pub workers_spawned: std::sync::atomic::AtomicBool,
    pub executor_tx: tokio::sync::Mutex<Option<tokio::sync::mpsc::Sender<ExecutorEvent>>>,
}

impl JobFifoState {
    pub fn new() -> Self {
        Self {
            fifo: tokio::sync::Mutex::new(JobFifo::new()),
            notify: tokio::sync::Notify::new(),
            workers_spawned: std::sync::atomic::AtomicBool::new(false),
            executor_tx: tokio::sync::Mutex::new(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_back_skips_ids_already_pending_or_running() {
        let mut q = JobFifo::new();
        q.push_back(["a".into(), "b".into()]);
        q.running.insert("c".into());
        q.push_back(["b".into(), "c".into(), "d".into()]);
        assert_eq!(q.pending.iter().cloned().collect::<Vec<_>>(), vec!["a", "b", "d"]);
    }

    #[test]
    fn push_front_inserts_ahead_of_pending() {
        let mut q = JobFifo::new();
        q.push_back(["a".into(), "b".into()]);
        q.push_front("x".into());
        assert_eq!(q.pending.iter().cloned().collect::<Vec<_>>(), vec!["x", "a", "b"]);
    }

    #[test]
    fn push_front_moves_existing_pending_id_to_front() {
        let mut q = JobFifo::new();
        q.push_back(["a".into(), "b".into(), "c".into()]);
        q.push_front("b".into());
        assert_eq!(q.pending.iter().cloned().collect::<Vec<_>>(), vec!["b", "a", "c"]);
    }

    #[test]
    fn is_running_only_checks_running_set() {
        let mut q = JobFifo::new();
        q.push_back(["a".into()]);
        assert!(!q.is_running("a"));
        q.pop_front();
        assert!(q.is_running("a"));
        assert!(!q.is_running("missing"));
    }

    #[test]
    fn push_front_is_noop_if_already_running() {
        let mut q = JobFifo::new();
        q.running.insert("a".into());
        q.push_back(["b".into()]);
        q.push_front("a".into());
        assert!(q.pending.iter().all(|id| id != "a"));
        assert!(q.running.contains("a"));
    }

    #[test]
    fn pop_front_moves_id_to_running() {
        let mut q = JobFifo::new();
        q.push_back(["a".into(), "b".into()]);
        assert_eq!(q.pop_front().as_deref(), Some("a"));
        assert!(q.running.contains("a"));
        assert_eq!(q.pending.iter().cloned().collect::<Vec<_>>(), vec!["b"]);
    }

    #[test]
    fn finish_removes_from_running() {
        let mut q = JobFifo::new();
        q.push_back(["a".into()]);
        q.pop_front();
        q.finish("a");
        assert!(!q.running.contains("a"));
        assert!(!q.contains("a"));
    }

    #[test]
    fn clear_pending_keeps_running() {
        let mut q = JobFifo::new();
        q.push_back(["a".into(), "b".into()]);
        q.pop_front();
        q.clear_pending();
        assert!(q.pending.is_empty());
        assert!(q.running.contains("a"));
    }

    #[test]
    fn scheduled_ids_pending_then_running() {
        let mut q = JobFifo::new();
        q.push_back(["a".into(), "b".into()]);
        q.pop_front();
        let ids = q.scheduled_ids();
        assert_eq!(ids[0], "b");
        assert!(ids.contains(&"a".to_string()));
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn is_active_true_if_pending_or_running() {
        let mut q = JobFifo::new();
        assert!(!q.is_active());
        q.push_back(["a".into()]);
        assert!(q.is_active());
        q.pop_front();
        q.clear_pending();
        assert!(q.is_active());
        q.finish("a");
        assert!(!q.is_active());
    }
}
