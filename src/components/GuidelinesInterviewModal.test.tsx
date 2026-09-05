import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@solidjs/testing-library";
import { invoke } from "@tauri-apps/api/core";
import GuidelinesInterviewModal from "./GuidelinesInterviewModal";
import { setSettings, setWorkQueue, setLogEntries, workQueue, logEntries } from "../stores/appStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("GuidelinesInterviewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLogEntries([]);
    setWorkQueue({
      output_folder: "",
      guidelines: "old guidelines",
      files: [],
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
    });
    setSettings({
      providers: [{ base_url: "http://x", api_key: "k", model: "m" }],
      active_provider_index: 0,
      ffmpeg_path: "",
      ffprobe_path: "",
      default_output_folder: "",
      naming_template: "{name}.mkv",
      max_parallel: 1,
    });
  });

  it("auto_kicks_with_empty_messages_and_shows_assistant_reply", async () => {
    mockedInvoke.mockResolvedValue({
      type: "message",
      content: "What is your goal?",
    });

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={() => {}} />
    ));

    await waitFor(() => {
      expect(screen.getByText("What is your goal?")).toBeTruthy();
    });

    expect(mockedInvoke).toHaveBeenCalledWith("interview_guidelines", {
      messages: [],
    });
    expect(screen.queryByText("Begin the interview.")).toBeNull();
  });

  it("shows_typing_indicator_while_waiting", async () => {
    let resolveInvoke: (v: unknown) => void = () => {};
    mockedInvoke.mockReturnValue(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      })
    );

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={() => {}} />
    ));

    expect(await screen.findByLabelText("Assistant is typing")).toBeTruthy();
    resolveInvoke({ type: "message", content: "Hi" });
    await waitFor(() => {
      expect(screen.queryByLabelText("Assistant is typing")).toBeNull();
    });
  });

  it("shows_error_on_backend_failure", async () => {
    mockedInvoke.mockRejectedValue("No active provider configured");

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={() => {}} />
    ));

    await waitFor(() => {
      expect(screen.getByText(/No active provider configured/)).toBeTruthy();
    });
  });

  it("send_appends_user_and_assistant_and_passes_full_history", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ type: "message", content: "Q1" })
      .mockResolvedValueOnce({ type: "message", content: "Q2" });

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={() => {}} />
    ));

    await waitFor(() => expect(screen.getByText("Q1")).toBeTruthy());

    const input = screen.getByLabelText("Interview message");
    fireEvent.input(input, { target: { value: "I use a Shield" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("Q2")).toBeTruthy());
    expect(screen.getByText("I use a Shield")).toBeTruthy();

    expect(mockedInvoke).toHaveBeenLastCalledWith("interview_guidelines", {
      messages: [
        { role: "assistant", content: "Q1" },
        { role: "user", content: "I use a Shield" },
      ],
    });
  });

  it("disables_send_while_loading", async () => {
    mockedInvoke.mockReturnValue(new Promise(() => {}));

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={() => {}} />
    ));

    const send = await screen.findByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("replaces_chat_with_preview_on_complete", async () => {
    mockedInvoke.mockResolvedValue({
      type: "complete",
      guidelines_markdown: "# New Guidelines\n\nOpus 128k",
    });

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={() => {}} />
    ));

    await waitFor(() => {
      expect(screen.getByText("# New Guidelines", { exact: false })).toBeTruthy();
    });
    expect(screen.queryByLabelText("Interview message")).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("apply_saves_guidelines_logs_and_closes", async () => {
    const onClose = vi.fn();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "interview_guidelines") {
        return Promise.resolve({
          type: "complete",
          guidelines_markdown: "# New Guidelines\n\nOpus 128k",
        });
      }
      if (cmd === "save_guidelines") {
        return Promise.resolve(undefined);
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={onClose} />
    ));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("save_guidelines", {
        guidelines: "# New Guidelines\n\nOpus 128k",
      });
    });
    expect(onClose).toHaveBeenCalled();
    expect(workQueue().guidelines).toBe("# New Guidelines\n\nOpus 128k");
    expect(
      logEntries().some(
        (entry) => entry.message === "Guidelines updated" && entry.level === "info"
      )
    ).toBe(true);
  });

  it("cancel_closes_without_save", async () => {
    const onClose = vi.fn();
    mockedInvoke.mockResolvedValue({
      type: "complete",
      guidelines_markdown: "# New Guidelines",
    });

    render(() => (
      <GuidelinesInterviewModal open={true} onClose={onClose} />
    ));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(
      mockedInvoke.mock.calls.some((call) => call[0] === "save_guidelines")
    ).toBe(false);
  });

  it("scrolls_conversation_to_bottom_when_messages_update", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        if ((this as HTMLElement).getAttribute("aria-label") === "Interview conversation") {
          return 2000;
        }
        return 0;
      },
    });
    try {
      mockedInvoke
        .mockResolvedValueOnce({ type: "message", content: "Q1" })
        .mockResolvedValueOnce({ type: "message", content: "Q2" });
      render(() => <GuidelinesInterviewModal open={true} onClose={() => {}} />);
      await waitFor(() => expect(screen.getByText("Q1")).toBeTruthy());
      const list = screen.getByLabelText("Interview conversation");
      expect(list.scrollTop).toBe(2000);
      const input = screen.getByLabelText("Interview message");
      fireEvent.input(input, { target: { value: "I use a Shield" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(screen.getByText("Q2")).toBeTruthy());
      expect(list.scrollTop).toBe(2000);
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
      }
    }
  });
});
