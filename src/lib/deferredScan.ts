import type { LogEntry } from "../types";

export interface DeferredScanDeps {
  previousPath: string;
  currentPath: string;
  isScanning: boolean;
  scanQueue: (ffprobePath: string) => Promise<void>;
  addLog: (entry: LogEntry) => void;
}

export async function checkAndRunDeferredScan(deps: DeferredScanDeps): Promise<void> {
  if (deps.previousPath === "" && deps.currentPath !== "" && !deps.isScanning) {
    try {
      await deps.scanQueue(deps.currentPath);
    } catch (err) {
      deps.addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Deferred scan failed: ${err}`,
      });
      throw err;
    }
  }
}
