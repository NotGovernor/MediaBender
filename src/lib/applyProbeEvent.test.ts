import { describe, it, expect, beforeEach } from "vitest";
import { applyProbeEvent } from "./applyProbeEvent";
import {
  setWorkQueue,
  workQueue,
  addGeneratingIds,
  generatingIds,
  clearGeneratingIds,
} from "../stores/appStore";
import { createMockFile } from "../test-helpers";
import type { FileMetadata } from "../types";

describe("applyProbeEvent", () => {
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

  it("applyProbeEvent_patches_metadata_on_matching_id", () => {
    const fileA = createMockFile({ id: "a", metadata: null, ffprobe_raw: "", input_size: 0 });
    const fileB = createMockFile({ id: "b", metadata: null, ffprobe_raw: "", input_size: 0 });
    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));

    const metadata: FileMetadata = {
      container: "mkv",
      video: {
        codec: "h264",
        width: 1920,
        height: 1080,
        hdr: false,
        bit_depth: 8,
        fps: 24,
      },
      audio_streams: [],
      subtitle_streams: [],
      subtitle_count: 0,
      has_chapters: false,
      duration: 0,
      bitrate: 0,
    };

    applyProbeEvent({
      ...fileA,
      metadata,
      ffprobe_raw: '{"format":"matroska"}',
      input_size: 99,
    });

    const a = workQueue().files.find((f) => f.id === "a")!;
    const b = workQueue().files.find((f) => f.id === "b")!;
    expect(a.metadata?.container).toBe("mkv");
    expect(a.ffprobe_raw).toBe('{"format":"matroska"}');
    expect(a.input_size).toBe(99);
    expect(b.metadata).toBeNull();
  });

  it("applyProbeEvent_patches_Error_status", () => {
    const pending = createMockFile({ id: "a", status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [pending] }));

    applyProbeEvent({
      ...pending,
      status: "Error",
      error_message: "ffprobe died",
    });

    const file = workQueue().files.find((f) => f.id === "a")!;
    expect(file.status).toBe("Error");
    expect(file.error_message).toBe("ffprobe died");
  });

  it("applyProbeEvent_does_not_add_or_remove_generating_ids", () => {
    const pending = createMockFile({ id: "a", status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [pending] }));
    addGeneratingIds(["a"]);

    applyProbeEvent({
      ...pending,
      ffprobe_raw: "raw",
    });

    expect(generatingIds()).toEqual(["a"]);
  });
});
