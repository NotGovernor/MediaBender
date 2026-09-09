import { invoke } from "@tauri-apps/api/core";
import { addLog, setIsScanning, settings, workQueue } from "../stores/appStore";
import type { LogEntry, WorkQueue } from "../types";

export interface AutoScannerDeps {
  scanAndAnalyze: (fileIds: string[], ffprobePath: string) => Promise<WorkQueue>;
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

/** Test-only override for scan_and_analyze. Production defaults to invoke. */
let scanAndAnalyzeImpl: (fileIds: string[], ffprobePath: string) => Promise<WorkQueue> =
  tauriScanAndAnalyze;

export function setScanAndAnalyzeForTests(
  impl: ((fileIds: string[], ffprobePath: string) => Promise<WorkQueue>) | null
): void {
  scanAndAnalyzeImpl = impl ?? tauriScanAndAnalyze;
}

let scanInFlight = false;
let scanQueued = false;

export function resetScanFlightForTests(): void {
  scanInFlight = false;
  scanQueued = false;
  scanAndAnalyzeImpl = tauriScanAndAnalyze;
}

async function runOneScan(options: { logIfEmpty: boolean; ffprobePath?: string }): Promise<void> {
  const fileIds = workQueue()
    .files.filter((f) => f.status === "Pending" && !f.metadata)
    .map((f) => f.id);
  const ffprobePath = options.ffprobePath ?? settings().ffprobe_path;

  if (!ffprobePath) {
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "Files will be scanned once FFprobe is configured.",
    });
    return;
  }

  if (fileIds.length === 0) {
    if (options.logIfEmpty) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "No pending files need analysis.",
      });
    }
    return;
  }

  // requestScanPending owns isScanning across coalesced drains.
  await scanPendingFiles(fileIds, ffprobePath, {
    scanAndAnalyze: scanAndAnalyzeImpl,
    addLog,
    setIsScanning: () => {},
  });
}

export async function requestScanPending(options: {
  logIfEmpty: boolean;
  ffprobePath?: string;
}): Promise<void> {
  if (scanInFlight) {
    scanQueued = true;
    return;
  }
  scanInFlight = true;
  setIsScanning(true);
  try {
    do {
      scanQueued = false;
      await runOneScan(options);
    } while (scanQueued);
  } finally {
    scanInFlight = false;
    setIsScanning(false);
  }
  if (scanQueued) {
    await requestScanPending(options);
  }
}

export async function scanQueue(ffprobePath: string): Promise<void> {
  await requestScanPending({ logIfEmpty: true, ffprobePath });
}
