import { describe, it, expect, vi } from "vitest";
import {
  shouldAcceptFileDrop,
  nextFileDropHover,
  formatAddPathsLog,
  applyFileDrop,
} from "./fileDrop";
import type { AddPathsResult, WorkQueue } from "../types";

function emptyQueue(): WorkQueue {
  return {
    output_folder: "",
    guidelines: "",
    files: [],
    created_at: "t",
    last_modified: "t",
  };
}

describe("shouldAcceptFileDrop", () => {
  const clear = {
    view: "dashboard" as const,
    reviewModalOpen: false,
    detailModalOpen: false,
    ffprobeRawModalOpen: false,
    preflightModalOpen: false,
    confirmDialogOpen: false,
    updateDialogOpen: false,
  };

  it("accepts_drop_on_dashboard_with_no_modals", () => {
    expect(shouldAcceptFileDrop(clear)).toBe(true);
  });

  it("rejects_drop_on_settings_view", () => {
    expect(shouldAcceptFileDrop({ ...clear, view: "settings" })).toBe(false);
  });

  it("rejects_drop_when_review_modal_open", () => {
    expect(shouldAcceptFileDrop({ ...clear, reviewModalOpen: true })).toBe(false);
  });

  it("rejects_drop_when_update_dialog_open", () => {
    expect(shouldAcceptFileDrop({ ...clear, updateDialogOpen: true })).toBe(false);
  });
});

describe("nextFileDropHover", () => {
  it("enter_sets_hover_when_accepted", () => {
    expect(nextFileDropHover("enter", true)).toBe(true);
  });

  it("leave_or_drop_clears_hover", () => {
    expect(nextFileDropHover("leave", true)).toBe(false);
    expect(nextFileDropHover("drop", true)).toBe(false);
  });

  it("never_hovers_when_not_accepted", () => {
    expect(nextFileDropHover("enter", false)).toBe(false);
    expect(nextFileDropHover("over", false)).toBe(false);
  });
});

describe("formatAddPathsLog", () => {
  it("logs_added_and_skip_counts", () => {
    const logs = formatAddPathsLog({
      added: 2,
      skipped_non_video: 1,
      skipped_duplicates: 3,
    });
    expect(logs).toEqual([
      { level: "info", message: "Added 2 file(s) to queue" },
      { level: "warn", message: "Skipped 1 non-video file(s)" },
      {
        level: "warn",
        message: "Skipped 3 duplicate file(s) already in queue",
      },
    ]);
  });

  it("logs_no_video_files_found_in_drop", () => {
    const logs = formatAddPathsLog({
      added: 0,
      skipped_non_video: 0,
      skipped_duplicates: 0,
    });
    expect(logs).toEqual([
      { level: "warn", message: "No video files found in drop" },
    ]);
  });
});

describe("applyFileDrop", () => {
  it("noops_when_not_accepted", async () => {
    const addPaths = vi.fn();
    await applyFileDrop(["/a.mkv"], {
      accept: false,
      addPaths,
      setWorkQueue: vi.fn(),
      addLog: vi.fn(),
      scanAfterAdd: vi.fn(),
    });
    expect(addPaths).not.toHaveBeenCalled();
  });

  it("invokes_add_paths_sets_queue_logs_and_scans_when_added", async () => {
    const queue = emptyQueue();
    const result: AddPathsResult = {
      queue,
      added: 1,
      skipped_non_video: 0,
      skipped_duplicates: 0,
    };
    const addPaths = vi.fn().mockResolvedValue(result);
    const setWorkQueue = vi.fn();
    const addLog = vi.fn();
    const scanAfterAdd = vi.fn().mockResolvedValue(undefined);

    await applyFileDrop(["/a.mkv"], {
      accept: true,
      addPaths,
      setWorkQueue,
      addLog,
      scanAfterAdd,
    });

    expect(addPaths).toHaveBeenCalledWith(["/a.mkv"]);
    expect(setWorkQueue).toHaveBeenCalledWith(queue);
    expect(addLog).toHaveBeenCalled();
    expect(scanAfterAdd).toHaveBeenCalledTimes(1);
  });

  it("does_not_scan_when_added_is_zero", async () => {
    const result: AddPathsResult = {
      queue: emptyQueue(),
      added: 0,
      skipped_non_video: 1,
      skipped_duplicates: 0,
    };
    const scanAfterAdd = vi.fn();
    await applyFileDrop(["/notes.txt"], {
      accept: true,
      addPaths: vi.fn().mockResolvedValue(result),
      setWorkQueue: vi.fn(),
      addLog: vi.fn(),
      scanAfterAdd,
    });
    expect(scanAfterAdd).not.toHaveBeenCalled();
  });
});
