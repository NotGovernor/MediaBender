import { describe, it, expect, beforeEach } from "vitest";
import { applyGenerateEvent, applyExecutorEvent } from "./applyGenerateEvent";
import {
  setWorkQueue,
  workQueue,
  addGeneratingIds,
  generatingIds,
  clearGeneratingIds,
} from "../stores/appStore";
import { createMockFile } from "../test-helpers";

describe("applyGenerateEvent", () => {
  beforeEach(() => {
    clearGeneratingIds();
    setWorkQueue({
      output_folder: "/out",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("patches_file_and_removes_overlay_id", () => {
    const pending = createMockFile({
      id: "a",
      status: "Pending",
      generated_command: "",
      command_args: "",
      description: "",
    });
    setWorkQueue((q) => ({ ...q, files: [pending] }));
    addGeneratingIds(["a", "b"]);

    applyGenerateEvent({
      ...pending,
      generated_command: "ffmpeg -i in.mkv out.mkv",
      command_args: "-c:v copy",
      description: "copy video",
      status: "Pending",
    });

    const file = workQueue().files.find((f) => f.id === "a")!;
    expect(file.command_args).toBe("-c:v copy");
    expect(file.description).toBe("copy video");
    expect(file.status).toBe("Pending");
    expect(generatingIds()).toEqual(["b"]);
  });

  it("patches_Error_result", () => {
    const pending = createMockFile({ id: "a", status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [pending] }));
    addGeneratingIds(["a"]);

    applyGenerateEvent({
      ...pending,
      status: "Error",
      error_message: "provider 500",
    });

    const file = workQueue().files.find((f) => f.id === "a")!;
    expect(file.status).toBe("Error");
    expect(file.error_message).toBe("provider 500");
    expect(generatingIds()).toEqual([]);
  });
});

describe("applyExecutorEvent", () => {
  it("apply_executor_started_sets_Processing", () => {
    const pending = createMockFile({ id: "a", status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [pending] }));
    expect(applyExecutorEvent({ type: "started", fileId: "a" })).toBe("started");
    expect(workQueue().files[0].status).toBe("Processing");
  });

  it("apply_executor_completed_success_sets_Completed", () => {
    const live = createMockFile({ id: "a", status: "Processing" });
    setWorkQueue((q) => ({ ...q, files: [live] }));
    expect(
      applyExecutorEvent({
        type: "completed",
        fileId: "a",
        success: true,
        message: "ok",
        outputSize: 12,
        processingDuration: 1.5,
        completedAt: "ts",
      }),
    ).toBe("completed");
    const f = workQueue().files[0];
    expect(f.status).toBe("Completed");
    expect(f.output_size).toBe(12);
    expect(f.error_message).toBe("");
    expect(f.processing_duration).toBe(1.5);
    expect(f.completed_at).toBe("ts");
  });

  it("apply_executor_completed_failure_sets_Error", () => {
    const live = createMockFile({ id: "a", status: "Processing" });
    setWorkQueue((q) => ({ ...q, files: [live] }));
    expect(
      applyExecutorEvent({
        type: "completed",
        fileId: "a",
        success: false,
        message: "boom",
      }),
    ).toBe("completed");
    expect(workQueue().files[0].status).toBe("Error");
    expect(workQueue().files[0].error_message).toBe("boom");
  });

  it("apply_executor_log_types_do_not_touch_files", () => {
    const live = createMockFile({ id: "a", status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [live] }));
    expect(applyExecutorEvent({ type: "stdout", fileId: "a", line: "frame=" })).toBe("log");
    expect(applyExecutorEvent({ type: "stderr", fileId: "a", line: "x" })).toBe("log");
    expect(workQueue().files[0].status).toBe("Pending");
  });
});
