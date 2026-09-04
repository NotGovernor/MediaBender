import { invoke } from "@tauri-apps/api/core";
import { addLog, setIsScanning, setWorkQueue, workQueue } from "../stores/appStore";
import type { LogEntry, WorkQueue } from "../types";

export interface AutoScannerDeps {
  scanAndAnalyze: (fileIds: string[], ffprobePath: string) => Promise<WorkQueue>;
  setWorkQueue: (queue: WorkQueue) => void;
  addLog: (entry: LogEntry) => void;
  setIsScanning: (value: boolean) => void;
}

export async function scanPendingFiles(
  fileIds: string[],
  ffprobePath: string,
  deps: AutoScannerDeps
): Promise<void> {
  if (fileIds.length === 0) {
    deps.addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "No pending files need analysis.",
    });
    return;
  }

  deps.setIsScanning(true);
  deps.addLog({
    timestamp: new Date().toISOString(),
    level: "info",
    message: `Scanning ${fileIds.length} file${fileIds.length === 1 ? "" : "s"}...`,
  });

  try {
    const queue = await deps.scanAndAnalyze(fileIds, ffprobePath);
    deps.setWorkQueue(queue);

    const scanned = queue.files.filter((f) => fileIds.includes(f.id));
    const analyzedCount = scanned.filter((f) => f.metadata).length;
    const errorCount = scanned.filter((f) => f.status === "Error").length;

    deps.addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Scan complete: ${analyzedCount} analyzed, ${errorCount} errors.`,
    });
  } catch (err) {
    deps.addLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: `Scan & Analyze failed: ${err}`,
    });
  } finally {
    deps.setIsScanning(false);
  }
}

async function tauriScanAndAnalyze(fileIds: string[], ffprobePath: string): Promise<WorkQueue> {
  return invoke<WorkQueue>("scan_and_analyze", {
    fileIds,
    ffprobePath,
  });
}

export async function scanQueue(ffprobePath: string): Promise<void> {
  const pendingWithoutMetadata = workQueue().files
    .filter((f) => f.status === "Pending" && !f.metadata)
    .map((f) => f.id);

  await scanPendingFiles(pendingWithoutMetadata, ffprobePath, {
    scanAndAnalyze: tauriScanAndAnalyze,
    setWorkQueue,
    addLog,
    setIsScanning,
  });
}
