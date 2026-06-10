import { describe, it, expect } from "vitest";
import { normalizedToPixel } from "../../src/utils/image.js";
import type { ScreenInfo } from "../../src/core/types.js";

describe("normalizedToPixel", () => {
  const iphone16: ScreenInfo = { width: 393, height: 852, scale: 3 };
  const iphone16ProMax: ScreenInfo = { width: 440, height: 956, scale: 3 };
  const iphoneSE: ScreenInfo = { width: 375, height: 667, scale: 2 };

  it("converts center coordinates", () => {
    const result = normalizedToPixel([500, 500], iphone16);
    expect(result.x).toBe(197);
    expect(result.y).toBe(426);
  });

  it("converts origin (0, 0)", () => {
    const result = normalizedToPixel([0, 0], iphone16);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("converts bottom-right (1000, 1000)", () => {
    const result = normalizedToPixel([1000, 1000], iphone16);
    expect(result.x).toBe(393);
    expect(result.y).toBe(852);
  });

  it("works with iPhone 16 Pro Max", () => {
    const result = normalizedToPixel([500, 500], iphone16ProMax);
    expect(result.x).toBe(220);
    expect(result.y).toBe(478);
  });

  it("works with iPhone SE", () => {
    const result = normalizedToPixel([500, 500], iphoneSE);
    expect(result.x).toBe(188);
    expect(result.y).toBe(334);
  });

  it("rounds to nearest integer", () => {
    const result = normalizedToPixel([333, 666], iphone16);
    expect(result.x).toBe(131);
    expect(result.y).toBe(567);
  });
});
