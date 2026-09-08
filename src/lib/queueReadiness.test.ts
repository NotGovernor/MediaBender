import { describe, it, expect } from "vitest";
import { displayFileStatus, isStartEligible, isAddable } from "./queueReadiness";
import type { FileStatus } from "../types";

describe("displayFileStatus", () => {
  it("maps_pending_approved_to_Approved", () => {
    expect(displayFileStatus("Pending", true)).toBe("Approved");
  });

  it("keeps_pending_when_not_approved", () => {
    expect(displayFileStatus("Pending", false)).toBe("Pending");
  });

  it("does_not_override_non_pending_even_when_approved", () => {
    const statuses: FileStatus[] = [
      "Generating",
      "Processing",
      "Completed",
      "Error",
      "Skipped",
    ];
    for (const status of statuses) {
      expect(displayFileStatus(status, true)).toBe(status);
      expect(displayFileStatus(status, false)).toBe(status);
    }
  });
});

describe("isStartEligible", () => {
  it("true_only_for_approved_pending", () => {
    expect(isStartEligible({ is_approved: true, status: "Pending" })).toBe(true);
    expect(isStartEligible({ is_approved: false, status: "Pending" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Completed" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Processing" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Error" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Skipped" })).toBe(false);
  });
});

describe("isAddable", () => {
  it("isAddable_false_when_id_in_scheduledIds", () => {
    expect(
      isAddable(
        { id: "a", is_approved: true, status: "Pending" },
        ["a"],
      ),
    ).toBe(false);
  });

  it("isAddable_true_for_approved_pending_not_scheduled", () => {
    expect(
      isAddable(
        { id: "a", is_approved: true, status: "Pending" },
        ["b"],
      ),
    ).toBe(true);
  });

  it("isAddable_false_when_not_start_eligible", () => {
    expect(
      isAddable(
        { id: "a", is_approved: false, status: "Pending" },
        [],
      ),
    ).toBe(false);
    expect(
      isAddable(
        { id: "a", is_approved: true, status: "Completed" },
        [],
      ),
    ).toBe(false);
  });
});
