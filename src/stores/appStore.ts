import { createSignal, createMemo } from "solid-js";
import type { VideoFile, WorkQueue, AppSettings, View, LogEntry } from "../types";
import { dedupeFiles } from "../lib/dedupeFiles";

// ── View ──
export const [currentView, setCurrentView] = createSignal<View>("dashboard");

// ── Work Queue ──
export const [workQueue, setWorkQueue] = createSignal<WorkQueue>({
  output_folder: "",
  guidelines: "",
  files: [],
  created_at: new Date().toISOString(),
  last_modified: new Date().toISOString(),
});

export const queueFiles = createMemo(() => workQueue().files);
export const hasFiles = createMemo(() => workQueue().files.length > 0);

export function addFiles(files: VideoFile[]) {
  const isWindows = navigator.platform.includes("Win");
  const { newFiles, skippedCount } = dedupeFiles(workQueue().files, files, isWindows);

  if (skippedCount > 0) {
    addLog({
      timestamp: new Date().toISOString(),
      level: "warn",
      message: `Skipped ${skippedCount} duplicate file(s) already in queue`,
    });
  }

  if (newFiles.length === 0) return;

  setWorkQueue((q) => ({
    ...q,
    files: [...q.files, ...newFiles],
    last_modified: new Date().toISOString(),
  }));
}

export function removeFile(fileId: string) {
  setWorkQueue((q) => ({
    ...q,
    files: q.files.filter((f) => f.id !== fileId),
    last_modified: new Date().toISOString(),
  }));
}

export function clearQueue() {
  setWorkQueue((q) => ({
    ...q,
    files: [],
    last_modified: new Date().toISOString(),
  }));
}

export function updateFile(fileId: string, updates: Partial<VideoFile>) {
  setWorkQueue((q) => ({
    ...q,
    files: q.files.map((f) => (f.id === fileId ? { ...f, ...updates } : f)),
    last_modified: new Date().toISOString(),
  }));
}

export function updateQueue(updates: Partial<WorkQueue>) {
  setWorkQueue((q) => ({
    ...q,
    ...updates,
    last_modified: new Date().toISOString(),
  }));
}

export function setFilesProcessing(fileIds: string[]) {
  const now = new Date().toISOString();
  setWorkQueue((q) => ({
    ...q,
    files: q.files.map((f) =>
      fileIds.includes(f.id) ? { ...f, status: "Processing" as const, updated_at: now } : f
    ),
    last_modified: now,
  }));
}

export function resetProcessingFiles() {
  const now = new Date().toISOString();
  setWorkQueue((q) => ({
    ...q,
    files: q.files.map((f) =>
      f.status === "Processing" ? { ...f, status: "Pending" as const, updated_at: now } : f
    ),
    last_modified: now,
  }));
}

// ── Selected File for Review/Detail ──
export const [selectedFileId, setSelectedFileId] = createSignal<string | null>(null);
export const selectedFile = createMemo(() =>
  workQueue().files.find((f) => f.id === selectedFileId()) ?? null
);

// ── Modal State ──
export const [reviewModalOpen, setReviewModalOpen] = createSignal(false);
export const [detailModalOpen, setDetailModalOpen] = createSignal(false);
export const [ffprobeRawModalOpen, setFfprobeRawModalOpen] = createSignal(false);
export const [preflightModalOpen, setPreflightModalOpen] = createSignal(false);
export const [confirmDialogOpen, setConfirmDialogOpen] = createSignal(false);
export const [confirmDialogConfig, setConfirmDialogConfig] = createSignal<{
  title: string;
  message: string;
  detail?: string;
  confirmText: string;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void;
} | null>(null);

export function openReview(fileId: string) {
  setSelectedFileId(fileId);
  setReviewModalOpen(true);
}

export function openDetail(fileId: string) {
  setSelectedFileId(fileId);
  setDetailModalOpen(true);
}

export function closeModals() {
  setReviewModalOpen(false);
  setDetailModalOpen(false);
  setFfprobeRawModalOpen(false);
  setPreflightModalOpen(false);
  setConfirmDialogOpen(false);
  setSelectedFileId(null);
}

// ── Settings ──
export const [settings, setSettings] = createSignal<AppSettings>({
  providers: [],
  active_provider_index: 0,
  ffmpeg_path: "",
  ffprobe_path: "",
  default_output_folder: "",
  naming_template: "{name}.mkv",
  max_parallel: 1,
  check_updates_on_startup: true,
});

// ── Logs ──
export const [logEntries, setLogEntries] = createSignal<LogEntry[]>([]);
export const [logPaneOpen, setLogPaneOpen] = createSignal(false);

export function addLog(entry: LogEntry) {
  setLogEntries((prev) => [...prev.slice(-499), entry]);
}

export function clearLogs() {
  setLogEntries([]);
}

// ── Processing State ──
export const isProcessing = createMemo(() =>
  workQueue().files.some((f) => f.status === "Processing")
);
export const [currentProcessingId, setCurrentProcessingId] = createSignal<string | null>(null);

// ── Scanning State ──
export const [isScanning, setIsScanning] = createSignal(false);

// ── Generating State ──
export const [isGenerating, setIsGenerating] = createSignal(false);
