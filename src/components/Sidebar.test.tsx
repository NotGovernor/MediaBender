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

    expect(screen.getByText("v0.4.0 available")).toBeTruthy();
  });

  it("click_fires_onVersionClick", () => {
    setAppVersion("0.3.0");
    const onVersionClick = vi.fn();
    render(() => <Sidebar onVersionClick={onVersionClick} />);

    fireEvent.click(screen.getByText("v0.3.0").closest("button")!);
    expect(onVersionClick).toHaveBeenCalledTimes(1);
  });
});
