import { describe, it, expect } from "vitest";
import {
  isQueueBlockingUpdate,
  shouldCheckOnLaunch,
  formatAvailableNote,
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
    expect(formatAvailableNote("0.4.0")).toBe("v0.4.0 available");
  });
  it("does not double v", () => {
    expect(formatAvailableNote("v0.4.0")).toBe("v0.4.0 available");
  });
});
