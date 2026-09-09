import { describe, it, expect } from "vitest";
import {
  displayFileStatus,
  isStartEligible,
  isAddable,
  isFrozen,
  isApprovable,
  isGenerateTarget,
} from "./queueReadiness";
import { createMockFile } from "../test-helpers";
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
    expect(isStartEligible({ is_approved: true, status: "Pending", command_args: "-c:v copy" })).toBe(true);
    expect(isStartEligible({ is_approved: false, status: "Pending", command_args: "-c:v copy" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Completed", command_args: "-c:v copy" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Processing", command_args: "-c:v copy" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Error", command_args: "-c:v copy" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Skipped", command_args: "-c:v copy" })).toBe(false);
  });

  it("false_when_command_args_empty", () => {
    expect(isStartEligible({ is_approved: true, status: "Pending", command_args: "" })).toBe(false);
    expect(isStartEligible({ is_approved: true, status: "Pending", command_args: "   " })).toBe(false);
  });
});

describe("isAddable", () => {
  it("isAddable_false_when_id_in_scheduledIds", () => {
    expect(
      isAddable(
        { id: "a", is_approved: true, status: "Pending", command_args: "-c:v copy" },
        ["a"],
      ),
    ).toBe(false);
  });

  it("isAddable_true_for_approved_pending_not_scheduled", () => {
    expect(
      isAddable(
        { id: "a", is_approved: true, status: "Pending", command_args: "-c:v copy" },
        ["b"],
      ),
    ).toBe(true);
  });

  it("isAddable_false_when_not_start_eligible", () => {
    expect(
      isAddable(
        { id: "a", is_approved: false, status: "Pending", command_args: "-c:v copy" },
        [],
      ),
    ).toBe(false);
    expect(
      isAddable(
        { id: "a", is_approved: true, status: "Completed", command_args: "-c:v copy" },
        [],
      ),
    ).toBe(false);
  });

  it("isAddable_false_when_command_args_empty", () => {
    expect(
      isAddable(
        { id: "a", is_approved: true, status: "Pending", command_args: "" },
        [],
      ),
    ).toBe(false);
  });
});

describe("isFrozen", () => {
  it("true_when_Processing_even_if_not_scheduled", () => {
    expect(isFrozen({ id: "a", status: "Processing" }, [])).toBe(true);
  });

  it("true_when_id_in_scheduledIds_even_if_Pending", () => {
    expect(isFrozen({ id: "a", status: "Pending" }, ["a"])).toBe(true);
  });

  it("false_for_idle_pending", () => {
    expect(isFrozen({ id: "a", status: "Pending" }, ["b"])).toBe(false);
  });
});

describe("isApprovable", () => {
  const base = {
    id: "a",
    generated_command: "ffmpeg",
    is_approved: false,
    status: "Pending" as const,
  };

  it("true_for_unapproved_pending_with_command", () => {
    expect(isApprovable(base, [])).toBe(true);
  });

  it("false_when_frozen_or_completed_or_skipped_or_already_approved_or_no_command", () => {
    expect(isApprovable({ ...base, status: "Processing" }, [])).toBe(false);
    expect(isApprovable(base, ["a"])).toBe(false);
    expect(isApprovable({ ...base, status: "Completed" }, [])).toBe(false);
    expect(isApprovable({ ...base, status: "Skipped" }, [])).toBe(false);
    expect(isApprovable({ ...base, is_approved: true }, [])).toBe(false);
    expect(isApprovable({ ...base, generated_command: "" }, [])).toBe(false);
  });

  it("true_for_unapproved_Error_with_command", () => {
    expect(isApprovable({ ...base, status: "Error" }, [])).toBe(true);
  });
});

describe("isGenerateTarget", () => {
  it("true_when_metadata_and_no_command_and_not_frozen", () => {
    expect(
      isGenerateTarget(
        createMockFile({
          id: "a",
          status: "Pending",
          generated_command: "",
        }),
        [],
      ),
    ).toBe(true);
  });

  it("false_when_has_command_or_frozen_or_no_metadata", () => {
    expect(
      isGenerateTarget(
        createMockFile({
          id: "a",
          status: "Pending",
          generated_command: "ffmpeg",
        }),
        [],
      ),
    ).toBe(false);
    expect(
      isGenerateTarget(
        createMockFile({
          id: "a",
          status: "Processing",
          generated_command: "",
        }),
        [],
      ),
    ).toBe(false);
    expect(
      isGenerateTarget(
        createMockFile({
          id: "a",
          status: "Pending",
          generated_command: "",
        }),
        ["a"],
      ),
    ).toBe(false);
    expect(
      isGenerateTarget(
        createMockFile({
          id: "a",
          status: "Pending",
          generated_command: "",
          metadata: null,
        }),
        [],
      ),
    ).toBe(false);
  });
});
