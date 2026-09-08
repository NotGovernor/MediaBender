import { describe, it, expect } from "vitest";
import {
  isQueueBlockingUpdate,
  shouldCheckOnLaunch,
  formatAvailableNote,
  runUpdateCheck,
  outcomeAfterCheck,
  canStartUpdateCheck,
} from "./updates";

describe("isQueueBlockingUpdate", () => {
  it("is true when any file is Processing", () => {
    expect(
      isQueueBlockingUpdate([{ status: "Pending" }, { status: "Processing" }]),
    ).toBe(true);
  });

  it("is false when nothing is Processing", () => {
    expect(
      isQueueBlockingUpdate([{ status: "Pending" }, { status: "Completed" }]),
    ).toBe(false);
  });

  it("isQueueBlockingUpdate_true_when_scheduledIds_nonempty", () => {
    expect(
      isQueueBlockingUpdate([{ status: "Pending" }], ["a"]),
    ).toBe(true);
  });

  it("isQueueBlockingUpdate_true_when_processing", () => {
    expect(
      isQueueBlockingUpdate([{ status: "Pending" }, { status: "Processing" }]),
    ).toBe(true);
  });
});

describe("shouldCheckOnLaunch", () => {
  it("skips dev builds", () => {
    expect(shouldCheckOnLaunch({ isDev: true, checkOnStartup: true })).toBe(false);
  });
  it("skips when the setting is off", () => {
    expect(shouldCheckOnLaunch({ isDev: false, checkOnStartup: false })).toBe(false);
  });
  it("runs for packaged builds with the setting on", () => {
    expect(shouldCheckOnLaunch({ isDev: false, checkOnStartup: true })).toBe(true);
  });
});

describe("formatAvailableNote", () => {
  it("prefixes a leading v", () => {
    expect(formatAvailableNote("0.4.0")).toBe("v0.4.0 upgrade available");
  });
  it("does not double v", () => {
    expect(formatAvailableNote("v0.4.0")).toBe("v0.4.0 upgrade available");
  });
});

describe("runUpdateCheck", () => {
  it("returns null when isDev without calling check", async () => {
    let called = 0;
    const result = await runUpdateCheck({
      isDev: true,
      check: async () => {
        called += 1;
        return { version: "1.0.0", notes: "x" };
      },
    });
    expect(result).toBeNull();
    expect(called).toBe(0);
  });

  it("returns check result when not dev", async () => {
    const info = { version: "0.4.0", notes: "fixes" };
    const result = await runUpdateCheck({
      isDev: false,
      check: async () => info,
    });
    expect(result).toEqual(info);
  });

  it("swallows thrown errors as null", async () => {
    const result = await runUpdateCheck({
      isDev: false,
      check: async () => {
        throw new Error("network");
      },
    });
    expect(result).toBeNull();
  });
});

describe("outcomeAfterCheck", () => {
  it("manual dev skip does not open a dialog", () => {
    expect(outcomeAfterCheck({ isDev: true, silent: false, errorMessage: null, foundVersion: null })).toEqual({
      phase: "skipped_dev",
      errorMessage: "",
      availableVersion: null,
      openDialog: false,
      skipNetwork: true,
    });
  });

  it("silent dev does not paint skip or error", () => {
    expect(outcomeAfterCheck({ isDev: true, silent: true, errorMessage: null, foundVersion: null })).toEqual({
      phase: "idle",
      errorMessage: "",
      availableVersion: null,
      openDialog: false,
      skipNetwork: true,
    });
  });

  it("silent network error stays idle", () => {
    expect(
      outcomeAfterCheck({ isDev: false, silent: true, errorMessage: "net", foundVersion: null }),
    ).toEqual({
      phase: "idle",
      errorMessage: "",
      availableVersion: null,
      openDialog: false,
      skipNetwork: false,
    });
  });

  it("manual network error paints error", () => {
    expect(
      outcomeAfterCheck({ isDev: false, silent: false, errorMessage: "net", foundVersion: null }),
    ).toEqual({
      phase: "error",
      errorMessage: "net",
      availableVersion: null,
      openDialog: false,
      skipNetwork: false,
    });
  });

  it("success without update is current for silent and manual", () => {
    const expected = {
      phase: "current",
      errorMessage: "",
      availableVersion: null,
      openDialog: false,
      skipNetwork: false,
    };
    expect(
      outcomeAfterCheck({ isDev: false, silent: true, errorMessage: null, foundVersion: null }),
    ).toEqual(expected);
    expect(
      outcomeAfterCheck({ isDev: false, silent: false, errorMessage: null, foundVersion: null }),
    ).toEqual(expected);
  });

  it("found update opens dialog only when not silent", () => {
    expect(
      outcomeAfterCheck({ isDev: false, silent: false, errorMessage: null, foundVersion: "0.5.2" }),
    ).toEqual({
      phase: "idle",
      errorMessage: "",
      availableVersion: "0.5.2",
      openDialog: true,
      skipNetwork: false,
    });
    expect(
      outcomeAfterCheck({ isDev: false, silent: true, errorMessage: null, foundVersion: "0.5.2" }),
    ).toEqual({
      phase: "idle",
      errorMessage: "",
      availableVersion: "0.5.2",
      openDialog: false,
      skipNetwork: false,
    });
  });

  it("canStartUpdateCheck is false only while checking", () => {
    expect(canStartUpdateCheck("checking")).toBe(false);
    expect(canStartUpdateCheck("idle")).toBe(true);
    expect(canStartUpdateCheck("current")).toBe(true);
    expect(canStartUpdateCheck("error")).toBe(true);
    expect(canStartUpdateCheck("skipped_dev")).toBe(true);
  });
});
