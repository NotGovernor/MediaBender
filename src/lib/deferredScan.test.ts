import { describe, it, expect, vi, type Mock } from "vitest";
import { checkAndRunDeferredScan } from "./deferredScan";
import type { LogEntry } from "../types";

describe("checkAndRunDeferredScan", () => {
  interface Deps {
    previousPath: string;
    currentPath: string;
    isScanning: boolean;
    scanQueue: Mock<(ffprobePath: string) => Promise<void>>;
    addLog: Mock<(entry: LogEntry) => void>;
  }

  function makeDeps(overrides: Partial<Deps> = {}): Deps {
    return {
      previousPath: "",
      currentPath: "/path/to/ffprobe",
      isScanning: false,
      scanQueue: vi.fn().mockResolvedValue(undefined),
      addLog: vi.fn(),
      ...overrides,
    };
  }

  it("triggers scan when ffprobe path transitions from empty to non-empty", async () => {
    const deps = makeDeps();

    await checkAndRunDeferredScan(deps);

    expect(deps.scanQueue).toHaveBeenCalledWith("/path/to/ffprobe");
  });

  it("does not trigger scan when previous path was already non-empty", async () => {
    const deps = makeDeps({ previousPath: "/old/path" });

    await checkAndRunDeferredScan(deps);

    expect(deps.scanQueue).not.toHaveBeenCalled();
  });

  it("does not trigger scan when current path is empty", async () => {
    const deps = makeDeps({ currentPath: "" });

    await checkAndRunDeferredScan(deps);

    expect(deps.scanQueue).not.toHaveBeenCalled();
  });

  it("does not trigger scan when isScanning is already true", async () => {
    const deps = makeDeps({ isScanning: true });

    await checkAndRunDeferredScan(deps);

    expect(deps.scanQueue).not.toHaveBeenCalled();
  });

  it("logs and re-throws when scanQueue throws", async () => {
    const deps = makeDeps({
      scanQueue: vi.fn().mockRejectedValue(new Error("ffprobe crashed")),
    });

    await expect(checkAndRunDeferredScan(deps)).rejects.toThrow("ffprobe crashed");

    const errorLog = deps.addLog.mock.calls.find((c) => c[0].level === "error");
    expect(errorLog).toBeDefined();
    expect(errorLog![0].message).toContain("Deferred scan failed");
  });
});
