import { createSignal, Show, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import Modal from "./Modal";
import StatusBadge from "./StatusBadge";
import {
  detailModalOpen,
  selectedFile,
  selectedFileId,
  closeModals,
  handoffToReview,
  addLog,
  setConfirmDialogOpen,
  setConfirmDialogConfig,
  addGeneratingIds,
  removeGeneratingId,
  generatingIds,
  patchFilesFromQueue,
  settings,
  setPreflightModalOpen,
  setScheduledIds,
  scheduledIds,
  isGenerating,
} from "../stores/appStore";
import type { WorkQueue } from "../types";
import { isFrozen } from "../lib/queueReadiness";

function formatSize(bytes: number): string {
  if (!bytes) return "Unknown";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function buildSubtitle(file: ReturnType<typeof selectedFile>): string {
  if (!file()) return "";
  const m = file()!.metadata;
  if (!m) return "-- · -- · -- · --";
  const container = m.container.toUpperCase();
  const videoCodec = m.video.codec;
  const audio = m.audio_streams[0];
  const audioCodec = audio?.codec ?? "--";
  const channels = audio?.channels ?? "--";
  const duration = formatDuration(m.duration);
  return `${container} · ${videoCodec} · ${audioCodec} ${channels}ch · ${duration}`;
}

export default function DetailModal() {
  const file = selectedFile;
  const [feedback, setFeedback] = createSignal("");
  const [isRegenerating, setIsRegenerating] = createSignal(false);
  const [regenInFlight, setRegenInFlight] = createSignal(false);
  let lastFeedbackFileId: string | null = null;

  createEffect(() => {
    if (!file() || file()!.id !== lastFeedbackFileId) {
      setFeedback("");
      lastFeedbackFileId = file() ? file()!.id : null;
    }
  });

  createEffect(() => {
    if (!detailModalOpen()) {
      setFeedback("");
    }
  });

  const handleResetStatus = async () => {
    if (!file()) return;
    const fileId = file()!.id;
    const inputPath = file()!.input_path;
    try {
      const q = await invoke<WorkQueue>("reset_file", { fileId });
      patchFilesFromQueue(q, [fileId]);
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Reset status for: ${inputPath.split(/[/\\]/).pop()}`,
        file_id: fileId,
      });
      handoffToReview(fileId);
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Reset failed: ${err}`,
        file_id: fileId,
      });
    }
  };

  const generateInPlace = async (opts: { feedback: string | null; repair: boolean }) => {
    if (!file()) return;
    const id = file()!.id;
    const inputName = file()!.input_path.split(/[/\\]/).pop();
    const submitted = opts.feedback ?? "";
    setFeedback("");

    setIsRegenerating(true);
    setRegenInFlight(true);
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: opts.repair
        ? `Asking AI to fix command for: ${inputName}`
        : `Regenerating command with feedback for: ${inputName}`,
      file_id: id,
    });

    addGeneratingIds([id]);
    try {
      const q = await invoke<WorkQueue>("generate_commands", {
        fileIds: [id],
        feedback: opts.feedback,
        repair: opts.repair,
      });
      patchFilesFromQueue(q, [id]);

      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Regeneration complete for: ${inputName}`,
        file_id: id,
      });

      setFeedback("");
      if (selectedFileId() === id) {
        handoffToReview(id);
      }
    } catch (err) {
      if (selectedFileId() === id && detailModalOpen() && submitted) {
        setFeedback(submitted);
      }
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Regeneration failed: ${err}`,
        file_id: id,
      });
    } finally {
      setIsRegenerating(false);
      setRegenInFlight(false);
      removeGeneratingId(id);
    }
  };

  const handleRegenerate = async () => {
    if (!file()) return;
    const fb = feedback().trim();
    if (!fb) return;
    await generateInPlace({ feedback: fb, repair: false });
  };

  const handleAskAiToFix = async () => {
    if (!file() || file()!.status !== "Error") return;
    const fb = feedback().trim();
    await generateInPlace({ feedback: fb || null, repair: true });
  };

  const handleReprocess = async () => {
    if (!file()) return;
    const fileId = file()!.id;
    const outputPath = file()!.output_path;
    const inputName = file()!.input_path.split(/[/\\]/).pop();
    if (!settings().ffmpeg_path) {
      setPreflightModalOpen(true);
      return;
    }
    let exists = false;
    if (outputPath) {
      exists = await invoke<boolean>("output_file_exists", { outputPath });
    }
    const run = async () => {
      try {
        const q = await invoke<WorkQueue>("reprocess_file", {
          fileId,
          ffmpegPath: settings().ffmpeg_path,
        });
        patchFilesFromQueue(q, [fileId]);
        setScheduledIds((prev) => (prev.includes(fileId) ? prev : [...prev, fileId]));
        addLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: `Reprocessing: ${inputName}`,
          file_id: fileId,
        });
        closeModals();
      } catch (err) {
        addLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message: `Reprocess failed: ${err}`,
          file_id: fileId,
        });
      }
    };
    if (exists) {
      setConfirmDialogConfig({
        title: "Overwrite Output File?",
        message:
          "The existing output file will be overwritten. A failed run will not restore it.",
        detail: outputPath,
        confirmText: "Overwrite & Reprocess",
        confirmVariant: "danger",
        onConfirm: run,
      });
      setConfirmDialogOpen(true);
    } else {
      await run();
    }
  };

  return (
    <Modal
      open={detailModalOpen()}
      onClose={closeModals}
      title={file()?.input_path.split(/[/\\]/).pop() ?? ""}
      subtitle={buildSubtitle(file)}
      maxWidth="max-w-2xl"
    >
      <Show when={file()}>
        {(f) => (
          <div class="space-y-5">
            {/* Status */}
            <div class="flex items-center gap-3">
              <span class="text-xs font-mono uppercase tracking-wider text-text-muted">Status</span>
              <StatusBadge
                status={generatingIds().includes(f().id) ? "Generating" : f().status}
                isApproved={f().is_approved}
              />
            </div>

            {/* Input / Output Grid */}
            <div class="grid grid-cols-2 gap-4">
              <div class="bg-bg-tertiary rounded p-4">
                <h4 class="text-xs font-mono uppercase tracking-wider text-text-muted mb-2">
                  Input
                </h4>
                <div class="space-y-1.5">
                  <div class="text-sm text-text-secondary break-all">{f().input_path}</div>
                  <div class="text-xs text-text-muted">{formatSize(f().input_size)}</div>
                </div>
              </div>
              <div class="bg-bg-tertiary rounded p-4">
                <h4 class="text-xs font-mono uppercase tracking-wider text-text-muted mb-2">
                  Output
                </h4>
                <div class="space-y-1.5">
                  <div class="text-sm text-text-secondary break-all">
                    {f().output_path || "Not yet generated"}
                  </div>
                  <Show when={f().output_size > 0}>
                    <div class="text-xs text-text-muted">{formatSize(f().output_size)}</div>
                  </Show>
                </div>
              </div>
            </div>

            {/* Processing Details */}
            <Show when={f().status === "Completed" || f().status === "Error"}>
              <div class="bg-bg-tertiary rounded p-4">
                <h4 class="text-xs font-mono uppercase tracking-wider text-text-muted mb-3">
                  Processing Details
                </h4>
                <div class="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div class="text-text-muted text-xs mb-1">Duration</div>
                    <div class="text-text-primary">{formatDuration(f().processing_duration)}</div>
                  </div>
                  <div>
                    <div class="text-text-muted text-xs mb-1">Size Change</div>
                    <div class="text-text-primary">
                      {f().input_size && f().output_size
                        ? `${(
                            ((f().output_size - f().input_size) / f().input_size) *
                            100
                          ).toFixed(1)}%`
                        : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div class="text-text-muted text-xs mb-1">Completed</div>
                    <div class="text-text-primary">
                      {f().completed_at
                        ? new Date(f().completed_at).toLocaleString()
                        : "N/A"}
                    </div>
                  </div>
                </div>
              </div>
            </Show>

            {/* AI Description */}
            <div>
              <label class="block text-xs font-mono uppercase tracking-wider text-text-muted mb-1">
                AI Description
              </label>
              <p class="text-sm text-text-secondary bg-bg-tertiary rounded p-3">
                {f().description || "No description available."}
              </p>
            </div>

            {/* AI Reasoning */}
            <Show when={f().reasoning}>
              <div>
                <label class="block text-xs font-mono uppercase tracking-wider text-text-muted mb-1">
                  AI Reasoning
                </label>
                <p class="text-sm text-text-secondary bg-bg-tertiary rounded p-3">
                  {f().reasoning}
                </p>
              </div>
            </Show>

            <Show when={regenInFlight()}>
              <p class="text-sm text-gold">Regenerating…</p>
            </Show>

            {/* Command Used */}
            <Show when={f().generated_command}>
              <div>
                <label class="block text-xs font-mono uppercase tracking-wider text-text-muted mb-1">
                  Command Used
                </label>
                <div class="bg-bg-primary rounded p-3 text-sm font-mono text-gold break-all">
                  {f().generated_command}
                </div>
              </div>
            </Show>

            {/* Error Message */}
            <Show when={f().error_message}>
              <div class="bg-danger/10 border border-danger/20 rounded p-3 flex flex-col gap-3">
                <label class="block text-xs font-mono uppercase tracking-wider text-danger">
                  Error
                </label>
                <p class="text-sm text-danger whitespace-pre-wrap overflow-y-auto max-h-32">
                  {f().error_message}
                </p>
                <Show when={f().status === "Error"}>
                  <div class="flex justify-center">
                    <button
                      onClick={handleAskAiToFix}
                      disabled={isRegenerating()}
                      class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Ask AI to fix
                    </button>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Regeneration Feedback */}
            <div>
              <label class="block text-xs font-mono uppercase tracking-wider text-text-muted mb-1">
                Regeneration Feedback (optional)
              </label>
              <textarea
                value={feedback()}
                onInput={(e) => setFeedback(e.currentTarget.value)}
                placeholder="e.g. Use 128k bitrate instead, or add -map_chapters 0..."
                class="w-full h-16 bg-bg-tertiary border border-border rounded p-3 text-sm text-text-primary resize-none focus:outline-none focus:border-gold/50"
              />
            </div>

            {/* Actions */}
            <div class="flex justify-between items-center pt-2">
              <button
                onClick={handleResetStatus}
                disabled={
                  isRegenerating() ||
                  (file() != null && isFrozen(file()!, scheduledIds()))
                }
                class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Reset Status
              </button>
              <div class="flex gap-3">
                <button
                  onClick={handleRegenerate}
                  disabled={isRegenerating() || !feedback().trim()}
                  class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Show when={isRegenerating()}>
                    <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </Show>
                  Regenerate Command
                </button>
                <Show
                  when={
                    (f().status === "Error" || f().status === "Completed") &&
                    f().command_args.trim() !== ""
                  }
                >
                  <button
                    onClick={handleReprocess}
                    disabled={
                      isRegenerating() ||
                      isGenerating() ||
                      scheduledIds().includes(f().id) ||
                      f().status === "Processing"
                    }
                    class="px-4 py-2 rounded text-sm font-medium bg-gold text-bg-primary hover:bg-gold-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Reprocess File
                  </button>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>
    </Modal>
  );
}
