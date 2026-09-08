import { Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  isProcessing,
  isGenerating,
  addGeneratingIds,
  clearGeneratingIds,
  workQueue,
  patchFilesFromQueue,
  settings,
  addLog,
  setPreflightModalOpen,
  scheduledIds,
  setScheduledIds,
  isPipelineActive,
} from "../stores/appStore";
import type { WorkQueue } from "../types";
import { isAddable, isApprovable, isGenerateTarget } from "../lib/queueReadiness";

export default function TopBar() {
  const addableCount = () =>
    workQueue().files.filter((f) => isAddable(f, scheduledIds())).length;
  const generateTargetCount = () =>
    workQueue().files.filter((f) => isGenerateTarget(f, scheduledIds())).length;
  const processingCount = () =>
    workQueue().files.filter((f) => f.status === "Processing").length;
  const eligibleForApproval = () =>
    workQueue().files.filter((f) => isApprovable(f, scheduledIds())).length;

  const handleApproveAll = async () => {
    const eligible = workQueue().files.filter((f) => isApprovable(f, scheduledIds()));
    let approved = 0;
    for (const file of eligible) {
      try {
        const q = await invoke<WorkQueue>("approve_file", {
          fileId: file.id,
          commandArgs: file.command_args,
        });
        patchFilesFromQueue(q, [file.id]);
        approved += 1;
      } catch (err) {
        addLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message: `Failed to approve ${file.input_path.split(/[/\\]/).pop()}: ${err}`,
          file_id: file.id,
        });
      }
    }
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Approved ${approved} item${approved === 1 ? "" : "s"}.`,
    });
  };

  const prerequisitesMet = () => {
    const s = settings();
    const provider = s.providers[s.active_provider_index];
    const hasProvider = !!provider && provider.base_url.trim() !== "" && provider.api_key.trim() !== "" && provider.model.trim() !== "";
    const hasOutput = s.default_output_folder.trim() !== "";
    const hasFfmpeg = s.ffmpeg_path !== "" && s.ffprobe_path !== "";
    return hasProvider && hasOutput && hasFfmpeg;
  };

  const handleGenerate = async () => {
    const s = settings();
    const provider = s.providers[s.active_provider_index];
    const hasProvider = !!provider && provider.base_url.trim() !== "" && provider.api_key.trim() !== "" && provider.model.trim() !== "";
    if (!hasProvider) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "Generate Commands requires an AI provider. Configure one in Settings.",
      });
      return;
    }

    const analyzedWithoutCommand = workQueue().files
      .filter((f) => isGenerateTarget(f, scheduledIds()))
      .map((f) => f.id);

    if (analyzedWithoutCommand.length === 0) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "No analyzed files need commands generated.",
      });
      return;
    }

    addGeneratingIds(analyzedWithoutCommand);
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Generating commands for ${analyzedWithoutCommand.length} file${analyzedWithoutCommand.length === 1 ? "" : "s"}...`,
    });

    try {
      const q = await invoke<WorkQueue>("generate_commands", {
        fileIds: analyzedWithoutCommand,
        feedback: null,
      });
      patchFilesFromQueue(q, analyzedWithoutCommand);

      const generatedCount = q.files.filter(
        (f) => analyzedWithoutCommand.includes(f.id) && f.generated_command
      ).length;
      const errorCount = q.files.filter(
        (f) => analyzedWithoutCommand.includes(f.id) && f.status === "Error"
      ).length;

      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Generation complete: ${generatedCount} commands, ${errorCount} errors.`,
      });
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Generate Commands failed: ${err}`,
      });
    } finally {
      clearGeneratingIds();
    }
  };

  const handleStart = async () => {
    if (!prerequisitesMet()) {
      setPreflightModalOpen(true);
      return;
    }

    const s = settings();
    const addableIds = workQueue().files.filter((f) => isAddable(f, scheduledIds())).map((f) => f.id);

    if (addableIds.length === 0) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "No approved files are pending processing.",
      });
      return;
    }

    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Starting processing for ${addableIds.length} file${addableIds.length === 1 ? "" : "s"}...`,
    });

    try {
      await invoke("save_settings", { newSettings: s });
      await invoke("start_processing", {
        fileIds: addableIds,
        ffmpegPath: s.ffmpeg_path,
      });
      setScheduledIds((ids) => [...new Set([...ids, ...addableIds])]);
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Failed to start processing: ${err}`,
      });
    }
  };

  const handleStop = async () => {
    try {
      await invoke("stop_processing");
      addLog({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: "Processing stopped by user",
      });
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Failed to stop processing: ${err}`,
      });
    }
  };

  return (
    <header class="h-14 bg-bg-secondary border-b border-border flex items-center px-4 gap-3 flex-shrink-0">
      {/* Title */}
      <div class="flex items-center gap-2">
        <h1 class="text-sm font-semibold text-text-primary">Work Queue</h1>
        <Show when={workQueue().files.length > 0}>
          <span class="text-xs text-text-muted">
            {workQueue().files.length} file{workQueue().files.length === 1 ? "" : "s"}
          </span>
        </Show>
        <Show when={isProcessing()}>
          <span class="text-xs text-gold">
            ({processingCount()} processing)
          </span>
        </Show>
      </div>

      <div class="flex-1" />

      <button
        onClick={handleGenerate}
        disabled={isGenerating() || generateTargetCount() === 0}
        class="px-4 py-1.5 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
      >
        <Show when={isGenerating()}>
          <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </Show>
        Generate Commands
      </button>

      <button
        onClick={handleApproveAll}
        disabled={eligibleForApproval() === 0}
        class="px-4 py-1.5 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Approve All
      </button>

      <Show when={!(isPipelineActive() && addableCount() === 0)}>
        <button
          onClick={handleStart}
          disabled={addableCount() === 0}
          class="px-4 py-1.5 rounded text-sm font-medium bg-gold text-bg-primary hover:bg-gold-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPipelineActive()
            ? `Add to Queue (${addableCount()})`
            : addableCount() > 0
              ? `Start Processing (${addableCount()})`
              : "Start Processing"}
        </button>
      </Show>
      <Show when={isPipelineActive()}>
        <button
          onClick={handleStop}
          class="px-4 py-1.5 rounded text-sm font-medium bg-danger text-white hover:bg-danger/80 transition-colors flex items-center gap-2"
        >
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      </Show>
    </header>
  );
}
