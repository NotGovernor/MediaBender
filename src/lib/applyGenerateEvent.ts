import type { VideoFile } from "../types";
import { updateFile, removeGeneratingId } from "../stores/appStore";

export function applyGenerateEvent(file: VideoFile) {
  updateFile(file.id, file);
  removeGeneratingId(file.id);
}

export type ExecutorEventPayload = {
  type: string;
  fileId: string;
  line?: string;
  success?: boolean;
  message?: string;
  outputSize?: number;
  processingDuration?: number;
  completedAt?: string;
};

export function applyExecutorEvent(
  payload: ExecutorEventPayload,
): "log" | "started" | "completed" | "ignored" {
  if (payload.type === "stdout" || payload.type === "stderr") {
    return "log";
  }
  if (payload.type === "started") {
    updateFile(payload.fileId, {
      status: "Processing",
      updated_at: new Date().toISOString(),
    });
    return "started";
  }
  if (payload.type === "completed") {
    const success = payload.success ?? false;
    if (success) {
      updateFile(payload.fileId, {
        status: "Completed",
        output_size: payload.outputSize ?? 0,
        error_message: "",
        processing_duration: payload.processingDuration ?? 0,
        completed_at: payload.completedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else {
      updateFile(payload.fileId, {
        status: "Error",
        error_message: payload.message ?? "Processing failed",
        processing_duration: payload.processingDuration ?? 0,
        completed_at: payload.completedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    return "completed";
  }
  return "ignored";
}
