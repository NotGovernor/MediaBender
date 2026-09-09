import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  requestScanPending,
  resetScanFlightForTests,
  setScanAndAnalyzeForTests,
} from "./autoScanner";
import { setIsScanning, setSettings, setWorkQueue } from "../stores/appStore";
import type { WorkQueue } from "../types";
import { createMockFile, createMockQueue } from "../test-helpers";

describe("requestScanPending coalesce", () => {
  beforeEach(() => {
    resetScanFlightForTests();
    setIsScanning(false);
    setWorkQueue(
      createMockQueue([
        createMockFile({ id: "file-1", metadata: null, status: "Pending" }),
      ])
    );
    setSettings((s) => ({ ...s, ffprobe_path: "/path/to/ffprobe" }));
  });

  afterEach(() => {
    resetScanFlightForTests();
    setScanAndAnalyzeForTests(null);
    setIsScanning(false);
  });

  it("requestScanPending_second_call_while_in_flight_does_not_overlap_invoke", async () => {
    let resolveFirst!: (queue: WorkQueue) => void;
    const first = new Promise<WorkQueue>((resolve) => {
      resolveFirst = resolve;
    });
    const scanAndAnalyze = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(createMockQueue());
    setScanAndAnalyzeForTests(scanAndAnalyze);

    const p1 = requestScanPending({ logIfEmpty: false });
    const p2 = requestScanPending({ logIfEmpty: false });

    expect(scanAndAnalyze).toHaveBeenCalledTimes(1);

    resolveFirst(createMockQueue());
    await Promise.all([p1, p2]);
  });

  it("requestScanPending_drains_queued_after_first_invoke", async () => {
    let resolveFirst!: (queue: WorkQueue) => void;
    const first = new Promise<WorkQueue>((resolve) => {
      resolveFirst = resolve;
    });
    const scanAndAnalyze = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(createMockQueue());
    setScanAndAnalyzeForTests(scanAndAnalyze);

    const p1 = requestScanPending({ logIfEmpty: false });
    const p2 = requestScanPending({ logIfEmpty: false });

    expect(scanAndAnalyze).toHaveBeenCalledTimes(1);

    resolveFirst(createMockQueue());
    await Promise.all([p1, p2]);

    expect(scanAndAnalyze).toHaveBeenCalledTimes(2);
  });
});
