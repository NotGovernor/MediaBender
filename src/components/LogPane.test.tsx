import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import LogPane from "./LogPane";
import {
  addLog,
  clearLogs,
  logEntries,
  logPaneOpen,
  setLogPaneOpen,
} from "../stores/appStore";

describe("LogPane", () => {
  beforeEach(() => {
    clearLogs();
    setLogPaneOpen(false);
  });

  it("places_log_Clear_after_count_not_next_to_chevron", () => {
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "hi",
    });
    render(() => <LogPane />);

    const labelCluster = screen.getByText("Execution Log").parentElement!;
    const clear = screen.getByRole("button", { name: "Clear" });
    const count = screen.getByText("(1)");
    expect(labelCluster.contains(clear)).toBe(true);
    expect(count.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
  });

  it("hides_log_Clear_when_log_is_empty", () => {
    render(() => <LogPane />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("log_Clear_does_not_toggle_pane", () => {
    addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "hi",
    });
    render(() => <LogPane />);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(logPaneOpen()).toBe(false);
    expect(logEntries()).toEqual([]);
  });
});
