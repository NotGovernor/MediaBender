import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import DetailModal from "./DetailModal";
import ReviewModal from "./ReviewModal";
import {
  setWorkQueue,
  setSelectedFileId,
  setDetailModalOpen,
  setReviewModalOpen,
  setConfirmDialogOpen,
  setPendingReviewRegenerateFeedback,
  workQueue,
  selectedFileId,
  detailModalOpen,
  reviewModalOpen,
  confirmDialogOpen,
  confirmDialogConfig,
  pendingReviewRegenerateFeedback,
  generatingIds,
  clearGeneratingIds,
} from "../stores/appStore";
import type { VideoFile } from "../types";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function createMockFile(overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    id: "test-file-1",
    input_path: "/media/movies/TestMovie.mkv",
    output_path: "/media/output/TestMovie.mkv",
    scan_root: "/media/movies",
    ffprobe_raw: "",
    metadata: {
      container: "mkv",
      video: {
        codec: "h264",
        width: 1920,
        height: 1080,
        hdr: false,
        bit_depth: 8,
        fps: 24,
      },
      audio_streams: [
        { index: 0, codec: "aac", channels: 2, layout: "stereo" },
      ],
      subtitle_streams: [],
      subtitle_count: 0,
      has_chapters: false,
      duration: 3600,
      bitrate: 5000000,
    },
    generated_command: "ffmpeg -i input.mkv output.mkv",
    command_args: "-c:v copy -c:a opus",
    description: "Test description",
    reasoning: "Test reasoning",
    status: "Completed",
    is_approved: true,
    error_message: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    input_size: 1024 * 1024 * 1024,
    output_size: 512 * 1024 * 1024,
    processing_duration: 300,
    completed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("DetailModal", () => {
  beforeEach(() => {
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
    setDetailModalOpen(false);
    setReviewModalOpen(false);
    setConfirmDialogOpen(false);
    setSelectedFileId(null);
    setPendingReviewRegenerateFeedback(null);
    clearGeneratingIds();
  });

  it("shows just the filename in the title without 'File Details' fallback", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const title = screen.getByText("TestMovie.mkv");
    expect(title).toBeTruthy();
    expect(screen.queryByText("File Details")).toBeFalsy();
  });

  it("shows metadata subtitle with container, video codec, audio codec, channels, and duration", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    // Format: MKV · h264 · aac 2ch · 1h 0m
    const subtitle = screen.getByText(/MKV · h264 · aac 2ch ·/);
    expect(subtitle).toBeTruthy();
  });

  it("shows '--' for missing metadata segments in subtitle", () => {
    const mockFile = createMockFile({ metadata: null });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const subtitle = screen.getByText("-- · -- · -- · --");
    expect(subtitle).toBeTruthy();
  });

  it("renders AI Description section with read-only content", () => {
    const mockFile = createMockFile({ description: "AI plans to transcode to HEVC" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const label = screen.getByText("AI Description");
    expect(label).toBeTruthy();
    expect(screen.getByText("AI plans to transcode to HEVC")).toBeTruthy();
  });

  it("shows 'No description available.' when description is empty", () => {
    const mockFile = createMockFile({ description: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.getByText("No description available.")).toBeTruthy();
  });

  it("renders AI Reasoning section when reasoning is present", () => {
    const mockFile = createMockFile({ reasoning: "The source is h264 so we should use HEVC" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const label = screen.getByText("AI Reasoning");
    expect(label).toBeTruthy();
    expect(screen.getByText("The source is h264 so we should use HEVC")).toBeTruthy();
  });

  it("hides AI Reasoning section when reasoning is empty", () => {
    const mockFile = createMockFile({ reasoning: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("AI Reasoning")).toBeFalsy();
  });

  it("renders command display box with dark background and gold text", () => {
    const mockFile = createMockFile({ generated_command: "ffmpeg -i input.mkv output.mkv" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const commandBox = screen.getByText("ffmpeg -i input.mkv output.mkv");
    expect(commandBox).toBeTruthy();
    expect(commandBox.classList.contains("bg-bg-primary")).toBe(true);
    expect(commandBox.classList.contains("text-gold")).toBe(true);
  });

  it("renders section labels with monospace font and uppercase tracking", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const aiDescLabel = screen.getByText("AI Description");
    expect(aiDescLabel).toBeTruthy();
    expect(aiDescLabel.classList.contains("font-mono")).toBe(true);
    expect(aiDescLabel.classList.contains("uppercase")).toBe(true);
    expect(aiDescLabel.classList.contains("tracking-wider")).toBe(true);

    const commandLabel = screen.getByText("Command Used");
    expect(commandLabel).toBeTruthy();
    expect(commandLabel.classList.contains("font-mono")).toBe(true);
    expect(commandLabel.classList.contains("uppercase")).toBe(true);
  });

  it("renders feedback label as 'Regeneration Feedback (optional)'", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const feedbackLabel = screen.getByText("Regeneration Feedback (optional)");
    expect(feedbackLabel).toBeTruthy();
  });

  it("renders fields in correct order: Status → Input/Output → Processing → AI Description → AI Reasoning → Command → Error → Feedback → Actions", () => {
    const mockFile = createMockFile({
      status: "Error",
      error_message: "Some error occurred",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    // Find the modal body by looking for the scrollable content area
    const body = document.querySelector("div.flex-1.overflow-y-auto");
    expect(body).toBeTruthy();

    const html = body!.innerHTML;

    // Find positions of key sections in the rendered HTML
    const statusPos = html.indexOf("Status");
    const inputPos = html.indexOf("Input");
    const outputPos = html.indexOf("Output");
    const aiDescPos = html.indexOf("AI Description");
    const aiReasonPos = html.indexOf("AI Reasoning");
    const processingPos = html.indexOf("Processing Details");
    const commandPos = html.indexOf("Command Used");
    const errorPos = html.indexOf("Some error occurred");
    const feedbackPos = html.indexOf("Regeneration Feedback (optional)");
    const resetPos = html.indexOf("Reset Status");

    // Verify order: each subsequent section appears after the previous
    expect(statusPos).toBeLessThan(inputPos);
    expect(outputPos).toBeLessThan(processingPos);
    expect(processingPos).toBeLessThan(aiDescPos);
    expect(aiDescPos).toBeLessThan(aiReasonPos);
    expect(aiReasonPos).toBeLessThan(commandPos);
    expect(commandPos).toBeLessThan(errorPos);
    expect(errorPos).toBeLessThan(feedbackPos);
    expect(feedbackPos).toBeLessThan(resetPos);
  });

  it("hides Processing Details when status is Pending", () => {
    const mockFile = createMockFile({ status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("Processing Details")).toBeFalsy();
  });

  it("hides Error section when error_message is empty", () => {
    const mockFile = createMockFile({ error_message: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("Error")).toBeFalsy();
  });

  it("hides Command Used section when generated_command is empty", () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("Command Used")).toBeFalsy();
  });

  it("opens Review and keeps the file selected after Reset Status succeeds", async () => {
    const mockFile = createMockFile({ status: "Completed", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          status: "Pending",
          is_approved: false,
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reset Status"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("reset_file", { fileId: mockFile.id });
      expect(detailModalOpen()).toBe(false);
      expect(reviewModalOpen()).toBe(true);
      expect(selectedFileId()).toBe(mockFile.id);
    });
  });

  it("stays on Detail when Reset Status fails", async () => {
    const mockFile = createMockFile({ status: "Error" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("reset failed"));

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reset Status"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("reset_file", { fileId: mockFile.id });
    });

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
  });

  it("disables Regenerate Command button when feedback is empty", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const regenerateButton = screen.getByText("Regenerate Command") as HTMLButtonElement;
    expect(regenerateButton).toBeTruthy();
    expect(regenerateButton.disabled).toBe(true);
  });

  it("shows Reprocess File button when output_path is non-empty", () => {
    const mockFile = createMockFile({ output_path: "/media/output/TestMovie.mkv" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.getByText("Reprocess File")).toBeTruthy();
  });

  it("hides Reprocess File button when output_path is empty", () => {
    const mockFile = createMockFile({ output_path: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("Reprocess File")).toBeFalsy();
  });

  it("opens delete confirm on top of Detail when Reprocess File is clicked", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reprocess File"));

    expect(confirmDialogOpen()).toBe(true);
    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
    expect(confirmDialogConfig()?.title).toBe("Delete Output File?");
    expect(confirmDialogConfig()?.message).toMatch(/command review/i);
    expect(confirmDialogConfig()?.message).not.toMatch(/re-queued for processing/i);
  });

  it("hands off to Review after Reprocess confirm deletes and resets", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          status: "Pending",
          is_approved: false,
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reprocess File"));
    await confirmDialogConfig()!.onConfirm();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_output_file", {
        outputPath: mockFile.output_path,
      });
      expect(invoke).toHaveBeenCalledWith("reset_file", { fileId: mockFile.id });
      expect(reviewModalOpen()).toBe(true);
      expect(detailModalOpen()).toBe(false);
      expect(selectedFileId()).toBe(mockFile.id);
    });
  });

  it("does not reset or hand off when delete_output_file fails", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("delete failed"));

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reprocess File"));
    await confirmDialogConfig()!.onConfirm();

    expect(invoke).not.toHaveBeenCalledWith("reset_file", { fileId: mockFile.id });
    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
  });


  it("hands off to Review with pending feedback when Regenerate Command is clicked", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();

    render(() => <DetailModal />);

    const textarea = screen.getByPlaceholderText(
      "e.g. Use 128k bitrate instead, or add -map_chapters 0..."
    ) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "Use HEVC instead" } });
    fireEvent.click(screen.getByText("Regenerate Command"));

    expect(detailModalOpen()).toBe(false);
    expect(reviewModalOpen()).toBe(true);
    expect(selectedFileId()).toBe(mockFile.id);
    expect(pendingReviewRegenerateFeedback()).toBe("Use HEVC instead");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("Review generate runs after Detail Regenerate Command handoff", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          output_path: "/media/output/Regenerated.mkv",
          is_approved: false,
          status: "Pending",
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => (
      <>
        <DetailModal />
        <ReviewModal />
      </>
    ));

    const textarea = screen.getByPlaceholderText(
      "e.g. Use 128k bitrate instead, or add -map_chapters 0..."
    ) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "Use HEVC instead" } });
    fireEvent.click(screen.getByText("Regenerate Command"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("generate_commands", {
        fileIds: [mockFile.id],
        feedback: "Use HEVC instead",
      });
    });

    const updated = workQueue().files.find((f) => f.id === mockFile.id)!;
    expect(updated.output_path).toBe("/media/output/Regenerated.mkv");
    expect(updated.is_approved).toBe(false);
    expect(updated.status).toBe("Pending");
    expect(reviewModalOpen()).toBe(true);
    expect(detailModalOpen()).toBe(false);
  });

  it("regenerate_adds_overlay_id_without_setting_file_status_Generating", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: any) => void;
    const deferred = new Promise<any>((resolve) => {
      resolveInvoke = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => (
      <>
        <DetailModal />
        <ReviewModal />
      </>
    ));

    const textarea = screen.getByPlaceholderText(
      "e.g. Use 128k bitrate instead, or add -map_chapters 0..."
    ) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "Use HEVC instead" } });
    fireEvent.click(screen.getByText("Regenerate Command"));

    expect(workQueue().files.find((f) => f.id === mockFile.id)!.status).not.toBe("Generating");
    expect(generatingIds()).toContain(mockFile.id);

    resolveInvoke!({
      output_folder: "/media/output",
      guidelines: "",
      files: [mockFile],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("pending_approved_shows_single_Approved_badge_without_chip", () => {
    const mockFile = createMockFile({
      status: "Pending",
      is_approved: true,
      output_size: 0,
      processing_duration: 0,
      completed_at: "",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.getAllByText("Approved")).toHaveLength(1);
    expect(screen.queryByText("Pending")).toBeFalsy();
  });

  it("completed_approved_shows_Completed_not_Approved", () => {
    const mockFile = createMockFile({ status: "Completed", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Approved")).toBeFalsy();
  });
});
