import { createSignal, Show, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import Modal from "./Modal";
import {
  reviewModalOpen,
  selectedFile,
  closeModals,
  addLog,
  setFfprobeRawModalOpen,
  setConfirmDialogOpen,
  setConfirmDialogConfig,
  workQueue,
  setWorkQueue,
} from "../stores/appStore";
import type { WorkQueue } from "../types";

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

export default function ReviewModal() {
  const file = selectedFile;
  const [commandArgs, setCommandArgs] = createSignal("");
  const [feedback, setFeedback] = createSignal("");
  const [isRegenerating, setIsRegenerating] = createSignal(false);
  const [applyStatusMessage, setApplyStatusMessage] = createSignal("");
  const [invokeError, setInvokeError] = createSignal("");

  // Update local command args when file changes
  createEffect(() => {
    if (file()) {
      setCommandArgs(file()!.command_args);
      setApplyStatusMessage("");
      setInvokeError("");
    }
  });

  const handleApprove = async () => {
    if (!file()) return;
    try {
      const q = await invoke<WorkQueue>("approve_file", {
        fileId: file()!.id,
        commandArgs: commandArgs(),
      });
      setWorkQueue(q);
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Approved: ${file()!.input_path.split(/[/\\]/).pop()}`,
        file_id: file()!.id,
      });
      closeModals();
    } catch (err) {
      setInvokeError(String(err));
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Approve failed: ${err}`,
        file_id: file()!.id,
      });
    }
  };

  const handleUnapprove = async () => {
    if (!file()) return;
    try {
      const q = await invoke<WorkQueue>("unapprove_file", { fileId: file()!.id });
      setWorkQueue(q);
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Unapproved: ${file()!.input_path.split(/[/\\]/).pop()}`,
        file_id: file()!.id,
      });
      closeModals();
    } catch (err) {
      setInvokeError(String(err));
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Unapprove failed: ${err}`,
        file_id: file()!.id,
      });
    }
  };

  const handleRegenerate = async () => {
    if (!file()) return;
    const fb = feedback().trim();
    // For regeneration (command exists), feedback is required
    if (file()!.generated_command !== "" && !fb) return;

    setIsRegenerating(true);
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Regenerating command with feedback for: ${file()!.input_path.split(/[/\\]/).pop()}`,
      file_id: file()!.id,
    });

    try {
      const q = await invoke<WorkQueue>("generate_commands", {
        fileIds: [file()!.id],
        feedback: fb,
      });
      setWorkQueue(q);

      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Regeneration complete for: ${file()!.input_path.split(/[/\\]/).pop()}`,
        file_id: file()!.id,
      });

      // Clear feedback on successful regeneration
      setFeedback("");
    } catch (err) {
      const errorMsg = String(err);
      setInvokeError(errorMsg);
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Regeneration failed: ${err}`,
        file_id: file()!.id,
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleSkip = async () => {
    if (!file()) return;
    try {
      const q = await invoke<WorkQueue>("skip_file", { fileId: file()!.id });
      setWorkQueue(q);
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Skipped: ${file()!.input_path.split(/[/\\]/).pop()}`,
        file_id: file()!.id,
      });
      closeModals();
    } catch (err) {
      setInvokeError(String(err));
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Skip failed: ${err}`,
        file_id: file()!.id,
      });
    }
  };

  const eligibleTargets = () => {
    const current = file();
    if (!current) return [];
    const files = workQueue().files;
    const currentIndex = files.findIndex((f) => f.id === current.id);
    if (currentIndex === -1) return [];
    return files.slice(currentIndex + 1).filter(
      (f) => f.metadata !== null && f.generated_command === ""
    );
  };

  const handleApplyTemplate = () => {
    if (!file()) return;
    const targets = eligibleTargets();
    if (targets.length === 0) return;

    setConfirmDialogConfig({
      title: "Apply Command Template",
      message: `Copy this command template to ${targets.length} remaining unconfigured item${targets.length === 1 ? "" : "s"} below this one?`,
      detail: "Items that already have commands will be skipped. This will not affect the current item.",
      confirmText: "Apply",
      confirmVariant: "primary",
      onConfirm: async () => {
        setIsRegenerating(true);
        setApplyStatusMessage("");
        addLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: `Applying command template to ${targets.length} item(s) below ${file()!.input_path.split(/[/\\]/).pop()}`,
          file_id: file()!.id,
        });

        try {
          const updated = await invoke<WorkQueue>("apply_command_template", {
            sourceId: file()!.id,
            targetIds: targets.map((t) => t.id),
          });
          setWorkQueue(updated);

          const applied = targets.filter((t) =>
            updated.files.some((f) => f.id === t.id && f.generated_command !== "")
          ).length;
          const skippedCount = targets.length - applied;
          addLog({
            timestamp: new Date().toISOString(),
            level: "info",
            message: `Applied command template to ${applied} item(s)${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}`,
            file_id: file()!.id,
          });

          setApplyStatusMessage(`Applied to ${applied} item${applied === 1 ? "" : "s"}`);
        } catch (err) {
          addLog({
            timestamp: new Date().toISOString(),
            level: "error",
            message: `Apply template failed: ${err}`,
            file_id: file()!.id,
          });
        } finally {
          setIsRegenerating(false);
        }
      },
    });
    setConfirmDialogOpen(true);
  };

  return (
    <Modal
      open={reviewModalOpen()}
      onClose={closeModals}
      title={file()?.input_path.split(/[/\\]/).pop() ?? ""}
      subtitle={buildSubtitle(file)}
      maxWidth="max-w-3xl"
      cardClass="border-gold"
    >
      <Show when={file()}>
        {(f) => (
          <div class="space-y-4">
            {/* Description */}
            <div>
              <label class="block text-xs font-mono uppercase tracking-wider text-text-muted mb-1">
                AI Description
              </label>
              <p class="text-sm text-text-secondary bg-bg-tertiary rounded p-3">
                {f().description || "No description generated yet."}
              </p>
            </div>

            {/* Error */}
            <Show when={f().error_message || invokeError()}>
              <div class="bg-danger/10 border border-danger/20 rounded p-3">
                <label class="block text-xs font-mono uppercase tracking-wider text-danger mb-1">
                  Error
                </label>
                <p class="text-sm text-danger">{invokeError() || f().error_message}</p>
              </div>
            </Show>

            {/* Command */}
            <div>
              <div class="flex items-center gap-2 mb-1">
                <label class="block text-xs font-mono uppercase tracking-wider text-text-muted">
                  FFmpeg Command
                </label>
                <span class="text-xs text-gold">Editable</span>
              </div>
              <textarea
                value={commandArgs()}
                onInput={(e) => setCommandArgs(e.currentTarget.value)}
                placeholder="No command generated yet."
                readOnly={f().generated_command === ""}
                class={`w-full h-32 border border-border rounded p-3 text-sm font-mono resize-none focus:outline-none focus:border-gold/50 ${
                  f().generated_command === ""
                    ? "bg-bg-tertiary text-text-muted cursor-not-allowed"
                    : "bg-bg-primary text-gold"
                }`}
                spellcheck={false}
                aria-label="FFmpeg Command"
              />
            </div>

            {/* Assembled command preview */}
            <div>
              <label class="block text-xs font-mono uppercase tracking-wider text-text-muted mb-1">
                Command preview
              </label>
              <div class="bg-bg-tertiary rounded p-3 text-sm font-mono text-text-secondary break-all">
                {f().generated_command || "No command generated yet."}
              </div>
            </div>

            {/* Reasoning */}
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

            {/* Feedback */}
            <Show when={!f().is_approved}>
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
            </Show>

            {/* Actions */}
            <div class="flex justify-between items-center pt-2">
              <div class="flex gap-3">
                <button
                  onClick={handleSkip}
                  class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
                >
                  Skip
                </button>
                <button
                  onClick={() => setFfprobeRawModalOpen(true)}
                  disabled={!f().ffprobe_raw}
                  class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  View ffprobe Raw
                </button>
              </div>
              <div class="flex flex-col items-end gap-1">
                <div class="flex gap-3 items-center">
                  <Show
                    when={f().is_approved}
                    fallback={
                      <>
                        <button
                          onClick={handleApplyTemplate}
                          disabled={f().generated_command === "" || eligibleTargets().length === 0 || isRegenerating()}
                          title={`Apply this command template to ${eligibleTargets().length} remaining unconfigured item${eligibleTargets().length === 1 ? "" : "s"} below`}
                          class="relative px-2 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                          aria-label="Apply to Remaining Items"
                        >
                          <Show when={isRegenerating()}>
                            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          </Show>
                          <Show when={!isRegenerating()}>
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                              <path d="M12 4v10" />
                              <path d="M7 11l5 5 5-5" />
                              <rect x="14" y="14" width="5" height="5" rx="1" />
                            </svg>
                          </Show>
                          <Show when={eligibleTargets().length > 0}>
                            <span class="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-gold text-bg-primary text-xs font-bold">
                              {eligibleTargets().length}
                            </span>
                          </Show>
                        </button>
                        <button
                          onClick={handleRegenerate}
                          disabled={isRegenerating() || (f().generated_command !== "" && !feedback().trim())}
                          class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        >
                          <Show when={isRegenerating()}>
                            <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                          </Show>
                          {f().generated_command === "" ? "Generate" : "Regenerate"}
                        </button>
                        <button
                          onClick={handleApprove}
                          class="px-4 py-2 rounded text-sm font-medium bg-gold text-bg-primary hover:bg-gold-light transition-colors"
                        >
                          Approve
                        </button>
                      </>
                    }
                  >
                    <button
                      onClick={handleUnapprove}
                      class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
                    >
                      Unapprove
                    </button>
                  </Show>
                </div>
                <Show when={applyStatusMessage()}>
                  <p class="text-sm text-success">{applyStatusMessage()}</p>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>
    </Modal>
  );
}
