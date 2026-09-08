import { describe, it, expect } from "vitest";
import { clampMaxParallel } from "./clampMaxParallel";

describe("clampMaxParallel", () => {
  it("leaves 1–4 unchanged", () => {
    expect(clampMaxParallel(1)).toBe(1);
    expect(clampMaxParallel(4)).toBe(4);
    expect(clampMaxParallel(2)).toBe(2);
  });

  it("clamps below 1 up to 1", () => {
    expect(clampMaxParallel(0)).toBe(1);
    expect(clampMaxParallel(-3)).toBe(1);
  });

  it("clamps above 4 down to 4", () => {
    expect(clampMaxParallel(5)).toBe(4);
    expect(clampMaxParallel(8)).toBe(4);
    expect(clampMaxParallel(99)).toBe(4);
  });

  it("NaN becomes 1", () => {
    expect(clampMaxParallel(Number.NaN)).toBe(1);
  });
});
