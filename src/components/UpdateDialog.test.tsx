import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import UpdateDialog from "./UpdateDialog";
import {
  setUpdateDialogPhase,
  setUpdateTargetVersion,
  setUpdateNotes,
  setUpdateProgress,
  setUpdateError,
} from "../stores/appStore";

describe("UpdateDialog", () => {
  beforeEach(() => {
    setUpdateDialogPhase("idle");
    setUpdateTargetVersion("");
    setUpdateNotes("");
    setUpdateProgress("");
    setUpdateError("");
  });

  afterEach(() => {
    setUpdateDialogPhase("idle");
  });

  it("shows_install_and_open_download_in_confirm_phase", () => {
    setUpdateDialogPhase("confirm");
    setUpdateTargetVersion("0.2.0");
    render(() => (
      <UpdateDialog
        currentVersion="0.1.0"
        onInstall={vi.fn()}
        onOpenDownload={vi.fn()}
      />
    ));

    expect(screen.getByText("Install and restart")).toBeTruthy();
    expect(screen.getByText("Open download page")).toBeTruthy();
    expect(screen.queryByText("⚠")).toBeNull();
  });

  it("disables_actions_while_downloading_and_shows_progress", () => {
    setUpdateDialogPhase("downloading");
    setUpdateProgress("Downloading 1 MB / 2 MB");
    render(() => (
      <UpdateDialog onInstall={vi.fn()} onOpenDownload={vi.fn()} />
    ));

    expect(screen.getByText("Downloading 1 MB / 2 MB")).toBeTruthy();
    const install = screen.getByRole("button", { name: "Install and restart" });
    expect(install).toHaveProperty("disabled", true);
  });

  it("shows_error_and_keeps_open_download", () => {
    setUpdateDialogPhase("error");
    setUpdateError("Network failed");
    render(() => (
      <UpdateDialog onInstall={vi.fn()} onOpenDownload={vi.fn()} />
    ));

    expect(screen.getByText("Network failed")).toBeTruthy();
    const open = screen.getByRole("button", { name: "Open download page" });
    expect(open).toHaveProperty("disabled", false);
  });
});
