import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import Sidebar from "./Sidebar";
import { setAppVersion, setAvailableUpdateVersion } from "../stores/appStore";

describe("Sidebar", () => {
  beforeEach(() => {
    setAppVersion("");
    setAvailableUpdateVersion(null);
  });

  it("renders_runtime_version_from_store", () => {
    setAppVersion("0.3.0");
    render(() => <Sidebar />);

    expect(screen.getByText("v0.3.0")).toBeTruthy();
    expect(screen.queryByText("v0.1.0")).toBeNull();
  });

  it("shows_gold_available_note", () => {
    setAvailableUpdateVersion("0.4.0");
    render(() => <Sidebar />);

    expect(screen.getByText("v0.4.0 upgrade available")).toBeTruthy();
  });

  it("spaces_current_and_available_on_one_line", () => {
    setAppVersion("0.5.1");
    setAvailableUpdateVersion("0.5.2");
    render(() => <Sidebar />);

    expect(screen.getByText("v0.5.1")).toBeTruthy();
    expect(screen.getByText("v0.5.2 upgrade available")).toBeTruthy();
    const btn = screen.getByText("v0.5.1").closest("button")!;
    expect(btn.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["flex", "items-center", "gap-1.5", "min-w-0"]),
    );
  });

  it("footer_height_matches_bottom_bar", () => {
    setAppVersion("0.5.1");
    render(() => <Sidebar />);

    const btn = screen.getByText("v0.5.1").closest("button")!;
    const footer = btn.parentElement!;
    expect(footer.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["h-12", "px-3", "flex", "items-center", "flex-shrink-0"]),
    );
    expect(footer.className.split(/\s+/)).not.toEqual(expect.arrayContaining(["p-3"]));
  });

  it("click_fires_onVersionClick", () => {
    setAppVersion("0.3.0");
    const onVersionClick = vi.fn();
    render(() => <Sidebar onVersionClick={onVersionClick} />);

    fireEvent.click(screen.getByText("v0.3.0").closest("button")!);
    expect(onVersionClick).toHaveBeenCalledTimes(1);
  });
});
