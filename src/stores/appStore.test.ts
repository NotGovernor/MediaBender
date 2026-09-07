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
} from "./appStore";
import { createMockFile } from "../test-helpers";

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
