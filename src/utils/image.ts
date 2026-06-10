import type { ScreenInfo } from "../core/types.js";

/** Convert VLM normalized coordinates (0-1000) to pixel coordinates */
export function normalizedToPixel(
  coord: [number, number],
  screen: ScreenInfo,
): { x: number; y: number } {
  return {
    x: Math.round((coord[0] / 1000) * screen.width),
    y: Math.round((coord[1] / 1000) * screen.height),
  };
}

/** Compress screenshot for VLM input (reduce token usage) */
export function screenshotToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}
