import { describe, it, expect } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders a spinner alongside the Generating label", () => {
    render(() => <StatusBadge status="Generating" />);

    expect(screen.getByText("Generating")).toBeTruthy();

    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.classList.contains("animate-spin")).toBe(true);
  });

  it("renders a spinner alongside the Processing label", () => {
    render(() => <StatusBadge status="Processing" />);

    expect(screen.getByText("Processing")).toBeTruthy();

    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.classList.contains("animate-spin")).toBe(true);
  });

  it("does not render a spinner for non-Processing, non-Generating statuses", () => {
    const nonSpinnerStatuses = ["Pending", "Completed", "Error", "Skipped"] as const;

    for (const status of nonSpinnerStatuses) {
      const { unmount } = render(() => <StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeTruthy();
      expect(document.querySelector("svg")).toBeFalsy();
      unmount();
    }
  });

  it("renders_Approved_for_pending_when_isApproved", () => {
    render(() => <StatusBadge status="Pending" isApproved />);
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByText("Pending")).toBeFalsy();
    expect(document.querySelector("svg")).toBeFalsy();
    const el = screen.getByText("Approved");
    expect(el.className).toContain("text-gold");
    expect(el.className).toContain("bg-gold/20");
    expect(el.className).not.toContain("text-status-completed");
    expect(el.className).not.toContain("bg-status-approved");
  });

  it("renders_Pending_when_not_approved", () => {
    render(() => <StatusBadge status="Pending" />);
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("renders_Completed_not_Approved_when_completed_and_approved", () => {
    render(() => <StatusBadge status="Completed" isApproved />);
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByText("Approved")).toBeFalsy();
  });
});
