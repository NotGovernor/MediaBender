import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import TopBar from "./TopBar";
import {
  setWorkQueue,
  setSettings,
  settings,
  workQueue,
  isProcessing,
  clearGeneratingIds,
  generatingIds,
  isGenerating,
  addGeneratingIds,
  logEntries,
  clearLogs,
  setScheduledIds,
} from "../stores/appStore";
import { createMockFile, createMockQueue } from "../test-helpers";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("TopBar", () => {
  beforeEach(() => {
    clearLogs();
    clearGeneratingIds();
    setScheduledIds([]);
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
      flatten_output_folders: false,
    });
  });

  it("does not set approved Pending files to Processing when Start Processing is clicked", async () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const fileB = createMockFile({ id: "b", status: "Pending", is_approved: true });
    const fileC = createMockFile({ id: "c", status: "Pending", is_approved: false });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB, fileC] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    render(() => <TopBar />);

    const startButton = screen.getByRole("button", { name: /Start Processing/ });
    fireEvent.click(startButton);

    await waitFor(() => {
      const files = workQueue().files;
      expect(files.find((f) => f.id === "a")!.status).toBe("Pending");
      expect(files.find((f) => f.id === "b")!.status).toBe("Pending");
      expect(files.find((f) => f.id === "c")!.status).toBe("Pending");
      expect(isProcessing()).toBe(false);
    });
  });

  it("invokes stop_processing without locally resetting Processing files", async () => {
    const fileA = createMockFile({ id: "a", status: "Processing", is_approved: true });
    const fileB = createMockFile({ id: "b", status: "Processing", is_approved: true });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    render(() => <TopBar />);

    const stopButton = screen.getByText("Stop");
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("stop_processing");
    });

    const files = workQueue().files;
    expect(files.find((f) => f.id === "a")!.status).toBe("Processing");
    expect(files.find((f) => f.id === "b")!.status).toBe("Processing");
    expect(isProcessing()).toBe(true);
  });

  it("does not locally reset files when start_processing fails", async () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const fileB = createMockFile({ id: "b", status: "Completed", is_approved: true });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce("No eligible files to process");

    render(() => <TopBar />);

    fireEvent.click(screen.getByRole("button", { name: /Start Processing/ }));

    await waitFor(() => {
      const errorLogs = logEntries().filter((e) => e.level === "error");
      expect(errorLogs.some((e) => e.message.includes("Failed to start processing"))).toBe(true);
    });

    const files = workQueue().files;
    expect(files.find((f) => f.id === "a")!.status).toBe("Pending");
    expect(files.find((f) => f.id === "b")!.status).toBe("Completed");
  });

  it("does not set target files to Generating locally when Generate Commands is clicked", async () => {
    const fileA = createMockFile({
      id: "a",
      status: "Pending",
      generated_command: "",
      metadata: {
        container: "mkv",
        video: { codec: "h264", width: 1920, height: 1080, hdr: false, bit_depth: 8, fps: 24 },
        audio_streams: [{ index: 0, codec: "aac", channels: 2, layout: "stereo" }],
        subtitle_streams: [],
        subtitle_count: 0,
        has_chapters: false,
        duration: 3600,
        bitrate: 5000000,
      },
    });

    setWorkQueue((q) => ({ ...q, files: [fileA] }));

    const { invoke } = await import("@tauri-apps/api/core");
    let resolveInvoke: (value: any) => void;
    const deferred = new Promise<any>((resolve) => {
      resolveInvoke = resolve;
    });
    vi.mocked(invoke).mockReturnValueOnce(deferred);

    render(() => <TopBar />);

    const generateButton = screen.getByText("Generate Commands") as HTMLButtonElement;
    fireEvent.click(generateButton);

    expect(workQueue().files.find((f) => f.id === "a")!.status).toBe("Pending");
    expect(generatingIds()).toEqual(["a"]);
    expect(isGenerating()).toBe(true);
    expect(generateButton.querySelector("svg")).toBeTruthy();
    const startButton = screen.getByRole("button", { name: /Start Processing/ }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);

    resolveInvoke!(
      createMockQueue([
        {
          ...fileA,
          generated_command: "ffmpeg -i input.mkv output.mkv",
          command_args: "-c:v copy -c:a opus",
          description: "Transcode to HEVC",
          reasoning: "Smaller file size",
          error_message: "",
          status: "Pending",
          updated_at: new Date().toISOString(),
          output_path: "/media/output/Generated.mkv",
        },
      ])
    );

    await waitFor(() => {
      expect(workQueue().files.find((f) => f.id === "a")!.status).toBe("Pending");
    });
    await waitFor(() => {
      expect(generatingIds()).toEqual([]);
    });
  });

  it("keeps_Start_enabled_while_generating_if_other_rows_are_addable", () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [fileA] }));
    addGeneratingIds(["z"]);
    render(() => <TopBar />);
    const startButton = screen.getByRole("button", { name: /Start Processing/ }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(false);
  });

  it("enables_Generate_while_Processing_if_idle_rows_need_commands", () => {
    const live = createMockFile({ id: "live", status: "Processing", is_approved: true });
    const idle = createMockFile({ id: "idle", status: "Pending", generated_command: "" });
    setWorkQueue((q) => ({ ...q, files: [live, idle] }));

    render(() => <TopBar />);

    const generateButton = screen.getByText("Generate Commands") as HTMLButtonElement;
    expect(generateButton.disabled).toBe(false);
  });

  it("disables_Approve_All_for_frozen_or_completed_rows", () => {
    const fileA = createMockFile({
      id: "a",
      status: "Pending",
      is_approved: false,
      generated_command: "cmd",
    });
    setWorkQueue((q) => ({ ...q, files: [fileA] }));
    setScheduledIds(["a"]);

    render(() => <TopBar />);

    const approveAllButton = screen.getByText("Approve All") as HTMLButtonElement;
    expect(approveAllButton.disabled).toBe(true);
  });

  it("disables Approve All when no items have a generated command and are unapproved", () => {
    const fileA = createMockFile({ id: "a", generated_command: "", is_approved: false });
    const fileB = createMockFile({ id: "b", generated_command: "cmd", is_approved: true });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));

    render(() => <TopBar />);

    const approveAllButton = screen.getByText("Approve All") as HTMLButtonElement;
    expect(approveAllButton.disabled).toBe(true);
  });

  it("sets is_approved to true on eligible items when Approve All is clicked", async () => {
    const fileA = createMockFile({ id: "a", generated_command: "cmd-a", is_approved: false });
    const fileB = createMockFile({ id: "b", generated_command: "cmd-b", is_approved: false });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(
      createMockQueue([
        { ...fileA, is_approved: true },
        { ...fileB, is_approved: true },
      ])
    );

    render(() => <TopBar />);

    const approveAllButton = screen.getByText("Approve All") as HTMLButtonElement;
    expect(approveAllButton.disabled).toBe(false);

    fireEvent.click(approveAllButton);

    await waitFor(() => {
      const files = workQueue().files;
      expect(files.find((f) => f.id === "a")!.is_approved).toBe(true);
      expect(files.find((f) => f.id === "b")!.is_approved).toBe(true);
    });
  });

  it("skips items without commands or already approved when Approve All is clicked", async () => {
    const fileA = createMockFile({ id: "a", generated_command: "cmd-a", is_approved: false });
    const fileB = createMockFile({ id: "b", generated_command: "", is_approved: false });
    const fileC = createMockFile({ id: "c", generated_command: "cmd-c", is_approved: true });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB, fileC] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(
      createMockQueue([
        { ...fileA, is_approved: true },
        fileB,
        fileC,
      ])
    );

    render(() => <TopBar />);

    const approveAllButton = screen.getByText("Approve All") as HTMLButtonElement;
    fireEvent.click(approveAllButton);

    await waitFor(() => {
      const files = workQueue().files;
      expect(files.find((f) => f.id === "a")!.is_approved).toBe(true);
      expect(files.find((f) => f.id === "b")!.is_approved).toBe(false);
      expect(files.find((f) => f.id === "c")!.is_approved).toBe(true);
    });
  });

  it("logs how many items were approved when Approve All is clicked", async () => {
    const fileA = createMockFile({ id: "a", generated_command: "cmd-a", is_approved: false });
    const fileB = createMockFile({ id: "b", generated_command: "cmd-b", is_approved: false });

    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue(
      createMockQueue([
        { ...fileA, is_approved: true },
        { ...fileB, is_approved: true },
      ])
    );

    render(() => <TopBar />);

    const approveAllButton = screen.getByText("Approve All") as HTMLButtonElement;
    fireEvent.click(approveAllButton);

    await waitFor(() => {
      const infoLogs = logEntries().filter((e) => e.level === "info");
      const approvalLog = infoLogs.find((e) => e.message.includes("Approved"));
      expect(approvalLog).toBeDefined();
      expect(approvalLog!.message).toContain("2");
    });
  });

  it("patches command_args into the store after Generate Commands succeeds", async () => {
    const fileA = createMockFile({
      id: "a",
      status: "Pending",
      generated_command: "",
      command_args: "",
    });

    setWorkQueue((q) => ({ ...q, files: [fileA] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(
      createMockQueue([
        {
          ...fileA,
          generated_command: "ffmpeg -i input.mkv output.mkv",
          command_args: "-c:v copy -c:a opus",
          description: "Transcode to HEVC",
          reasoning: "Smaller file size",
          error_message: "",
          status: "Pending",
          updated_at: new Date().toISOString(),
          output_path: "/media/output/Generated.mkv",
        },
      ])
    );

    render(() => <TopBar />);

    const generateButton = screen.getByText("Generate Commands") as HTMLButtonElement;
    fireEvent.click(generateButton);

    await waitFor(() => {
      const files = workQueue().files;
      expect(files.find((f) => f.id === "a")!.command_args).toBe("-c:v copy -c:a opus");
    });
  });

  it("patches output_path into the store after Generate Commands succeeds", async () => {
    const fileA = createMockFile({
      id: "a",
      status: "Pending",
      generated_command: "",
      output_path: "",
    });

    setWorkQueue((q) => ({ ...q, files: [fileA] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(
      createMockQueue([
        {
          ...fileA,
          generated_command: "ffmpeg -i input.mkv output.mkv",
          command_args: "-c:v copy -c:a opus",
          description: "Transcode to HEVC",
          reasoning: "Smaller file size",
          error_message: "",
          status: "Pending",
          updated_at: new Date().toISOString(),
          output_path: "/media/output/Generated.mkv",
        },
      ])
    );

    render(() => <TopBar />);

    const generateButton = screen.getByText("Generate Commands") as HTMLButtonElement;
    fireEvent.click(generateButton);

    await waitFor(() => {
      const files = workQueue().files;
      expect(files.find((f) => f.id === "a")!.output_path).toBe("/media/output/Generated.mkv");
    });
  });

  it("disables_Start_when_only_approved_completed_exist", () => {
    const fileA = createMockFile({ id: "a", status: "Completed", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [fileA] }));

    render(() => <TopBar />);

    const startButton = screen.getByRole("button", { name: /Start Processing/ }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    expect(startButton.textContent).toBe("Start Processing");
  });

  it("labels_Start_with_eligible_count_and_ignores_approved_completed", () => {
    const pendingApproved = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const pendingNo = createMockFile({ id: "b", status: "Pending", is_approved: false });
    const completedApproved = createMockFile({ id: "c", status: "Completed", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [pendingApproved, pendingNo, completedApproved] }));

    render(() => <TopBar />);

    const startButton = screen.getByRole("button", { name: /Start Processing/ }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(false);
    expect(startButton.textContent).toBe("Start Processing (1)");
  });

  it("invokes_start_processing_with_only_approved_pending_ids", async () => {
    const pendingApproved = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const pendingNo = createMockFile({ id: "b", status: "Pending", is_approved: false });
    const completedApproved = createMockFile({ id: "c", status: "Completed", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [pendingApproved, pendingNo, completedApproved] }));

    const { invoke } = await import("@tauri-apps/api/core");
    const cmds: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      cmds.push(cmd);
      return undefined;
    });

    render(() => <TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /Start Processing/ }));

    await waitFor(() => {
      expect(cmds).toEqual(["save_settings", "start_processing"]);
    });
    expect(invoke).toHaveBeenCalledWith("save_settings", {
      newSettings: expect.objectContaining({ max_parallel: settings().max_parallel }),
    });
    expect(invoke).toHaveBeenCalledWith("start_processing", expect.objectContaining({
      fileIds: ["a"],
    }));
  });

  it("shows_Add_to_Queue_count_excluding_scheduled_ids", () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const fileB = createMockFile({ id: "b", status: "Pending", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));
    setScheduledIds(["a"]);

    render(() => <TopBar />);

    const addButton = screen.getByRole("button", { name: /Add to Queue/ }) as HTMLButtonElement;
    expect(addButton.textContent).toBe("Add to Queue (1)");
  });

  it("hides_Start_when_pipeline_active_and_addable_zero", () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [fileA] }));
    setScheduledIds(["a"]);

    render(() => <TopBar />);

    expect(screen.queryByRole("button", { name: /Start Processing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add to Queue/ })).toBeNull();
    expect(screen.getByText("Stop")).toBeTruthy();
  });

  it("shows_Stop_and_Start_together_when_pipeline_active_with_addable", () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const fileB = createMockFile({ id: "b", status: "Pending", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));
    setScheduledIds(["a"]);

    render(() => <TopBar />);

    expect(screen.getByText("Stop")).toBeTruthy();
    const addButton = screen.getByRole("button", { name: /Add to Queue/ }) as HTMLButtonElement;
    expect(addButton.textContent).toBe("Add to Queue (1)");
  });

  it("Generate_does_not_replace_untouched_Processing_row_from_invoke_result", async () => {
    const live = createMockFile({
      id: "live",
      status: "Processing",
      is_approved: true,
    });
    const idle = createMockFile({
      id: "idle",
      status: "Pending",
      generated_command: "",
    });
    setWorkQueue((q) => ({ ...q, files: [live, idle] }));

    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce(
      createMockQueue([
        { ...live, status: "Pending" },
        {
          ...idle,
          generated_command: "ffmpeg -i input.mkv output.mkv",
          command_args: "-c:v copy",
        },
      ]),
    );

    render(() => <TopBar />);

    fireEvent.click(screen.getByText("Generate Commands"));

    await waitFor(() => {
      const files = workQueue().files;
      expect(files.find((f) => f.id === "live")!.status).toBe("Processing");
      expect(files.find((f) => f.id === "idle")!.command_args).toBe("-c:v copy");
    });
  });

  it("Add_to_Queue_invokes_start_processing_with_unscheduled_ids_only", async () => {
    const fileA = createMockFile({ id: "a", status: "Pending", is_approved: true });
    const fileB = createMockFile({ id: "b", status: "Pending", is_approved: true });
    setWorkQueue((q) => ({ ...q, files: [fileA, fileB] }));
    setScheduledIds(["a"]);

    const { invoke } = await import("@tauri-apps/api/core");
    const cmds: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      cmds.push(cmd);
      return undefined;
    });

    render(() => <TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /Add to Queue/ }));

    await waitFor(() => {
      expect(cmds).toEqual(["save_settings", "start_processing"]);
    });
    expect(invoke).toHaveBeenCalledWith("save_settings", {
      newSettings: expect.objectContaining({ max_parallel: settings().max_parallel }),
    });
    expect(invoke).toHaveBeenCalledWith("start_processing", expect.objectContaining({
      fileIds: ["b"],
    }));
  });
});
