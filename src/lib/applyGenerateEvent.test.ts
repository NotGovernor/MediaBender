import { describe, it, expect, beforeEach } from "vitest";
import { applyGenerateEvent } from "./applyGenerateEvent";
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
