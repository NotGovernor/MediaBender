import { describe, it, expect } from "vitest";
import { dedupeFiles } from "./dedupeFiles";
import type { VideoFile } from "../types";

function makeFile(overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    id: "id-1",
    input_path: "/vids/a.mkv",
    output_path: "",
    scan_root: "",
    ffprobe_raw: "",
    metadata: null,
    generated_command: "",
    command_args: "",
    description: "",
    reasoning: "",
    status: "Pending",
    is_approved: false,
    error_message: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    input_size: 0,
    output_size: 0,
    processing_duration: 0,
    completed_at: "",
    ...overrides,
  };
}

describe("dedupeFiles", () => {
  it("returns all incoming files when no existing files", () => {
    const incoming = [makeFile({ id: "f1", input_path: "/vids/a.mkv" })];

    const result = dedupeFiles([], incoming, false);

    expect(result.newFiles).toEqual(incoming);
    expect(result.skippedCount).toBe(0);
  });

  it("skips incoming files whose input_path exactly matches an existing file", () => {
    const existing = [makeFile({ id: "f1", input_path: "/vids/a.mkv" })];
    const incoming = [makeFile({ id: "f2", input_path: "/vids/a.mkv" })];

    const result = dedupeFiles(existing, incoming, false);

    expect(result.newFiles).toEqual([]);
    expect(result.skippedCount).toBe(1);
  });

  it("adds only new files when incoming contains duplicates and new files", () => {
    const existing = [
      makeFile({ id: "f1", input_path: "/vids/a.mkv" }),
      makeFile({ id: "f2", input_path: "/vids/b.mkv" }),
    ];
    const incoming = [
      makeFile({ id: "f3", input_path: "/vids/a.mkv" }),
      makeFile({ id: "f4", input_path: "/vids/c.mkv" }),
      makeFile({ id: "f5", input_path: "/vids/b.mkv" }),
    ];

    const result = dedupeFiles(existing, incoming, false);

    expect(result.newFiles).toEqual([incoming[1]]);
    expect(result.skippedCount).toBe(2);
  });

  it("treats Windows paths with different case as duplicates when isWindows is true", () => {
    const existing = [makeFile({ id: "f1", input_path: "C:/Users/Video.mkv" })];
    const incoming = [makeFile({ id: "f2", input_path: "c:/users/video.mkv" })];

    const result = dedupeFiles(existing, incoming, true);

    expect(result.newFiles).toEqual([]);
    expect(result.skippedCount).toBe(1);
  });

  it("treats Windows paths with backslashes as duplicates after normalization", () => {
    const existing = [makeFile({ id: "f1", input_path: "C:/Users/Video.mkv" })];
    const incoming = [makeFile({ id: "f2", input_path: "C:\\Users\\Video.mkv" })];

    const result = dedupeFiles(existing, incoming, true);

    expect(result.newFiles).toEqual([]);
    expect(result.skippedCount).toBe(1);
  });

  it("treats paths with different case as different files on Linux/macOS", () => {
    const existing = [makeFile({ id: "f1", input_path: "/Vids/Video.mkv" })];
    const incoming = [makeFile({ id: "f2", input_path: "/vids/video.mkv" })];

    const result = dedupeFiles(existing, incoming, false);

    expect(result.newFiles).toEqual(incoming);
    expect(result.skippedCount).toBe(0);
  });
});
