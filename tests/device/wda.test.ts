import { afterEach, describe, expect, it, vi } from "vitest";
import type { WDAConfig } from "../../src/core/types.js";
import { WDADeviceAdapter } from "../../src/device/wda.js";

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

function config(): WDAConfig {
  return {
    scheme: "WebDriverAgentRunner",
    bootstrapPolicy: "auto",
    reuseSession: true,
    startupTimeoutMs: 60_000,
    requestTimeoutMs: 10_000,
    healthCheckIntervalMs: 5_000,
    autoRestart: true,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("WDADeviceAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fresh reset terminates from a control session and reuses one app session", async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });

      if (url.endsWith("/status")) {
        return jsonResponse({ value: { ready: true } });
      }
      if (url.endsWith("/session") && method === "POST") {
        const hasBundleId = Boolean(body?.capabilities?.alwaysMatch?.bundleId);
        return jsonResponse({
          value: { sessionId: hasBundleId ? "app-session" : "control-session" },
        });
      }
      if (url.endsWith("/session/control-session/wda/apps/terminate") && method === "POST") {
        return jsonResponse({ value: true });
      }
      if (url.endsWith("/session/control-session") && method === "DELETE") {
        return jsonResponse({ value: null });
      }
      if (url.endsWith("/session/app-session/source?format=json")) {
        return jsonResponse({
          value: {
            type: "Application",
            label: "Maps",
            rect: { x: 0, y: 0, width: 440, height: 956 },
          },
        });
      }

      return jsonResponse({ value: null }, 404);
    }));

    const adapter = new WDADeviceAdapter({
      deviceId: "SIM-UDID",
      platform: "ios-simulator",
      bundleId: "com.apple.Maps",
      config: config(),
    });

    await adapter.resetApp();
    await adapter.getViewTree();

    const sessionCreates = calls.filter((call) => call.url.endsWith("/session") && call.method === "POST");
    expect(sessionCreates).toHaveLength(2);
    expect(sessionCreates[0].body).not.toMatchObject({
      capabilities: { alwaysMatch: { bundleId: "com.apple.Maps" } },
    });
    expect(sessionCreates[1].body).toMatchObject({
      capabilities: { alwaysMatch: { bundleId: "com.apple.Maps" } },
    });
    expect(calls.some((call) => call.url.includes("/wda/apps/launch"))).toBe(false);
  });
});
