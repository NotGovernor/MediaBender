import { For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import StatusBadge from "./StatusBadge";
import {
  queueFiles,
  openReview,
  openDetail,
  setWorkQueue,
  selectedFileId,
  closeModals,
  addLog,
  isFileDropHovering,
} from "../stores/appStore";
import type { VideoFile, FileStatus, WorkQueue } from "../types";
import { isStartEligible } from "../lib/queueReadiness";

function formatDuration(seconds: number): string {
  if (!seconds) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getVideoSummary(file: VideoFile): string {
  if (!file.metadata) return "--";
  const v = file.metadata.video;
  const hdr = v.hdr ? " HDR" : "";
  return `${v.codec}${hdr} ${v.bit_depth}bit`;
}

function getAudioSummary(file: VideoFile): string {
  if (!file.metadata || file.metadata.audio_streams.length === 0) return "--";
  const streams = file.metadata.audio_streams;
  if (streams.length === 1) {
    const s = streams[0];
    return `${s.codec} ${s.channels}ch`;
  }
  return `${streams.length} streams`;
}

function getSubsSummary(file: VideoFile): string {
  if (!file.metadata) return "--";
  const count = file.metadata.subtitle_count;
  return count > 0 ? `${count} sub${count > 1 ? "s" : ""}` : "None";
}

function handleRowClick(file: VideoFile) {
  const doneStatuses: FileStatus[] = ["Completed", "Error", "Skipped"];
  // Two-factor routing for Error status:
  // - generation error (no command yet) → ReviewModal
  // - processing error (command exists) → DetailModal
  if (file.status === "Error") {
    if (file.generated_command === "") {
      openReview(file.id);
    } else {
      openDetail(file.id);
    }
    return;
  }
  if (doneStatuses.includes(file.status)) {
    openDetail(file.id);
  } else {
    openReview(file.id);
  }
}

async function handleRemove(file: VideoFile) {
  try {
    const q = await invoke<WorkQueue>("remove_file", { fileId: file.id });
    setWorkQueue(q);
    if (selectedFileId() === file.id) {
      closeModals();
    }
  } catch (err) {
    addLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: `Failed to remove file: ${err}`,
      file_id: file.id,
    });
  }
}

export default function FileTable() {
  const files = queueFiles;

  return (
    <div class="flex-1 overflow-auto relative">
      <Show
        when={files().length > 0}
        fallback={
          <div class="h-full flex flex-col items-center justify-center text-text-muted">
            <div class="text-4xl mb-4">📂</div>
            <p class="text-sm mb-2">No files in queue</p>
            <p class="text-xs">Drop files or folders, or click Add Files</p>
          </div>
        }
      >
        <table class="w-full text-left text-sm">
          <thead class="bg-bg-secondary sticky top-0 z-10">
            <tr class="border-b border-border">
              <th class="px-4 py-2.5 font-medium text-text-muted w-[200px]">Filename</th>
              <th class="px-3 py-2.5 font-medium text-text-muted w-[70px]">Container</th>
              <th class="px-3 py-2.5 font-medium text-text-muted w-[120px]">Video</th>
              <th class="px-3 py-2.5 font-medium text-text-muted w-[110px]">Audio</th>
              <th class="px-3 py-2.5 font-medium text-text-muted w-[80px]">Subs</th>
              <th class="px-3 py-2.5 font-medium text-text-muted w-[80px]">Duration</th>
              <th class="px-3 py-2.5 font-medium text-text-muted w-[100px]">Status</th>
              <th class="px-3 py-2.5 font-medium text-text-muted min-w-[200px]">Description</th>
              <th class="px-3 py-2.5 font-medium text-text-muted w-[50px]" />
            </tr>
          </thead>
          <tbody>
            <For each={files()}>
              {(file) => (
                <tr
                  data-start-eligible={isStartEligible(file) ? "true" : "false"}
                  class={`border-b border-border border-l-2 hover:bg-bg-tertiary/50 cursor-pointer transition-colors group ${
                    isStartEligible(file) ? "border-l-gold" : "border-l-transparent"
                  }`}
                  onClick={() => handleRowClick(file)}
                >
                  <td class="px-4 py-2">
                    <div class="truncate max-w-[180px]" title={file.input_path}>
                      {file.input_path.split(/[/\\]/).pop()}
                    </div>
                  </td>
                  <td class="px-3 py-2 text-text-secondary">
                    {file.metadata?.container?.toUpperCase() ?? "--"}
                  </td>
                  <td class="px-3 py-2 text-text-secondary">{getVideoSummary(file)}</td>
                  <td class="px-3 py-2 text-text-secondary">{getAudioSummary(file)}</td>
                  <td class="px-3 py-2 text-text-secondary">{getSubsSummary(file)}</td>
                  <td class="px-3 py-2 text-text-secondary">
                    {formatDuration(file.metadata?.duration ?? 0)}
                  </td>
                  <td class="px-3 py-2">
                    <StatusBadge status={file.status} isApproved={file.is_approved} />
                  </td>
                  <td class="px-3 py-2 text-text-secondary">
                    <div class="truncate max-w-[240px]" title={file.description}>
                      {file.description || "--"}
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemove(file);
                      }}
                      class="text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from queue"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
      <Show when={isFileDropHovering()}>
        <div
          data-testid="file-drop-overlay"
          class="absolute inset-0 z-20 pointer-events-none flex items-center justify-center border-2 border-dashed border-gold bg-gold/10"
        >
          <p class="text-sm text-gold">Drop videos or folders</p>
        </div>
      </Show>
    </div>
  );
}
