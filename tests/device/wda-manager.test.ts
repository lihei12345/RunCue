import { describe, expect, it } from "vitest";
import { accessSync } from "node:fs";
import { resolveWDAProjectPath } from "../../src/device/wda-manager.js";
import type { WDAConfig } from "../../src/core/types.js";

function config(overrides: Partial<WDAConfig> = {}): WDAConfig {
  return {
    scheme: "WebDriverAgentRunner",
    bootstrapPolicy: "auto",
    reuseSession: true,
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 10_000,
    healthCheckIntervalMs: 5_000,
    autoRestart: true,
    ...overrides,
  };
}

describe("resolveWDAProjectPath", () => {
  it("uses configured projectPath first", () => {
    expect(resolveWDAProjectPath(config({ projectPath: "/tmp/WDA.xcodeproj" }))).toBe(
      "/tmp/WDA.xcodeproj",
    );
  });

  it("falls back to the vendored WebDriverAgent project", () => {
    const projectPath = resolveWDAProjectPath(config());

    expect(projectPath).toContain("vendor/appium-webdriveragent/WebDriverAgent.xcodeproj");
    accessSync(projectPath!);
  });
});
