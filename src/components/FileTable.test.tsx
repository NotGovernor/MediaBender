import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import FileTable from "./FileTable";
import {
  setWorkQueue,
  setReviewModalOpen,
  setDetailModalOpen,
  setSelectedFileId,
  setFileDropHovering,
  reviewModalOpen,
  detailModalOpen,
  workQueue,
  addGeneratingIds,
  clearGeneratingIds,
  setScheduledIds,
} from "../stores/appStore";
import type { VideoFile } from "../types";

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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    input_size: 1024 * 1024 * 1024,
    output_size: 0,
    processing_duration: 0,
    completed_at: "",
    ...overrides,
  };
}

describe("FileTable", () => {
  beforeEach(() => {
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
    setReviewModalOpen(false);
    setDetailModalOpen(false);
    setSelectedFileId(null);
    setFileDropHovering(false);
    clearGeneratingIds();
    setScheduledIds([]);
  });

  it("empty_state_mentions_drop_files_or_folders", () => {
    render(() => <FileTable />);
    expect(screen.getByText("No files in queue")).toBeTruthy();
    expect(
      screen.getByText("Drop files or folders, or click Add Files")
    ).toBeTruthy();
  });

  it("shows_drop_overlay_when_file_drop_hovering", () => {
    setFileDropHovering(true);
    render(() => <FileTable />);
    expect(screen.getByTestId("file-drop-overlay")).toBeTruthy();
    expect(screen.getByText("Drop videos or folders")).toBeTruthy();
  });

  it("hides_drop_overlay_when_not_hovering", () => {
    setFileDropHovering(false);
    render(() => <FileTable />);
    expect(screen.queryByTestId("file-drop-overlay")).toBeFalsy();
  });

  it("opens ReviewModal when clicking an Error item with no generated_command", () => {
    const mockFile = createMockFile({
      status: "Error",
      generated_command: "",
      error_message: "Generation failed",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));

    render(() => <FileTable />);

    const row = screen.getByText("TestMovie.mkv").closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(reviewModalOpen()).toBe(true);
    expect(detailModalOpen()).toBe(false);
  });

  it("opens DetailModal when clicking an Error item with a generated_command", () => {
    const mockFile = createMockFile({
      status: "Error",
      generated_command: "ffmpeg -i input.mkv output.mkv",
      error_message: "Processing failed",
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));

    render(() => <FileTable />);

    const row = screen.getByText("TestMovie.mkv").closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(detailModalOpen()).toBe(true);
    expect(reviewModalOpen()).toBe(false);
  });

  it("removes a file via remove_file IPC and updates the queue", async () => {
    const mockFile = createMockFile({ id: "test-file-1" });
    const other = createMockFile({ id: "test-file-2", input_path: "/media/movies/Other.mkv" });
    setWorkQueue((q) => ({ ...q, files: [mockFile, other] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [other],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <FileTable />);

    const row = screen.getByText("TestMovie.mkv").closest("tr");
    fireEvent.click(row!.querySelector("button")!);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("remove_file", { fileId: "test-file-1" });
      expect(workQueue().files.map((f) => f.id)).toEqual(["test-file-2"]);
    });
  });

  it("closes detail when the removed file is selected", async () => {
    const mockFile = createMockFile({ id: "test-file-1" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId("test-file-1");
    setDetailModalOpen(true);

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });

    render(() => <FileTable />);

    fireEvent.click(screen.getByTitle("Remove from queue"));

    await waitFor(() => {
      expect(detailModalOpen()).toBe(false);
      expect(workQueue().files).toHaveLength(0);
    });
  });

  it("shows_Approved_badge_and_start_eligible_bar_only_on_approved_pending_rows", () => {
    const pending = createMockFile({
      id: "p",
      input_path: "/media/movies/PendingMovie.mkv",
      is_approved: false,
      status: "Pending",
    });
    const ready = createMockFile({
      id: "r",
      input_path: "/media/movies/ReadyMovie.mkv",
      is_approved: true,
      status: "Pending",
    });
    const done = createMockFile({
      id: "c",
      input_path: "/media/movies/DoneMovie.mkv",
      is_approved: true,
      status: "Completed",
    });
    setWorkQueue((q) => ({ ...q, files: [pending, ready, done] }));

    render(() => <FileTable />);

    expect(screen.getByText("Pending")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();

    const pendingRow = screen.getByText("PendingMovie.mkv").closest("tr")!;
    const readyRow = screen.getByText("ReadyMovie.mkv").closest("tr")!;
    const doneRow = screen.getByText("DoneMovie.mkv").closest("tr")!;

    expect(pendingRow.getAttribute("data-start-eligible")).toBe("false");
    expect(readyRow.getAttribute("data-start-eligible")).toBe("true");
    expect(doneRow.getAttribute("data-start-eligible")).toBe("false");

    expect(readyRow.className).toContain("border-l-gold");
    expect(pendingRow.className).toContain("border-l-transparent");
    expect(doneRow.className).toContain("border-l-transparent");
    expect(pendingRow.className).not.toContain("border-l-gold");
    expect(doneRow.className).not.toContain("border-l-gold");
  });

  it("shows_Generating_badge_from_overlay_while_file_status_stays_Pending", () => {
    const pending = createMockFile({
      id: "a",
      input_path: "/media/movies/PendingMovie.mkv",
      status: "Pending",
      is_approved: false,
    });
    setWorkQueue((q) => ({ ...q, files: [pending] }));
    addGeneratingIds(["a"]);

    render(() => <FileTable />);

    expect(screen.getByText("Generating")).toBeTruthy();
    expect(screen.queryByText("Pending")).toBeFalsy();
    expect(workQueue().files[0].status).toBe("Pending");
  });

  it("disables_remove_when_row_is_scheduled_or_Processing", () => {
    const live = createMockFile({ id: "live", status: "Processing" });
    const wait = createMockFile({ id: "wait", status: "Pending", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [live, wait] }));
    setScheduledIds(["wait"]);
    render(() => <FileTable />);
    const buttons = screen.getAllByTitle("Remove from queue") as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  it("remove_control_is_outline_trash_svg_not_emoji", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    render(() => <FileTable />);

    const btn = screen.getByTitle("Remove from queue");
    const svg = btn.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute("stroke")).toBe("currentColor");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
    expect(svg!.classList.contains("w-4")).toBe(true);
    expect(svg!.classList.contains("h-4")).toBe(true);
    expect(svg!.querySelector("path")).toBeTruthy();
    expect(svg!.querySelector("path")!.getAttribute("d")).toBe(
      "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
    );
    expect(btn.textContent).not.toContain("🗑");
  });

  it("remove_control_has_hit_target_hover_focus_and_frozen_classes", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    render(() => <FileTable />);

    const classes = screen.getByTitle("Remove from queue").className.split(/\s+/);
    for (const token of [
      "p-1",
      "text-text-muted",
      "hover:text-danger",
      "opacity-0",
      "group-hover:opacity-100",
      "focus-visible:opacity-100",
      "disabled:cursor-not-allowed",
      "disabled:hover:text-text-muted",
      "disabled:group-hover:opacity-30",
      "disabled:focus-visible:opacity-30",
    ]) {
      expect(classes).toContain(token);
    }
    expect(classes).not.toContain("disabled:opacity-30");
  });
});
