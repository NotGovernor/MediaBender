import { invoke } from "@tauri-apps/api/core";
import { addLog, setWorkQueue, settings, workQueue } from "../stores/appStore";
import type { WorkQueue } from "../types";

export async function scanPendingAfterAdd(): Promise<void> {
  const s = settings();
  const fileIds = workQueue()
    .files.filter((f) => !f.metadata && f.status === "Pending")
    .map((f) => f.id);
  if (!s.ffprobe_path) {
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Files will be scanned once FFprobe is configured.",
    });
    return;
  }
  if (fileIds.length === 0) return;
  const scanned = await invoke<WorkQueue>("scan_and_analyze", {
    fileIds,
    ffprobePath: s.ffprobe_path,
  });
  setWorkQueue(scanned);
}
