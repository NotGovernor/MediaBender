import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import SettingsPage from "./SettingsPage";
import {
  setSettings,
  settings,
  setAppVersion,
  setAvailableUpdateVersion,
  setUpdateCheckPhase,
  setUpdateCheckError,
} from "../stores/appStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("SettingsPage provider card header", () => {
  beforeEach(() => {
    setSettings({
      providers: [
        { base_url: "https://api1.com", api_key: "key1", model: "model1" },
        { base_url: "https://api2.com", api_key: "key2", model: "model2" },
      ],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
    });
  });

  it("selects a provider when its card header is clicked", () => {
    render(() => <SettingsPage />);

    const secondProviderTitle = screen.getByText("api2.com - model2");
    fireEvent.click(secondProviderTitle);

    expect(settings().active_provider_index).toBe(1);
  });

  it("removes a provider without selecting it when Remove is clicked", () => {
    render(() => <SettingsPage />);

    const removeButtons = screen.getAllByText("Remove");
    expect(removeButtons.length).toBe(2);

    fireEvent.click(removeButtons[1]);

    expect(settings().providers.length).toBe(1);
    expect(settings().active_provider_index).toBe(0);
  });
});

describe("SettingsPage provider input focus", () => {
  beforeEach(() => {
    setSettings({
      providers: [
        { base_url: "", api_key: "", model: "" },
      ],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
    });
  });

  it("preserves the Base URL input DOM node across provider updates", () => {
    render(() => <SettingsPage />);

    const baseUrlInput = screen.getByPlaceholderText("https://api.example.com/v1");

    // Trigger an update that mutates the provider in place.
    // With <For>, referential equality changes cause DOM recreation.
    fireEvent.input(baseUrlInput, { target: { value: "h" } });

    // Re-query the DOM. If the node was recreated, this will be a different element.
    const baseUrlInputAfter = screen.getByPlaceholderText("https://api.example.com/v1");

    expect(baseUrlInputAfter).toBe(baseUrlInput);
    expect((baseUrlInputAfter as HTMLInputElement).value).toBe("h");
  });

  it("preserves the API Key input DOM node across provider updates", () => {
    render(() => <SettingsPage />);

    const apiKeyInput = screen.getByPlaceholderText("sk-...");

    fireEvent.input(apiKeyInput, { target: { value: "s" } });

    const apiKeyInputAfter = screen.getByPlaceholderText("sk-...");

    expect(apiKeyInputAfter).toBe(apiKeyInput);
    expect((apiKeyInputAfter as HTMLInputElement).value).toBe("s");
  });
});

describe("SettingsPage Verify FFmpeg", () => {
  beforeEach(() => {
    setSettings({
      providers: [],
      active_provider_index: 0,
      ffmpeg_path: "C:/ffmpeg/ffmpeg.exe",
      ffprobe_path: "C:/ffmpeg/ffprobe.exe",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
    });
  });

  it("persists settings before verifying paths", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const calls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      if (cmd === "verify_ffmpeg_paths") return [true, true];
      if (cmd === "load_settings") return settings();
      return undefined;
    });

    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("FFmpeg Paths"));
    fireEvent.click(screen.getByText("Verify FFmpeg"));

    await waitFor(() => {
      expect(calls).toEqual(["save_settings", "verify_ffmpeg_paths", "load_settings"]);
    });
    expect(invoke).toHaveBeenCalledWith("save_settings", { newSettings: settings() });
  });
});

