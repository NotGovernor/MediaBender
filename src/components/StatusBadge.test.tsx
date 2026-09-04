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
});
