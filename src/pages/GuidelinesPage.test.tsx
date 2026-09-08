import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import GuidelinesPage from "./GuidelinesPage";
import {
  setWorkQueue,
  setSettings,
  setLogEntries,
  logEntries,
} from "../stores/appStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ type: "message", content: "Hi" }),
}));

describe("GuidelinesPage help sidebar", () => {
  beforeEach(() => {
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
  });

  it("displays a note about fixed output-format rules", () => {
    render(() => <GuidelinesPage />);

    expect(
      screen.getByText(/fixed output-format instructions/i)
    ).toBeDefined();
    expect(
      screen.getByText(/appended to the system prompt automatically/i)
    ).toBeDefined();
    expect(
      screen.getByText(/not shown here and cannot be edited/i)
    ).toBeDefined();
  });
});

describe("GuidelinesPage interview entry", () => {
  beforeEach(() => {
    setLogEntries([]);
    setWorkQueue({
      output_folder: "/media/output",
      guidelines: "existing",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
    setSettings({
      providers: [],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
      flatten_output_folders: false,
    });
  });

  it("renders_generate_with_ai_interview_button", () => {
    render(() => <GuidelinesPage />);

    expect(
      screen.getByRole("button", { name: "Generate with AI Interview" })
    ).toBeDefined();
  });

  it("does_not_open_modal_without_provider_and_logs_error", () => {
    render(() => <GuidelinesPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Generate with AI Interview" })
    );

    expect(screen.queryByText("Guidelines Interview")).toBeNull();
    expect(
      logEntries().some(
        (e) => e.level === "error" && /AI provider/i.test(e.message)
      )
    ).toBe(true);
  });

  it("opens_modal_when_provider_configured", () => {
    setSettings({
      providers: [
        { base_url: "http://x", api_key: "k", model: "m" },
      ],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
      flatten_output_folders: false,
    });

    render(() => <GuidelinesPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Generate with AI Interview" })
    );

    expect(screen.getByText("Guidelines Interview")).toBeDefined();
  });
});
