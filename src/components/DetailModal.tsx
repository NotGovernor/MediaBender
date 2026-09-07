import { createSignal, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import Modal from "./Modal";
import StatusBadge from "./StatusBadge";
import {
  detailModalOpen,
  selectedFile,
  closeModals,
  handoffToReview,
  addLog,
  setConfirmDialogOpen,
  setConfirmDialogConfig,
  setPendingReviewRegenerateFeedback,
  setWorkQueue,
} from "../stores/appStore";
import type { WorkQueue } from "../types";

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

  const handleResetStatus = async () => {
    if (!file()) return;
    const fileId = file()!.id;
    const inputPath = file()!.input_path;
    try {
      const q = await invoke<WorkQueue>("reset_file", { fileId });
      setWorkQueue(q);
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

  const handleRegenerate = () => {
    if (!file()) return;
    const fb = feedback().trim();
    if (!fb) return;
    const fileId = file()!.id;
    setPendingReviewRegenerateFeedback(fb);
    handoffToReview(fileId);
  };

  const handleReprocess = () => {
    if (!file()) return;
    const fileId = file()!.id;
    const outputPath = file()!.output_path;
    const inputName = file()!.input_path.split(/[/\\]/).pop();
    setConfirmDialogConfig({
      title: "Delete Output File?",
      message:
        "The previous output file will be deleted. You will return to command review. The item will not be processed until you approve.",
      detail: outputPath || "Output path not set",
      confirmText: "Delete & Review",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          if (outputPath) {
            await invoke("delete_output_file", { outputPath });
          }
          const q = await invoke<WorkQueue>("reset_file", { fileId });
          setWorkQueue(q);
        } catch (err) {
          addLog({
            timestamp: new Date().toISOString(),
            level: "warn",
            message: `Could not delete output file: ${err}`,
            file_id: fileId,
          });
          return;
        }
        addLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: `Reprocessing: ${inputName}`,
          file_id: fileId,
        });
        handoffToReview(fileId);
      },
    });
    setConfirmDialogOpen(true);
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
              <StatusBadge status={f().status} isApproved={f().is_approved} />
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
              <div class="bg-danger/10 border border-danger/20 rounded p-3">
                <label class="block text-xs font-mono uppercase tracking-wider text-danger mb-1">
                  Error
                </label>
                <p class="text-sm text-danger">{f().error_message}</p>
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
                class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
              >
                Reset Status
              </button>
              <div class="flex gap-3">
                <button
                  onClick={handleRegenerate}
                  disabled={!feedback().trim()}
                  class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Regenerate Command
                </button>
                <Show when={f().output_path !== ""}>
                  <button
                    onClick={handleReprocess}
                    class="px-4 py-2 rounded text-sm font-medium bg-gold text-bg-primary hover:bg-gold-light transition-colors"
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
