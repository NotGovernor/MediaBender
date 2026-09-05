import type { AddPathsResult, LogEntry, View, WorkQueue } from "../types";

export interface FileDropAcceptState {
  view: View;
  reviewModalOpen: boolean;
  detailModalOpen: boolean;
  ffprobeRawModalOpen: boolean;
  preflightModalOpen: boolean;
  confirmDialogOpen: boolean;
  updateDialogOpen: boolean;
}

export function shouldAcceptFileDrop(state: FileDropAcceptState): boolean {
  if (state.view !== "dashboard") return false;
  if (state.reviewModalOpen) return false;
  if (state.detailModalOpen) return false;
  if (state.ffprobeRawModalOpen) return false;
  if (state.preflightModalOpen) return false;
  if (state.confirmDialogOpen) return false;
  if (state.updateDialogOpen) return false;
  return true;
}

export function nextFileDropHover(
  type: "enter" | "over" | "drop" | "leave",
  accept: boolean
): boolean {
  if (!accept) return false;
  return type === "enter" || type === "over";
}

export function formatAddPathsLog(stats: {
  added: number;
  skipped_non_video: number;
  skipped_duplicates: number;
}): Array<{ level: LogEntry["level"]; message: string }> {
  if (
    stats.added === 0 &&
    stats.skipped_non_video === 0 &&
    stats.skipped_duplicates === 0
  ) {
    return [{ level: "warn", message: "No video files found in drop" }];
  }
  const logs: Array<{ level: LogEntry["level"]; message: string }> = [];
  if (stats.added > 0) {
    logs.push({
      level: "info",
      message: `Added ${stats.added} file(s) to queue`,
    });
  }
  if (stats.skipped_non_video > 0) {
    logs.push({
      level: "warn",
      message: `Skipped ${stats.skipped_non_video} non-video file(s)`,
    });
  }
  if (stats.skipped_duplicates > 0) {
    logs.push({
      level: "warn",
      message: `Skipped ${stats.skipped_duplicates} duplicate file(s) already in queue`,
    });
  }
  return logs;
}

export interface ApplyFileDropDeps {
  accept: boolean;
  addPaths: (paths: string[]) => Promise<AddPathsResult>;
  setWorkQueue: (queue: WorkQueue) => void;
  addLog: (entry: LogEntry) => void;
  scanAfterAdd: () => Promise<void>;
}

export async function applyFileDrop(
  paths: string[],
  deps: ApplyFileDropDeps
): Promise<void> {
  if (!deps.accept || paths.length === 0) return;
  try {
    const result = await deps.addPaths(paths);
    deps.setWorkQueue(result.queue);
    for (const log of formatAddPathsLog(result)) {
      deps.addLog({
        timestamp: new Date().toISOString(),
        level: log.level,
        message: log.message,
      });
    }
    if (result.added > 0) {
      await deps.scanAfterAdd();
    }
  } catch (err) {
    deps.addLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: `Failed to add dropped files: ${err}`,
    });
  }
}
