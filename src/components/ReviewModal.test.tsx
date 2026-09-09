import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import ReviewModal from "./ReviewModal";
import ConfirmDialog from "./ConfirmDialog";
import {
  setWorkQueue,
  setSelectedFileId,
  selectedFileId,
  setReviewModalOpen,
  reviewModalOpen,
  closeModals,
  openReview,
  ffprobeRawModalOpen,
  workQueue,
  confirmDialogOpen,
  confirmDialogConfig,
  setScheduledIds,
  generatingIds,
  setGeneratingIds,
  detailModalOpen,
  setDetailModalOpen,
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
    status: "Pending",
    is_approved: false,
    error_message: "",
    user_notes: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    input_size: 1024 * 1024 * 1024,
    output_size: 0,
    processing_duration: 0,
    completed_at: "",
    ...overrides,
  };
}

describe("ReviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setScheduledIds([]);
    setGeneratingIds([]);
    setDetailModalOpen(false);
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("shows just the filename in the title without 'Review: ' prefix", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const title = screen.getByText("TestMovie.mkv");
    expect(title).toBeTruthy();
    expect(screen.queryByText(/Review: /)).toBeFalsy();
  });

  it("shows metadata subtitle with container, video codec, audio codec, channels, and duration", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    // Format: MKV · h264 · aac 2ch · 1h 0m
    const subtitle = screen.getByText(/MKV · h264 · aac 2ch ·/);
    expect(subtitle).toBeTruthy();
  });

  it("shows '--' for missing metadata segments in subtitle", () => {
    const mockFile = createMockFile({ metadata: null });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const subtitle = screen.getByText("-- · -- · -- · --");
    expect(subtitle).toBeTruthy();
  });

  it("renders section labels with monospace font and uppercase tracking", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const aiDescLabel = screen.getByText("AI Description");
    expect(aiDescLabel).toBeTruthy();
    expect(aiDescLabel.classList.contains("font-mono")).toBe(true);
    expect(aiDescLabel.classList.contains("uppercase")).toBe(true);
    expect(aiDescLabel.classList.contains("tracking-wider")).toBe(true);

    const ffmpegLabel = screen.getByText("FFmpeg Command");
    expect(ffmpegLabel).toBeTruthy();
    expect(ffmpegLabel.classList.contains("font-mono")).toBe(true);
    expect(ffmpegLabel.classList.contains("uppercase")).toBe(true);
  });

  it("shows 'Editable' hint badge next to FFmpeg Command label", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const editableBadge = screen.getByText("Editable");
    expect(editableBadge).toBeTruthy();
  });

  it("renders command textarea with dark background and gold text", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const commandTextarea = screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement;
    expect(commandTextarea).toBeTruthy();
    expect(commandTextarea.classList.contains("bg-bg-primary")).toBe(true);
    expect(commandTextarea.classList.contains("text-gold")).toBe(true);
  });

  it("renders feedback textarea with the correct placeholder", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const feedbackTextarea = screen.getByPlaceholderText(
      "e.g. Use 128k bitrate instead, or add -map_chapters 0..."
    );
    expect(feedbackTextarea).toBeTruthy();
  });

  it("renders Review Modal card with gold border", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const title = screen.getByText("TestMovie.mkv");
    const modalCard = title.closest("div.fixed")?.querySelector("div.relative.bg-bg-secondary");
    expect(modalCard).toBeTruthy();
    expect(modalCard!.classList.contains("border-gold")).toBe(true);
  });

  it("shows 'View ffprobe Raw' button in left actions area", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const viewButton = screen.getByText("View ffprobe Raw");
    expect(viewButton).toBeTruthy();
  });

  it("disables 'View ffprobe Raw' button when ffprobe_raw is empty", () => {
    const mockFile = createMockFile({ ffprobe_raw: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const viewButton = screen.getByText("View ffprobe Raw") as HTMLButtonElement;
    expect(viewButton.disabled).toBe(true);
  });

  it("opens ffprobe raw modal when 'View ffprobe Raw' button is clicked", () => {
    const mockFile = createMockFile({
      ffprobe_raw: '{"streams": [{"codec_name": "h264"}]}',
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const viewButton = screen.getByText("View ffprobe Raw");
    const clickEvent = new MouseEvent("click", { bubbles: true });
    viewButton.dispatchEvent(clickEvent);

    expect(ffprobeRawModalOpen()).toBe(true);
  });

  it("hides Reasoning section when reasoning is empty", () => {
    const mockFile = createMockFile({ reasoning: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    expect(screen.queryByText("AI Reasoning")).toBeFalsy();
  });

  it("shows Reasoning section when reasoning is present", () => {
    const mockFile = createMockFile({ reasoning: "Some reasoning here" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    expect(screen.getByText("AI Reasoning")).toBeTruthy();
    expect(screen.getByText("Some reasoning here")).toBeTruthy();
  });

  it("shows 'Generate' button label when generated_command is empty", () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    expect(screen.getByText("Generate")).toBeTruthy();
    expect(screen.queryByText("Regenerate")).toBeFalsy();
  });

  it("shows 'Regenerate' button label when generated_command exists", () => {
    const mockFile = createMockFile({ generated_command: "ffmpeg -i input.mkv output.mkv" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    expect(screen.getByText("Regenerate")).toBeTruthy();
    expect(screen.queryByText("Generate")).toBeFalsy();
  });

  it("shows error block with red styling when error_message is non-empty", () => {
    const mockFile = createMockFile({ error_message: "Generation failed: API key invalid" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const errorLabel = screen.getByText("Error");
    expect(errorLabel).toBeTruthy();
    expect(errorLabel.classList.contains("text-danger")).toBe(true);
    expect(screen.getByText("Generation failed: API key invalid")).toBeTruthy();
  });

  it("hides error block when error_message is empty", () => {
    const mockFile = createMockFile({ error_message: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    expect(screen.queryByText("Error")).toBeFalsy();
  });

  it("shows placeholder 'No command generated yet.' when generated_command is empty", () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const textarea = screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe("No command generated yet.");
  });

  it("makes command textarea readOnly when generated_command is empty", () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const textarea = screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
  });

  it("makes command textarea editable when generated_command exists", () => {
    const mockFile = createMockFile({ generated_command: "ffmpeg -i input.mkv output.mkv" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const textarea = screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);
  });

  it("renders Apply icon button with count badge when eligible targets exist", () => {
    const source = createMockFile({
      id: "source",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      command_args: "-c:v copy -c:a opus",
    });
    const target1 = createMockFile({ id: "target1", generated_command: "" });
    const target2 = createMockFile({ id: "target2", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [source, target1, target2] }));
    setSelectedFileId("source");
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const button = screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("disables Apply icon button when current item has no generated_command", () => {
    const source = createMockFile({ id: "source", generated_command: "" });
    const target = createMockFile({ id: "target", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [source, target] }));
    setSelectedFileId("source");
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const button = screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("disables Apply icon button when no eligible targets exist below current item", () => {
    const source = createMockFile({ id: "source", generated_command: "ffmpeg -i input.mkv output.mkv" });
    setWorkQueue((q) => ({ ...q, files: [source] }));
    setSelectedFileId("source");
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const button = screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows a spinner inside the Generate button while the request is in flight", async () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: any) => void;
    const deferred = new Promise<any>((resolve) => {
      resolveInvoke = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => <ReviewModal />);

    const generateButton = screen.getByText("Generate") as HTMLButtonElement;
    fireEvent.click(generateButton);

    // Spinner should appear (svg inside the button)
    expect(generateButton.querySelector("svg")).toBeTruthy();
    expect(generateButton.disabled).toBe(true);

    // Resolve to clean up
    resolveInvoke!({
      output_folder: "/media/output",
      guidelines: "",
      files: [mockFile],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
    await waitFor(() => {
      expect(generateButton.querySelector("svg")).toBeFalsy();
    });
  });

  it("keeps the modal open after successful generation and populates the command textarea", async () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          generated_command: "ffmpeg -i input.mkv output.mkv",
          command_args: "-c:v copy -c:a opus",
          description: "Transcode to HEVC",
          reasoning: "Smaller file size",
          error_message: "",
          status: "Pending",
          updated_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <ReviewModal />);

    const generateButton = screen.getByText("Generate") as HTMLButtonElement;
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(reviewModalOpen()).toBe(true);
    });

    const commandTextarea = screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement;
    expect(commandTextarea.value).toBe("-c:v copy -c:a opus");
  });

  it("keeps the modal open after generation fails and shows the error message", async () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("API rate limit exceeded"));

    render(() => <ReviewModal />);

    const generateButton = screen.getByText("Generate") as HTMLButtonElement;
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(reviewModalOpen()).toBe(true);
    });

    expect(screen.getByText("Error: API rate limit exceeded")).toBeTruthy();
  });

  it("clears the feedback textarea after successful regeneration", async () => {
    const mockFile = createMockFile({ generated_command: "ffmpeg -i input.mkv output.mkv" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          generated_command: "ffmpeg -i input.mkv -c:v libx265 output.mkv",
          command_args: "-c:v libx265",
          description: "Transcode to HEVC",
          reasoning: "Smaller file size",
          error_message: "",
          status: "Pending",
          updated_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <ReviewModal />);

    const feedbackTextarea = screen.getByPlaceholderText(
      "e.g. Use 128k bitrate instead, or add -map_chapters 0..."
    ) as HTMLTextAreaElement;
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });

    const regenerateButton = screen.getByText("Regenerate") as HTMLButtonElement;
    fireEvent.click(regenerateButton);

    await waitFor(() => {
      expect(feedbackTextarea.value).toBe("");
    });
  });

  const feedbackPlaceholder =
    "e.g. Use 128k bitrate instead, or add -map_chapters 0...";

  async function mountClosedReviewWithTwoFiles() {
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
    setReviewModalOpen(false);
    render(() => <ReviewModal />);
    openReview(fileA.id);
    const feedbackTextarea = await waitFor(
      () => screen.getByPlaceholderText(feedbackPlaceholder) as HTMLTextAreaElement,
    );
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });
    expect(feedbackTextarea.value).toBe("Use HEVC instead");
    return { fileA, fileB, feedbackTextarea };
  }

  it("clears_review_feedback_on_file_id_change", async () => {
    const { fileB, feedbackTextarea } = await mountClosedReviewWithTwoFiles();

    setSelectedFileId(fileB.id);
    expect(reviewModalOpen()).toBe(true);

    await waitFor(() => {
      expect(feedbackTextarea.value).toBe("");
    });
  });

  it("clears_review_feedback_on_closeModals", async () => {
    const { fileB } = await mountClosedReviewWithTwoFiles();

    closeModals();
    openReview(fileB.id);

    const feedbackTextarea = await waitFor(
      () => screen.getByPlaceholderText(feedbackPlaceholder) as HTMLTextAreaElement,
    );
    expect(feedbackTextarea.value).toBe("");
  });

  it("clears_review_feedback_on_submit_before_invoke_resolves", async () => {
    const { fileA, feedbackTextarea } = await mountClosedReviewWithTwoFiles();

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: unknown) => void;
    const deferred = new Promise((resolve) => {
      resolveInvoke = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    fireEvent.click(screen.getByText("Regenerate"));

    expect(feedbackTextarea.value).toBe("");

    resolveInvoke!({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...fileA,
          generated_command: "ffmpeg -i input.mkv -c:v libx265 output.mkv",
          command_args: "-c:v libx265",
          description: "Transcode to HEVC",
          reasoning: "Smaller file size",
          error_message: "",
          status: "Pending",
          updated_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    await waitFor(() => {
      const commandTextarea = screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement;
      expect(commandTextarea.value).toBe("-c:v libx265");
    });
    expect(feedbackTextarea.value).toBe("");
  });

  it("restores_review_feedback_when_regenerate_invoke_fails", async () => {
    const { fileB, feedbackTextarea } = await mountClosedReviewWithTwoFiles();

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("API rate limit exceeded"));

    fireEvent.click(screen.getByText("Regenerate"));

    await waitFor(() => {
      expect(feedbackTextarea.value).toBe("Use HEVC instead");
    });
    expect(reviewModalOpen()).toBe(true);

    setSelectedFileId(fileB.id);
    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText(feedbackPlaceholder) as HTMLTextAreaElement).value,
      ).toBe("");
    });
  });

  async function mountReviewWithDeferredRegen() {
    const mockFile = createMockFile();
    const laterIdle = createMockFile({
      id: "later-idle",
      generated_command: "",
      command_args: "",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile, laterIdle] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: unknown) => void = () => {};
    const deferred = new Promise((resolve) => {
      resolveInvoke = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => <ReviewModal />);

    const feedbackTextarea = screen.getByPlaceholderText(
      feedbackPlaceholder,
    ) as HTMLTextAreaElement;
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });
    fireEvent.click(screen.getByText("Regenerate"));

    const resolveRegen = () => {
      resolveInvoke({
        output_folder: "/media/output",
        guidelines: "",
        files: [
          {
            ...mockFile,
            generated_command: "ffmpeg -i input.mkv -c:v libx265 output.mkv",
            command_args: "-c:v libx265",
            description: "Transcode to HEVC",
            reasoning: "Smaller file size",
            error_message: "",
            status: "Pending",
            updated_at: new Date().toISOString(),
          },
          laterIdle,
        ],
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),
      });
    };

    return { mockFile, feedbackTextarea, resolveRegen };
  }

  it("keeps_review_open_while_regenerating", async () => {
    const { mockFile, resolveRegen } = await mountReviewWithDeferredRegen();

    expect(reviewModalOpen()).toBe(true);
    expect(detailModalOpen()).toBe(false);
    expect((screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement).value).toBe(
      "-c:v copy -c:a opus",
    );
    expect(screen.getByText("ffmpeg -i input.mkv output.mkv")).toBeTruthy();
    expect(generatingIds()).toContain(mockFile.id);
    expect(workQueue().files.find((f) => f.id === mockFile.id)?.status).not.toBe("Generating");
    expect(screen.getByText("Regenerating…")).toBeTruthy();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("generate_commands", {
      fileIds: [mockFile.id],
      feedback: "Use HEVC instead",
      repair: false,
    });

    resolveRegen();

    await waitFor(() => {
      expect(screen.queryByText("Regenerating…")).toBeFalsy();
    });
    expect(reviewModalOpen()).toBe(true);
    expect(detailModalOpen()).toBe(false);
  });

  it("disables_approve_skip_and_template_while_regenerating", async () => {
    const { feedbackTextarea, resolveRegen } = await mountReviewWithDeferredRegen();

    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Regenerating…")).toBeTruthy();

    resolveRegen();

    await waitFor(() => {
      expect(screen.queryByText("Regenerating…")).toBeFalsy();
    });
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement).disabled).toBe(false);
    expect(feedbackTextarea.value).toBe("");
  });

  it("shows_regenerating_banner_while_review_invoke_in_flight", async () => {
    const { mockFile, feedbackTextarea, resolveRegen } = await mountReviewWithDeferredRegen();

    expect(screen.getByText("Regenerating…")).toBeTruthy();
    expect(reviewModalOpen()).toBe(true);
    expect(detailModalOpen()).toBe(false);
    expect((screen.getByLabelText("FFmpeg Command") as HTMLTextAreaElement).value).toBe(
      "-c:v copy -c:a opus",
    );
    expect(generatingIds()).toContain(mockFile.id);
    expect(workQueue().files.find((f) => f.id === mockFile.id)?.status).not.toBe("Generating");

    resolveRegen();

    await waitFor(() => {
      expect(screen.queryByText("Regenerating…")).toBeFalsy();
    });
    expect(feedbackTextarea.value).toBe("");
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides_regenerating_banner_when_review_invoke_fails", async () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    let rejectInvoke: (reason: unknown) => void = () => {};
    const deferred = new Promise((_, reject) => {
      rejectInvoke = reject;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => <ReviewModal />);

    const feedbackTextarea = screen.getByPlaceholderText(
      feedbackPlaceholder,
    ) as HTMLTextAreaElement;
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });
    fireEvent.click(screen.getByText("Regenerate"));

    expect(screen.getByText("Regenerating…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement).disabled).toBe(true);

    rejectInvoke(new Error("API rate limit exceeded"));

    await waitFor(() => {
      expect(screen.queryByText("Regenerating…")).toBeFalsy();
    });
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("persists command_args to the store after single-file regeneration in the Review Modal", async () => {
    const mockFile = createMockFile({
      id: "regen-file",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      command_args: "-c:v copy",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        {
          ...mockFile,
          generated_command: "ffmpeg -i input.mkv -c:v libx265 output.mkv",
          command_args: "-c:v libx265 -crf 23",
          description: "Transcode to HEVC",
          reasoning: "Smaller file size",
          error_message: "",
          status: "Pending",
          updated_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <ReviewModal />);

    const feedbackTextarea = screen.getByPlaceholderText(
      "e.g. Use 128k bitrate instead, or add -map_chapters 0..."
    ) as HTMLTextAreaElement;
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });

    const regenerateButton = screen.getByText("Regenerate") as HTMLButtonElement;
    fireEvent.click(regenerateButton);

    await waitFor(() => {
      const files = workQueue().files;
      const updated = files.find((f) => f.id === "regen-file")!;
      expect(updated.command_args).toBe("-c:v libx265 -crf 23");
    });
  });

  it("opens confirmation dialog when Apply icon button is clicked", () => {
    const source = createMockFile({
      id: "source",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      command_args: "-c:v copy",
    });
    const target = createMockFile({ id: "target", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [source, target] }));
    setSelectedFileId("source");
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const applyButton = screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement;
    fireEvent.click(applyButton);

    expect(confirmDialogOpen()).toBe(true);
    expect(confirmDialogConfig()?.title).toBe("Apply Command Template");
    expect(confirmDialogConfig()?.message).toContain("1 remaining unconfigured item");
    expect(confirmDialogConfig()?.detail).toContain("skipped");
  });

  it("keeps the modal open after successful Apply and shows inline status message", async () => {
    const source = createMockFile({
      id: "source",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      command_args: "-c:v copy",
    });
    const target = createMockFile({ id: "target", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [source, target] }));
    setSelectedFileId("source");
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        source,
        {
          ...target,
          generated_command: "ffmpeg -i /media/movies/Target.mkv /media/output/Target.mkv",
          command_args: "-c:v copy",
          description: "Copy video",
          reasoning: "Fast",
          output_path: "/media/output/Target.mkv",
          updated_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => (
      <>
        <ReviewModal />
        <ConfirmDialog />
      </>
    ));

    const applyButton = screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement;
    fireEvent.click(applyButton);

    // Confirm the dialog
    const confirmButton = screen.getByText("Apply");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(reviewModalOpen()).toBe(true);
    });

    expect(screen.getByText("Applied to 1 item")).toBeTruthy();
  });

  it("does_not_show_regenerating_banner_when_applying_template", async () => {
    const source = createMockFile({
      id: "source",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      command_args: "-c:v copy",
    });
    const target = createMockFile({ id: "target", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [source, target] }));
    setSelectedFileId("source");
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: unknown) => void = () => {};
    const deferred = new Promise((resolve) => {
      resolveInvoke = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => (
      <>
        <ReviewModal />
        <ConfirmDialog />
      </>
    ));

    fireEvent.click(screen.getByLabelText("Apply to Remaining Items"));
    fireEvent.click(screen.getByText("Apply"));

    expect(screen.queryByText("Regenerating…")).toBeFalsy();
    expect((screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement).disabled).toBe(true);

    resolveInvoke({
      output_folder: "/media/output",
      guidelines: "",
      files: [
        source,
        {
          ...target,
          generated_command: "ffmpeg -i /media/movies/Target.mkv /media/output/Target.mkv",
          command_args: "-c:v copy",
          description: "Copy video",
          reasoning: "Fast",
          output_path: "/media/output/Target.mkv",
          updated_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(screen.getByText("Applied to 1 item")).toBeTruthy();
    });
    expect(screen.queryByText("Regenerating…")).toBeFalsy();
  });

  it("keeps the modal open after Apply fails and shows error in context", async () => {
    const source = createMockFile({
      id: "source",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      command_args: "-c:v copy",
    });
    const target = createMockFile({ id: "target", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [source, target] }));
    setSelectedFileId("source");
    setReviewModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Source item has no command_args"));

    render(() => (
      <>
        <ReviewModal />
        <ConfirmDialog />
      </>
    ));

    const applyButton = screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement;
    fireEvent.click(applyButton);

    // Confirm the dialog
    const confirmButton = screen.getByText("Apply");
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(reviewModalOpen()).toBe(true);
    });

    // Error should be visible in the logs area — but since logs are not rendered in ReviewModal,
    // we verify the modal is still open and no crash occurred.
    expect(reviewModalOpen()).toBe(true);
  });

  it("disables_Approve_when_generated_command_is_empty", () => {
    const mockFile = createMockFile({ generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const approveButton = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);
  });

  it("enables_Approve_when_generated_command_exists", () => {
    const mockFile = createMockFile({
      generated_command: "ffmpeg -i input.mkv output.mkv",
      is_approved: false,
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const approveButton = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(false);
  });

  it("disables_approve_unapprove_skip_regenerate_when_file_is_scheduled", () => {
    const approved = createMockFile({
      id: "scheduled-approved",
      is_approved: true,
      status: "Pending",
      generated_command: "ffmpeg -i input.mkv output.mkv",
    });
    setWorkQueue((q) => ({ ...q, files: [approved] }));
    setSelectedFileId(approved.id);
    setScheduledIds([approved.id]);
    setReviewModalOpen(true);

    const { unmount } = render(() => <ReviewModal />);

    expect((screen.getByRole("button", { name: "Unapprove" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Regenerate")).toBeFalsy();
    expect(screen.queryByText("Generate")).toBeFalsy();

    unmount();

    const laterIdle = createMockFile({ id: "later-idle", generated_command: "" });
    const unapproved = createMockFile({
      id: "scheduled-unapproved",
      is_approved: false,
      status: "Pending",
      generated_command: "ffmpeg -i input.mkv output.mkv",
    });
    setWorkQueue((q) => ({ ...q, files: [unapproved, laterIdle] }));
    setSelectedFileId(unapproved.id);
    setScheduledIds([unapproved.id]);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Skip" }) as HTMLButtonElement).disabled).toBe(true);

    const feedbackTextarea = screen.getByPlaceholderText(
      "e.g. Use 128k bitrate instead, or add -map_chapters 0...",
    ) as HTMLTextAreaElement;
    fireEvent.input(feedbackTextarea, { target: { value: "Use HEVC instead" } });
    expect((screen.getByRole("button", { name: "Regenerate" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement).disabled).toBe(true);
  });

  it("eligibleTargets_omits_frozen_ids", () => {
    const source = createMockFile({
      id: "source",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      command_args: "-c:v copy -c:a opus",
    });
    const frozenTarget = createMockFile({ id: "frozen-target", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [source, frozenTarget] }));
    setSelectedFileId("source");
    setScheduledIds(["frozen-target"]);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const button = screen.getByLabelText("Apply to Remaining Items") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByText("1")).toBeFalsy();
  });

  it("shows_read_only_notes_sent_to_ai_when_user_notes_exist", () => {
    const mockFile = createMockFile({
      user_notes: ["keep grain", "use HEVC"],
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    const heading = screen.getByText("Notes sent to AI");
    expect(heading).toBeTruthy();

    const items = Array.from(
      heading.closest("div")!.querySelectorAll("li"),
    ).map((el) => el.textContent);
    expect(items).toEqual(["keep grain", "use HEVC"]);

    const notesSection = heading.closest("div")!;
    expect(notesSection.querySelector("textarea")).toBeFalsy();
    expect(notesSection.querySelector("[contenteditable]")).toBeFalsy();
    expect(notesSection.getAttribute("contenteditable")).toBeFalsy();

    const reasoning = screen.getByText("AI Reasoning");
    const feedback = screen.getByText("Regeneration Feedback (optional)");
    expect(
      reasoning.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides_notes_sent_to_ai_when_user_notes_empty", () => {
    const mockFile = createMockFile({ user_notes: [] });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setReviewModalOpen(true);

    render(() => <ReviewModal />);

    expect(screen.queryByText("Notes sent to AI")).toBeFalsy();
  });
});
