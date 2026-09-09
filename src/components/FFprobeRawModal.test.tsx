import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import FFprobeRawModal from "./FFprobeRawModal";
import {
  setWorkQueue,
  setSelectedFileId,
  setFfprobeRawModalOpen,
} from "../stores/appStore";
import type { VideoFile } from "../types";

function createMockFile(overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    id: "test-file-1",
    input_path: "/media/movies/TestMovie.mkv",
    output_path: "/media/output/TestMovie.mkv",
    scan_root: "/media/movies",
    ffprobe_raw: '{"streams": [{"codec_name": "h264"}]}',
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

describe("FFprobeRawModal", () => {
  beforeEach(() => {
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
    setFfprobeRawModalOpen(false);
  });

  it("renders with title including filename when open", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setFfprobeRawModalOpen(true);

    render(() => <FFprobeRawModal />);

    expect(screen.getByText("ffprobe Raw: TestMovie.mkv")).toBeTruthy();
  });

  it("displays raw ffprobe JSON in a scrollable dark monospace block", () => {
    const mockFile = createMockFile({
      ffprobe_raw: '{"streams": [{"codec_name": "h264"}]}',
    });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setFfprobeRawModalOpen(true);

    render(() => <FFprobeRawModal />);

    const pre = screen.getByText(/"streams"/);
    expect(pre).toBeTruthy();
    expect(pre.tagName.toLowerCase()).toBe("pre");
    expect(pre.classList.contains("bg-bg-primary")).toBe(true);
    expect(pre.classList.contains("text-gold")).toBe(true);
    expect(pre.classList.contains("font-mono")).toBe(true);
    expect(pre.classList.contains("overflow-auto")).toBe(true);
  });

  it("shows fallback message when ffprobe_raw is empty", () => {
    const mockFile = createMockFile({ ffprobe_raw: "" });
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setFfprobeRawModalOpen(true);

    render(() => <FFprobeRawModal />);

    expect(
      screen.getByText("No ffprobe raw data available for this file.")
    ).toBeTruthy();
  });

  it("closes when close button is clicked", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setFfprobeRawModalOpen(true);

    render(() => <FFprobeRawModal />);

    const closeButton = screen.getByLabelText("Close");
    fireEvent.click(closeButton);

    // After closing, the modal content should not be rendered
    expect(screen.queryByText("ffprobe Raw: TestMovie.mkv")).toBeFalsy();
  });

  it("closes when backdrop is clicked", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setFfprobeRawModalOpen(true);

    render(() => <FFprobeRawModal />);

    const closeButton = screen.getByLabelText("Close");
    const backdrop = closeButton.closest("div.fixed")?.querySelector("div.absolute.inset-0");
    expect(backdrop).toBeTruthy();

    fireEvent.click(backdrop!);

    expect(screen.queryByText("ffprobe Raw: TestMovie.mkv")).toBeFalsy();
  });

  it("stacks above Review Modal with higher z-index", () => {
    const mockFile = createMockFile();
    setWorkQueue((q) => ({ ...q, files: [mockFile] }));
    setSelectedFileId(mockFile.id);
    setFfprobeRawModalOpen(true);

    render(() => <FFprobeRawModal />);

    const title = screen.getByText("ffprobe Raw: TestMovie.mkv");
    const modalContainer = title.closest("div.fixed");
    expect(modalContainer).toBeTruthy();
    expect(modalContainer!.classList.contains("z-[60]")).toBe(true);
  });
});
