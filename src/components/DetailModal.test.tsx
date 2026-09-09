import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import DetailModal from "./DetailModal";
import {
  setWorkQueue,
  setSelectedFileId,
  setDetailModalOpen,
  setReviewModalOpen,
  setConfirmDialogOpen,
  setSettings,
  setScheduledIds,
  setPreflightModalOpen,
  closeModals,
  workQueue,
  selectedFileId,
  logEntries,
  clearLogs,
  detailModalOpen,
  reviewModalOpen,
  confirmDialogOpen,
  confirmDialogConfig,
  generatingIds,
  clearGeneratingIds,
  scheduledIds,
  preflightModalOpen,
} from "../stores/appStore";
import type { VideoFile, WorkQueue } from "../types";
import { invoke } from "@tauri-apps/api/core";

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
    user_notes: [],
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
    clearGeneratingIds();
    clearLogs();
    setScheduledIds([]);
    setPreflightModalOpen(false);
    vi.mocked(invoke).mockReset();
    setSettings({
      providers: [
        { base_url: "http://localhost", api_key: "key", model: "model" },
      ],
      active_provider_index: 0,
      ffmpeg_path: "/usr/bin/ffmpeg",
      ffprobe_path: "/usr/bin/ffprobe",
      default_output_folder: "/media/output",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
      flatten_output_folders: false,
    });
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

  function pendingApprovedQueue(file: VideoFile): WorkQueue {
    return {
      output_folder: "/media/output",
      guidelines: "",
      files: [{ ...file, status: "Pending", is_approved: true }],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    };
  }

  it("hides_Reprocess_when_status_skipped", () => {
    const mockFile = createMockFile({ status: "Skipped" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("Reprocess File")).toBeFalsy();
  });

  it("hides_Reprocess_when_command_args_empty", () => {
    const mockFile = createMockFile({ status: "Completed", command_args: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("Reprocess File")).toBeFalsy();
  });

  it("hides_Reprocess_when_status_pending", () => {
    const mockFile = createMockFile({ status: "Pending" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByText("Reprocess File")).toBeFalsy();
  });

  it("shows_Reprocess_for_error_with_command", () => {
    const mockFile = createMockFile({
      status: "Error",
      command_args: "-c:v copy -c:a opus",
      output_path: "",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.getByText("Reprocess File")).toBeTruthy();
  });

  it("shows_Reprocess_for_completed_with_command", () => {
    const mockFile = createMockFile({
      status: "Completed",
      command_args: "-c:v copy -c:a opus",
      output_path: "",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.getByText("Reprocess File")).toBeTruthy();
  });

  it("reprocess_skips_confirm_when_output_missing", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "output_file_exists") return false;
      if (cmd === "reprocess_file") return pendingApprovedQueue(mockFile);
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reprocess File"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("reprocess_file", {
        fileId: mockFile.id,
        ffmpegPath: "/usr/bin/ffmpeg",
      });
    });

    expect(confirmDialogOpen()).toBe(false);
    expect(detailModalOpen()).toBe(false);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(null);
    expect(invoke).not.toHaveBeenCalledWith("delete_output_file", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("reset_file", expect.anything());
  });

  it("reprocess_confirms_overwrite_when_output_exists", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "output_file_exists") return true;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reprocess File"));

    await waitFor(() => {
      expect(confirmDialogOpen()).toBe(true);
    });

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
    expect(confirmDialogConfig()?.title).toBe("Overwrite Output File?");
    expect(confirmDialogConfig()?.message).toMatch(/overwritten/i);
    expect(confirmDialogConfig()?.message).not.toMatch(/command review/i);
    expect(confirmDialogConfig()?.detail).toBe(mockFile.output_path);
    expect(confirmDialogConfig()?.confirmText).toBe("Overwrite & Reprocess");
    expect(confirmDialogConfig()?.confirmVariant).toBe("danger");
    expect(invoke).not.toHaveBeenCalledWith("reprocess_file", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("delete_output_file", expect.anything());
  });

  it("reprocess_invokes_reprocess_file_and_closes_to_queue", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "output_file_exists") return true;
      if (cmd === "reprocess_file") return pendingApprovedQueue(mockFile);
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reprocess File"));

    await waitFor(() => {
      expect(confirmDialogOpen()).toBe(true);
    });

    await confirmDialogConfig()!.onConfirm();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("reprocess_file", {
        fileId: mockFile.id,
        ffmpegPath: "/usr/bin/ffmpeg",
      });
    });

    expect(invoke).not.toHaveBeenCalledWith("delete_output_file", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("reset_file", expect.anything());
    expect(detailModalOpen()).toBe(false);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(null);
    expect(scheduledIds()).toContain(mockFile.id);
  });

  it("reprocess_opens_preflight_when_ffmpeg_path_empty", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);
    setSettings((s) => ({ ...s, ffmpeg_path: "" }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();

    render(() => <DetailModal />);

    fireEvent.click(screen.getByText("Reprocess File"));

    await waitFor(() => {
      expect(preflightModalOpen()).toBe(true);
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(confirmDialogOpen()).toBe(false);
    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
  });

  it("reset_status_still_handoffs_to_review", async () => {
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

  const feedbackPlaceholder =
    "e.g. Use 128k bitrate instead, or add -map_chapters 0...";

  async function mountDetailWithDeferredRegen() {
    const mockFile = createMockFile({
      error_message: "Previous encode failed",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: unknown) => void = () => {};
    let rejectInvoke: (reason: unknown) => void = () => {};
    const deferred = new Promise((resolve, reject) => {
      resolveInvoke = resolve;
      rejectInvoke = reject;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => <DetailModal />);

    const feedbackTextarea = screen.getByPlaceholderText(
      feedbackPlaceholder,
    ) as HTMLTextAreaElement;
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });
    fireEvent.click(screen.getByText("Regenerate Command"));

    return { mockFile, feedbackTextarea, resolveInvoke, rejectInvoke };
  }

  it("detail_regenerate_stays_on_detail_and_invokes_generate_commands", async () => {
    const { mockFile } = await mountDetailWithDeferredRegen();
    const { invoke } = await import("@tauri-apps/api/core");

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("generate_commands", {
        fileIds: [mockFile.id],
        feedback: "Use HEVC instead",
        repair: false,
      });
    });

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
  });

  it("detail_regenerate_shows_banner_and_spinner_while_in_flight", async () => {
    const { mockFile, feedbackTextarea, resolveInvoke } =
      await mountDetailWithDeferredRegen();

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(screen.getByText("Regenerating\u2026")).toBeTruthy();
    const regenButton = screen.getByText("Regenerate Command").closest("button") as HTMLButtonElement;
    expect(regenButton.disabled).toBe(true);
    expect(regenButton.querySelector("svg.animate-spin")).toBeTruthy();
    expect((screen.getByText("Reset Status") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Reprocess File") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("ffmpeg -i input.mkv output.mkv")).toBeTruthy();
    expect(screen.getByText("Previous encode failed")).toBeTruthy();
    expect(feedbackTextarea.value).toBe("");
    expect(generatingIds()).toContain(mockFile.id);

    resolveInvoke({
      output_folder: "/media/output",
      guidelines: "",
      files: [mockFile],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("regenerate_adds_overlay_id_without_setting_file_status_Generating", async () => {
    const { mockFile, resolveInvoke } = await mountDetailWithDeferredRegen();

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(generatingIds()).toContain(mockFile.id);
    expect(workQueue().files.find((f) => f.id === mockFile.id)!.status).not.toBe("Generating");
    expect(screen.getByText("Generating")).toBeTruthy();

    resolveInvoke({
      output_folder: "/media/output",
      guidelines: "",
      files: [mockFile],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("clears_detail_feedback_on_submit_before_invoke_resolves", async () => {
    const { feedbackTextarea, resolveInvoke } = await mountDetailWithDeferredRegen();

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(feedbackTextarea.value).toBe("");

    resolveInvoke({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("restores_detail_feedback_when_regenerate_invoke_fails", async () => {
    const { mockFile, feedbackTextarea, rejectInvoke } =
      await mountDetailWithDeferredRegen();

    expect(detailModalOpen()).toBe(true);
    expect(screen.getByText("Regenerating\u2026")).toBeTruthy();

    rejectInvoke(new Error("API rate limit exceeded"));

    await waitFor(() => {
      expect(feedbackTextarea.value).toBe("Use HEVC instead");
    });
    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(generatingIds()).not.toContain(mockFile.id);
    expect(screen.queryByText("Regenerating\u2026")).toBeFalsy();
  });

  it("detail_regenerate_handoffs_to_review_on_success", async () => {
    const { mockFile, resolveInvoke } = await mountDetailWithDeferredRegen();

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);

    resolveInvoke({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          status: "Pending",
          is_approved: false,
          error_message: "",
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(reviewModalOpen()).toBe(true);
    });
    expect(detailModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
    const updated = workQueue().files.find((f) => f.id === mockFile.id)!;
    expect(updated.is_approved).toBe(false);
    expect(updated.status).toBe("Pending");
    expect(generatingIds()).not.toContain(mockFile.id);
  });

  it("detail_regenerate_success_does_not_throw_if_selection_changes", async () => {
    const { mockFile, resolveInvoke } = await mountDetailWithDeferredRegen();

    closeModals();
    expect(selectedFileId()).toBe(null);
    expect(detailModalOpen()).toBe(false);

    const patched = { ...mockFile, description: "Updated after regen" };
    resolveInvoke({
      output_folder: "/media/output",
      guidelines: "",
      files: [patched],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(generatingIds()).not.toContain(mockFile.id);
    });

    expect(workQueue().files.find((f) => f.id === mockFile.id)?.description).toBe(
      "Updated after regen",
    );
    expect(logEntries().some((e) => e.message.includes("Regeneration failed"))).toBe(
      false,
    );
    expect(
      logEntries().some(
        (e) =>
          e.level === "info" &&
          e.file_id === mockFile.id &&
          e.message.includes("Regeneration complete for: TestMovie.mkv"),
      ),
    ).toBe(true);

    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);
    const feedbackTextarea = await waitFor(
      () => screen.getByPlaceholderText(feedbackPlaceholder) as HTMLTextAreaElement,
    );
    expect(feedbackTextarea.value).toBe("");
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

  async function mountClosedDetailWithTwoFiles() {
    const fileA = createMockFile({
      id: "file-a",
      input_path: "/media/movies/FileA.mkv",
    });
    const fileB = createMockFile({
      id: "file-b",
      input_path: "/media/movies/FileB.mkv",
    });
    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));
    setSelectedFileId(null);
    setDetailModalOpen(false);
    render(() => <DetailModal />);
    setSelectedFileId(fileA.id);
    setDetailModalOpen(true);
    const feedbackTextarea = await waitFor(
      () => screen.getByPlaceholderText(feedbackPlaceholder) as HTMLTextAreaElement,
    );
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });
    expect(feedbackTextarea.value).toBe("Use HEVC instead");
    return { fileA, fileB, feedbackTextarea };
  }

  it("clears_detail_feedback_on_file_id_change", async () => {
    const { fileB, feedbackTextarea } = await mountClosedDetailWithTwoFiles();

    setSelectedFileId(fileB.id);
    expect(detailModalOpen()).toBe(true);

    await waitFor(() => {
      expect(feedbackTextarea.value).toBe("");
    });
  });

  it("clears_detail_feedback_on_closeModals", async () => {
    const { fileB } = await mountClosedDetailWithTwoFiles();

    closeModals();
    setSelectedFileId(fileB.id);
    setDetailModalOpen(true);

    const feedbackTextarea = await waitFor(
      () => screen.getByPlaceholderText(feedbackPlaceholder) as HTMLTextAreaElement,
    );
    expect(feedbackTextarea.value).toBe("");
  });

  it("shows_ask_ai_to_fix_when_status_is_Error", () => {
    const mockFile = createMockFile({ status: "Error", error_message: "NVENC session limit" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const ask = screen.getByRole("button", { name: "Ask AI to fix" });
    const errorBox = screen.getByText("Error", { selector: "label" }).closest("div");
    expect(errorBox).toBeTruthy();
    expect(errorBox!.contains(ask)).toBe(true);
    expect(screen.getByText("Reset Status").closest("div")!.contains(ask)).toBe(false);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeFalsy();
    const body = errorBox!.querySelector("p");
    expect(body?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["whitespace-pre-wrap", "overflow-y-auto", "max-h-32"]),
    );
  });

  it("hides_ask_ai_to_fix_when_status_is_not_Error", () => {
    for (const status of ["Completed", "Pending", "Processing"] as const) {
      const mockFile = createMockFile({ id: `file-${status}`, status });
      setWorkQueue((q) => ({ ...q, files: [mockFile] }));
      setSelectedFileId(mockFile.id);
      setDetailModalOpen(true);

      const { unmount } = render(() => <DetailModal />);

      expect(screen.queryByRole("button", { name: "Ask AI to fix" })).toBeFalsy();
      unmount();
    }
  });

  it("ask_ai_to_fix_invokes_generate_commands_with_repair_true_without_feedback", async () => {
    const mockFile = createMockFile({ status: "Error", error_message: "NVENC session limit" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [mockFile],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <DetailModal />);

    const feedbackTextarea = screen.getByPlaceholderText(
      feedbackPlaceholder,
    ) as HTMLTextAreaElement;
    expect(feedbackTextarea.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Ask AI to fix" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("generate_commands", {
        fileIds: [mockFile.id],
        feedback: null,
        repair: true,
      });
    });
  });

  it("ask_ai_to_fix_stays_on_detail_while_in_flight_then_handoffs_review_on_success", async () => {
    const mockFile = createMockFile({
      status: "Error",
      error_message: "Previous encode failed",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: unknown) => void = () => {};
    const deferred = new Promise((resolve) => {
      resolveInvoke = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => <DetailModal />);

    fireEvent.click(screen.getByRole("button", { name: "Ask AI to fix" }));

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
    expect(screen.getByText("Regenerating\u2026")).toBeTruthy();
    expect(generatingIds()).toContain(mockFile.id);
    expect(screen.getByText("Generating")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Ask AI to fix" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByText("Regenerate Command").closest("button") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByText("Reset Status") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Reprocess File") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeFalsy();

    resolveInvoke({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          status: "Pending",
          is_approved: false,
          error_message: "",
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(reviewModalOpen()).toBe(true);
    });
    expect(detailModalOpen()).toBe(false);
    expect(selectedFileId()).toBe(mockFile.id);
    const updated = workQueue().files.find((f) => f.id === mockFile.id)!;
    expect(updated.is_approved).toBe(false);
    expect(updated.status).toBe("Pending");
    expect(generatingIds()).not.toContain(mockFile.id);
  });

  it("hides_ask_ai_to_fix_when_error_message_empty", () => {
    const mockFile = createMockFile({ status: "Error", error_message: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    expect(screen.queryByRole("button", { name: "Ask AI to fix" })).toBeFalsy();
    expect(screen.getByText("Reset Status")).toBeTruthy();
  });

  it("error_box_preserves_multiline_error_message", () => {
    const mockFile = createMockFile({
      status: "Error",
      error_message: "context line 4\nError initializing output stream",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setDetailModalOpen(true);

    render(() => <DetailModal />);

    const body = screen.getByText(/context line 4/);
    expect(body.textContent).toContain("Error initializing output stream");
    expect(body.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["whitespace-pre-wrap", "overflow-y-auto", "max-h-32"]),
    );
  });
});
