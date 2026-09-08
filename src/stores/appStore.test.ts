import { describe, it, expect, beforeEach } from "vitest";
import {
  setWorkQueue,
  workQueue,
  setFilesProcessing,
  resetProcessingFiles,
  closeModals,
  setSelectedFileId,
  selectedFileId,
  setDetailModalOpen,
  detailModalOpen,
  setReviewModalOpen,
  reviewModalOpen,
  setConfirmDialogOpen,
  confirmDialogOpen,
  handoffToReview,
  pendingReviewRegenerateFeedback,
  setPendingReviewRegenerateFeedback,
  addGeneratingIds,
  removeGeneratingId,
  clearGeneratingIds,
  generatingIds,
  isGenerating,
  scheduledIds,
  setScheduledIds,
  isPipelineActive,
  patchFilesFromQueue,
} from "./appStore";
import { createMockFile, createMockQueue } from "../test-helpers";

describe("appStore processing helpers", () => {
  beforeEach(() => {
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("setFilesProcessing updates matching files to Processing", () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const fileB = createMockFile({ id: "b", status: "Pending", is_approved: true });
    const fileC = createMockFile({ id: "c", status: "Completed" });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB, fileC] }));

    setFilesProcessing(["a", "b"]);

    const files = workQueue().files;
    expect(files.find((f) => f.id === "a")!.status).toBe("Processing");
    expect(files.find((f) => f.id === "b")!.status).toBe("Processing");
    expect(files.find((f) => f.id === "c")!.status).toBe("Completed");
  });

  it("resetProcessingFiles resets all Processing files to Pending", () => {
    const fileA = createMockFile({ id: "a", status: "Processing" });
    const fileB = createMockFile({ id: "b", status: "Processing" });
    const fileC = createMockFile({ id: "c", status: "Completed" });
    const fileD = createMockFile({ id: "d", status: "Error" });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB, fileC, fileD] }));

    resetProcessingFiles();

    const files = workQueue().files;
    expect(files.find((f) => f.id === "a")!.status).toBe("Pending");
    expect(files.find((f) => f.id === "b")!.status).toBe("Pending");
    expect(files.find((f) => f.id === "c")!.status).toBe("Completed");
    expect(files.find((f) => f.id === "d")!.status).toBe("Error");
  });

  it("patchFilesFromQueue_updates_only_named_ids", () => {
    const a = createMockFile({ id: "a", status: "Processing", generated_command: "old-a" });
    const b = createMockFile({ id: "b", status: "Pending", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [a, b] }));
    const returned = createMockQueue([
      { ...a, status: "Pending", generated_command: "stale-a" },
      { ...b, generated_command: "new-b", command_args: "-c:v copy" },
    ]);
    patchFilesFromQueue(returned, ["b"]);
    const files = workQueue().files;
    expect(files.find((f) => f.id === "a")!.status).toBe("Processing");
    expect(files.find((f) => f.id === "a")!.generated_command).toBe("old-a");
    expect(files.find((f) => f.id === "b")!.generated_command).toBe("new-b");
  });
});

describe("appStore modal helpers", () => {
  beforeEach(() => {
    closeModals();
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("handoffToReview closes Detail, opens Review, keeps selectedFileId, leaves confirm alone", () => {
    setSelectedFileId("file-1");
    setDetailModalOpen(true);
    setReviewModalOpen(false);
    setConfirmDialogOpen(true);

    handoffToReview("file-1");

    expect(selectedFileId()).toBe("file-1");
    expect(detailModalOpen()).toBe(false);
    expect(reviewModalOpen()).toBe(true);
    expect(confirmDialogOpen()).toBe(true);
  });

  it("closeModals clears pendingReviewRegenerateFeedback", () => {
    setPendingReviewRegenerateFeedback("use hevc");
    closeModals();
    expect(pendingReviewRegenerateFeedback()).toBeNull();
  });

  it("handoffToReview does not clear pendingReviewRegenerateFeedback", () => {
    setPendingReviewRegenerateFeedback("use hevc");
    handoffToReview("file-1");
    expect(pendingReviewRegenerateFeedback()).toBe("use hevc");
  });
});

describe("generatingIds overlay", () => {
  beforeEach(() => {
    clearGeneratingIds();
  });

  it("addGeneratingIds_sets_isGenerating_without_touching_file_status", () => {
    const fileA = createMockFile({ id: "a", status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [fileA] }));
    addGeneratingIds(["a"]);
    expect(generatingIds()).toEqual(["a"]);
    expect(isGenerating()).toBe(true);
    expect(workQueue().files[0].status).toBe("Pending");
  });

  it("addGeneratingIds_dedupes", () => {
    addGeneratingIds(["a"]);
    addGeneratingIds(["a", "b"]);
    expect(generatingIds()).toEqual(["a", "b"]);
  });

  it("removeGeneratingId_clears_isGenerating_when_empty", () => {
    addGeneratingIds(["a", "b"]);
    removeGeneratingId("a");
    expect(generatingIds()).toEqual(["b"]);
    expect(isGenerating()).toBe(true);
    removeGeneratingId("b");
    expect(generatingIds()).toEqual([]);
    expect(isGenerating()).toBe(false);
  });

  it("setWorkQueue_does_not_clear_generatingIds", () => {
    addGeneratingIds(["a"]);
    setWorkQueue((q) => ({
      ...q,
      files: [createMockFile({ id: "a", status: "Pending", is_approved: true })],
    }));
    expect(generatingIds()).toEqual(["a"]);
    expect(isGenerating()).toBe(true);
  });
});

describe("scheduledIds overlay", () => {
  beforeEach(() => {
    setScheduledIds([]);
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("isPipelineActive_true_when_scheduled_even_if_all_pending", () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [fileA] }));
    setScheduledIds(["a"]);
    expect(scheduledIds()).toEqual(["a"]);
    expect(workQueue().files[0].status).toBe("Pending");
    expect(isPipelineActive()).toBe(true);
  });
});
