import type { VideoFile } from "../types";

export interface DedupeResult {
  newFiles: VideoFile[];
  skippedCount: number;
}

function normalizePath(path: string, isWindows: boolean): string {
  const normalized = path.replace(/\\/g, "/");
  return isWindows ? normalized.toLowerCase() : normalized;
}

export function dedupeFiles(
  existingFiles: VideoFile[],
  incomingFiles: VideoFile[],
  isWindows: boolean
): DedupeResult {
  const existingPaths = new Set(
    existingFiles.map((f) => normalizePath(f.input_path, isWindows))
  );
  const newFiles: VideoFile[] = [];
  let skippedCount = 0;

  for (const file of incomingFiles) {
    if (existingPaths.has(normalizePath(file.input_path, isWindows))) {
      skippedCount++;
    } else {
      newFiles.push(file);
    }
  }

  return { newFiles, skippedCount };
}
