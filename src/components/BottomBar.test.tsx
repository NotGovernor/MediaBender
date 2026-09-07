import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import BottomBar from "./BottomBar";
import {
  setWorkQueue,
  setSettings,
  addGeneratingIds,
  clearGeneratingIds,
} from "../stores/appStore";
import { createMockFile, createMockQueue } from "../test-helpers";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

function buttonLabels(): string[] {
  return screen.getAllByRole("button").map((el) =>
    (el.getAttribute("aria-label") || el.textContent || "").trim()
  );
}

describe("BottomBar", () => {
  beforeEach(() => {
    clearGeneratingIds();
    setWorkQueue(createMockQueue());
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
    });
  });

  it("renders_Select_then_Output_then_Clear_Queue_then_Add_Files", () => {
    render(() => <BottomBar />);

    expect(buttonLabels()).toEqual([
      "Select...",
      "Clear Queue",
      "+ Add Files",
      "More add options",
    ]);

    const select = screen.getByRole("button", { name: "Select..." });
    const outputLabel = screen.getByText("Output:");
    const path = screen.getByText("/media/output");
    expect(select.compareDocumentPosition(outputLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    expect(outputLabel.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
  });

  it("disables_Clear_Queue_when_queue_is_empty", () => {
    render(() => <BottomBar />);
    const clear = screen.getByRole("button", { name: "Clear Queue" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it("disables_Clear_Queue_when_processing", () => {
    setWorkQueue(
      createMockQueue([createMockFile({ id: "a", status: "Processing" })])
    );
    render(() => <BottomBar />);
    const clear = screen.getByRole("button", { name: "Clear Queue" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it("disables_Clear_Queue_when_generating", () => {
    setWorkQueue(createMockQueue([createMockFile({ id: "a", status: "Pending" })]));
    addGeneratingIds(["a"]);
    render(() => <BottomBar />);
    const clear = screen.getByRole("button", { name: "Clear Queue" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it("enables_Clear_Queue_when_queue_has_idle_files", () => {
    setWorkQueue(createMockQueue([createMockFile({ id: "a", status: "Pending" })]));
    render(() => <BottomBar />);
    const clear = screen.getByRole("button", { name: "Clear Queue" }) as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
  });
});