describe("SettingsPage Execution updates", () => {
  beforeEach(() => {
    setSettings({
      providers: [],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
    });
    setAppVersion("");
    setAvailableUpdateVersion(null);
    setUpdateCheckPhase("idle");
    setUpdateCheckError("");
  });

  it("execution_tab_shows_updates_toggle", () => {
    setAppVersion("0.3.0");
    render(() => <SettingsPage />);

    fireEvent.click(screen.getByText("Execution"));

    expect(screen.getByText("Current version: v0.3.0")).toBeTruthy();
    const toggle = screen.getByLabelText("Check for updates on startup");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(settings().check_updates_on_startup).toBe(false);
  });

  it("execution_tab_does_not_claim_up_to_date_before_a_check", () => {
    setAppVersion("0.5.1");
    setUpdateCheckPhase("idle");
    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    expect(screen.getByText("Current version: v0.5.1")).toBeTruthy();
    expect(screen.queryByText("Up to date")).toBeNull();
  });

  it("execution_tab_shows_up_to_date_after_current_phase", () => {
    setAppVersion("0.5.1");
    setUpdateCheckPhase("current");
    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    expect(screen.getByText("Up to date")).toBeTruthy();
  });

  it("execution_tab_shows_dev_skip_and_error_copy", () => {
    setUpdateCheckPhase("skipped_dev");
    const { unmount } = render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    expect(screen.getByText("Update checks are skipped in development")).toBeTruthy();
    unmount();

    setUpdateCheckPhase("error");
    setUpdateCheckError("boom");
    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    expect(screen.getByText("Update check failed: boom")).toBeTruthy();
  });

  it("execution_tab_check_button_disables_while_checking", () => {
    setUpdateCheckPhase("checking");
    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    const btn = screen.getByRole("button", { name: /Check for updates/i });
    expect(btn).toHaveProperty("disabled", true);
  });
});

describe("SettingsPage Execution max parallel", () => {
  beforeEach(() => {
    setSettings({
      providers: [],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
    });
    setAppVersion("");
    setAvailableUpdateVersion(null);
  });

  it("execution_tab_max_parallel_is_range_1_to_4", () => {
    setSettings({ ...settings(), max_parallel: 1 });
    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    const slider = screen.getByLabelText("Max Parallel Jobs") as HTMLInputElement;
    expect(slider.type).toBe("range");
    expect(slider.min).toBe("1");
    expect(slider.max).toBe("4");
    expect(slider.step).toBe("1");
    expect(slider.value).toBe("1");
    expect(screen.getByText("Max Parallel Jobs:")).toBeTruthy();
    expect(screen.getByText("Max Parallel Jobs:").closest("label")?.textContent).toMatch(
      /Max Parallel Jobs:\s*1/,
    );
    expect(screen.getByText(/2 is a safe starting point for hardware encoding/i)).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });

  it("execution_tab_slider_writes_integer_and_clamps_display", () => {
    setSettings({ ...settings(), max_parallel: 8 });
    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    const slider = screen.getByLabelText("Max Parallel Jobs") as HTMLInputElement;
    expect(slider.value).toBe("4");
    expect(screen.getByText("Max Parallel Jobs:").closest("label")?.textContent).toMatch(
      /Max Parallel Jobs:\s*4/,
    );
    fireEvent.input(slider, { target: { value: "3" } });
    expect(settings().max_parallel).toBe(3);
    expect(screen.getByText("Max Parallel Jobs:").closest("label")?.textContent).toMatch(
      /Max Parallel Jobs:\s*3/,
    );
  });
});

describe("SettingsPage Execution max parallel", () => {
  beforeEach(() => {
    setSettings({
      providers: [],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
      check_updates_on_startup: true,
    });
  });

  it("shows_hardware_encoding_hint_for_max_parallel", () => {
    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    expect(
      screen.getByText(/2 is a safe starting point for hardware encoding/i),
    ).toBeTruthy();
    expect(screen.getByText(/session-limit/i)).toBeTruthy();
  });

  it("saves_settings_immediately_when_max_parallel_changes", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(undefined);

    render(() => <SettingsPage />);
    fireEvent.click(screen.getByText("Execution"));
    const input = screen.getByLabelText("Max Parallel Jobs") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "3" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_settings", {
        newSettings: expect.objectContaining({ max_parallel: 3 }),
      });
    });
    expect(settings().max_parallel).toBe(3);
  });
});
