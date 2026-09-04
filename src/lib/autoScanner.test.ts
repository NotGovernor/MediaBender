import { describe, it, expect, vi, type Mock } from "vitest";
import { scanPendingFiles } from "./autoScanner";
import type { LogEntry, WorkQueue } from "../types";
import { createMockFile, createMockQueue } from "../test-helpers";

describe("scanPendingFiles", () => {
  interface Deps {
    scanAndAnalyze: Mock<(fileIds: string[], ffprobePath: string) => Promise<WorkQueue>>;
    setWorkQueue: Mock<(queue: WorkQueue) => void>;
    addLog: Mock<(entry: LogEntry) => void>;
    setIsScanning: Mock<(value: boolean) => void>;
  }

  function makeDeps(overrides: Partial<Deps> = {}): Deps {
    return {
      scanAndAnalyze: vi.fn().mockResolvedValue(createMockQueue()),
      setWorkQueue: vi.fn(),
      addLog: vi.fn(),
      setIsScanning: vi.fn(),
      ...overrides,
    };
  }

  it("calls scanAndAnalyze with file ids and ffprobe path", async () => {
    const deps = makeDeps();

    await scanPendingFiles(["file-1", "file-2"], "/path/to/ffprobe", deps);

    expect(deps.scanAndAnalyze).toHaveBeenCalledWith(
      ["file-1", "file-2"],
      "/path/to/ffprobe"
    );
  });

  it("replaces the work queue with the returned WorkQueue", async () => {
    const returned = createMockQueue([
      createMockFile({
        id: "file-1",
        input_path: "/vids/a.mkv",
        metadata: { container: "mkv" } as any,
        ffprobe_raw: "raw1",
        input_size: 123456789,
        error_message: "",
        status: "Pending",
        updated_at: "2024-01-01T00:00:00Z",
      }),
    ]);
    const deps = makeDeps({
      scanAndAnalyze: vi.fn().mockResolvedValue(returned),
    });

    await scanPendingFiles(["file-1"], "/path/to/ffprobe", deps);

    expect(deps.setWorkQueue).toHaveBeenCalledWith(returned);
  });

  it("sets isScanning true before work and false after", async () => {
    const deps = makeDeps();

    await scanPendingFiles(["file-1"], "/path/to/ffprobe", deps);

    expect(deps.setIsScanning).toHaveBeenCalledWith(true);
    expect(deps.setIsScanning).toHaveBeenCalledWith(false);
    const trueIndex = deps.setIsScanning.mock.calls.findIndex((c) => c[0] === true);
    const falseIndex = deps.setIsScanning.mock.calls.findIndex((c) => c[0] === false);
    expect(trueIndex).toBeLessThan(falseIndex);
  });

  it("logs scan start and completion summary", async () => {
    const deps = makeDeps({
      scanAndAnalyze: vi.fn().mockResolvedValue(
        createMockQueue([
          createMockFile({
            id: "file-1",
            input_path: "/vids/a.mkv",
            metadata: { container: "mkv" } as any,
            ffprobe_raw: "raw1",
            input_size: 123456789,
            error_message: "",
            status: "Pending",
            updated_at: "2024-01-01T00:00:00Z",
          }),
          createMockFile({
            id: "file-2",
            input_path: "/vids/b.mkv",
            metadata: null,
            ffprobe_raw: "",
            input_size: 0,
            error_message: "bad file",
            status: "Error",
            updated_at: "2024-01-01T00:00:01Z",
          }),
        ])
      ),
    });

    await scanPendingFiles(["file-1", "file-2"], "/path/to/ffprobe", deps);

    const messages = deps.addLog.mock.calls.map((c) => c[0].message);
    expect(messages).toContain("Scanning 2 files...");
    expect(messages).toContain("Scan complete: 1 analyzed, 1 errors.");
  });

  it("logs error and clears isScanning when backend call fails", async () => {
    const deps = makeDeps({
      scanAndAnalyze: vi.fn().mockRejectedValue(new Error("ffprobe not found")),
    });

    await scanPendingFiles(["file-1"], "/path/to/ffprobe", deps);

    const errorLog = deps.addLog.mock.calls.find((c) => c[0].level === "error");
    expect(errorLog).toBeDefined();
    expect(errorLog![0].message).toContain("Scan & Analyze failed: Error: ffprobe not found");
    expect(deps.setIsScanning).toHaveBeenCalledWith(false);
  });
});
