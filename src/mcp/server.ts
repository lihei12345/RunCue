import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, getProviderConfig } from "../utils/config.js";
import { createDeviceAdapter } from "../device/factory.js";
import { WDAManager } from "../device/wda-manager.js";
import { listXcodeDevices } from "../device/xcode-devices.js";
import { CloudAPIAdapter, analyzeScreenshot, analyzeViewTree } from "../vlm/cloud-api.js";
import { runAgentLoop } from "../core/agent-loop.js";
import { resolveWDAConfig } from "../utils/config.js";
import type { RuntimePlatform } from "../core/types.js";
import { runcueCheckSchema, runcueDoctorSchema, runcueRunSchema } from "./schemas.js";

export function createMCPServer(): McpServer {
  const server = new McpServer({
    name: "runcue",
    version: "0.1.0",
  });

  // ── runcue_run ──
  server.tool(
    "runcue_run",
    `Execute a multi-step UI task on an iOS Simulator or physical iOS device autonomously.

RunCue uses WDA (WebDriverAgent) for observation and actions, then drives an agent loop (view tree/screenshot → VLM analysis → WDA action → repeat) until the task completes or fails.

**When to use**: After build_and_run succeeds and the app is running, use this to navigate UI flows — login, registration, form filling, navigating to deep pages, reproducing bug scenarios.

**When NOT to use**: Do not use for building/deploying apps (use XcodeBuildMCP), capturing logs (use XcodeBuildMCP start_log_capture), or modifying code.

**Required parameters**:
- deviceId: Required. Use the exact simulator/device name or UDID from XcodeBuildMCP/runcue_devices. Do not pass "booted".

**Important optional parameters**:
- platform: Defaults to RunCue config. Pass ios-simulator for simulators or ios-device for physical devices when there is any ambiguity.
- bundleId: Required when freshApp=true. Strongly recommended for system apps and multi-app sessions, e.g. com.apple.Maps.
- freshApp: If true, RunCue terminates and relaunches bundleId before the task. Use for clean independent tasks where old app state can pollute navigation. Do not use if XcodeBuildMCP intentionally prepared a deep app state.

**Task description tips**: Be specific — include credentials, target pages, expected outcomes, and any known non-standard interaction rule. E.g. "Login with test@test.com password 123456, navigate to order detail page" rather than just "login".

**Complex or non-standard UI guidance for coding agents**:
- If the app flow has unusual wording, hidden entry points, custom controls, WebView/SwiftUI/self-drawn UI, or differs from common app conventions, include the exact operational clue in task or hints.
- If a previous run stalls, loops, taps the wrong element, or cannot infer the next action, retry with a more explicit hint based on the observed screen and lastActions instead of only repeating the same task.
- Prefer reusable product facts over coordinate instructions. Good: "On Apple Maps route cards, start navigation by tapping the Route Steps list item when there is no normal Start Navigation button." Avoid hardcoding raw coordinates unless debugging.
- For system apps or apps with strong persisted state, combine freshApp=true with a precise task that disambiguates old suggestions/history from the desired goal.

Example for a non-standard map flow: "Open Maps, search for the nearest Walmart, and start navigation. In Apple Maps, if there is no normal Start Navigation button, tap the Route Steps item in the route card list to enter navigation."

**Output**:
- On success: returns message, step count, and finalViewTree (accessibility tree of the final screen — use this to verify the result or plan next actions).
- On failure: returns failureReason (validation_error/stalled/max_steps/action_error/vlm_error/device_error), suggestion, lastActions, lastThinking, suggestedHint, and finalViewTree when available.

**Hints lifecycle (STORE → APPLY → EXPIRE)**:
RunCue uses hints to inject domain-specific knowledge into the VLM. Follow this lifecycle:
1. **STORE**: When runcue_run fails, check the suggestedHint field — it contains an auto-generated hint based on the failure pattern. Save useful hints for this app (e.g. in your project context or memory).
2. **APPLY**: On retry or similar tasks, pass stored hints via the hints parameter. Combine suggestedHint with any previously stored hints.
3. **EXPIRE**: Hints may become stale after app UI changes. If a hint no longer helps (same failure with hint applied), discard it and generate a new one from the latest failure output.

**Workflow**: XcodeBuildMCP build_and_run → runcue_run → (on failure: read suggestedHint, store it, retry with hints) → XcodeBuildMCP screenshot/start_log_capture`,
    runcueRunSchema,
    async ({ task, deviceId, platform, bundleId, freshApp, maxSteps, hints, timeout }) => {
      try {
        if (freshApp && !bundleId) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  message: "freshApp requires bundleId because WDA needs a concrete app to terminate and relaunch.",
                  failureReason: "validation_error",
                  suggestion: "Pass bundleId for the target app, for example {\"bundleId\":\"com.apple.Maps\",\"freshApp\":true}. Omit freshApp when XcodeBuildMCP already prepared the desired app state.",
                }, null, 2),
              },
            ],
          };
        }

        const config = await loadConfig();
        const providerConfig = getProviderConfig(config);

        const device = createDeviceAdapter({
          config,
          deviceId: deviceId ?? config.defaultDevice,
          platform: platform as RuntimePlatform | undefined,
          bundleId,
        });
        if (freshApp) {
          await device.resetApp();
        }
        const vlm = new CloudAPIAdapter(providerConfig);

        const result = await runAgentLoop(device, vlm, {
          task,
          maxSteps: maxSteps ?? config.maxSteps,
          stepDelay: config.stepDelay,
          verbose: false,
          inputMode: providerConfig.inputMode,
          hints,
          timeout: timeout != null ? timeout * 1000 : undefined,
        });

        // Build concise output for the calling agent
        const output: Record<string, unknown> = {
          success: result.success,
          message: result.message,
          steps: result.steps,
        };
        if (result.finalViewTree) {
          output.finalViewTree = result.finalViewTree;
        }
        if (!result.success) {
          output.failureReason = result.failureReason;
          output.suggestion = result.suggestion;
          if (result.lastActions) output.lastActions = result.lastActions;
          if (result.lastThinking) output.lastThinking = result.lastThinking;
          if (result.suggestedHint) output.suggestedHint = result.suggestedHint;
          if (result.artifacts) output.artifacts = result.artifacts;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: `RunCue internal error: ${err}`,
                failureReason: "device_error",
                suggestion: "An unexpected error occurred. Check if the simulator is running and the VLM API key is configured.",
              }, null, 2),
            },
          ],
        };
      }
    },
  );

  // ── runcue_check ──
  server.tool(
    "runcue_check",
    `Analyze the current UI state without performing any actions.

Returns both a VLM-generated text description and the raw accessibility tree (view tree) of the current screen. Use to verify results after runcue_run, check what page is displayed, or inspect UI elements before deciding next steps.

Parameters:
- deviceId: Required. Use the same simulator/device as the app under test. Do not pass "booted".
- platform: Optional. Defaults to RunCue config; pass ios-simulator or ios-device when ambiguous.
- bundleId: Optional but recommended so WDA binds to the intended app session.

The viewTree is a JSON array of elements with id, type, label, value, and frame — you can use it to understand exact UI structure.`,
    runcueCheckSchema,
    async ({ question, deviceId, platform, bundleId }) => {
      try {
        const config = await loadConfig();
        const providerConfig = getProviderConfig(config);
        const device = createDeviceAdapter({
          config,
          deviceId: deviceId ?? config.defaultDevice,
          platform: platform as RuntimePlatform | undefined,
          bundleId,
        });

        let viewTree: string | undefined;
        let answer: string;
        try {
          viewTree = await device.getViewTree();
          answer = await analyzeViewTree(providerConfig, viewTree, question);
        } catch {
          const screenshot = await device.screenshot();
          answer = await analyzeScreenshot(
            providerConfig,
            screenshot,
            question,
          );
        }

        const output: Record<string, unknown> = { answer };
        if (viewTree) {
          output.viewTree = viewTree;
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: `RunCue check failed: ${err}` }, null, 2) }],
        };
      }
    },
  );

  // ── runcue_devices ──
  server.tool(
    "runcue_devices",
    "List iOS devices and simulators visible to Xcode. Use this first when you do not know the exact deviceId. Pass the returned device id or name to runcue_run/runcue_check; do not use the ambiguous value \"booted\".",
    {},
    async () => {
      try {
        const config = await loadConfig();
        const devices = await listXcodeDevices();
        const manager = new WDAManager({
          deviceId: config.defaultDevice,
          platform: config.device.defaultPlatform,
          config: resolveWDAConfig(config),
        });
        const ready = await manager.status();
        const summary = devices.length > 0
          ? `${devices.length} device(s) visible to Xcode`
          : "No devices visible to Xcode";

        return {
          content: [
            {
              type: "text" as const,
              text: `${summary}\n\nWDA endpoint: ${manager.endpoint} (${ready ? "ready" : "not ready"})\n\nAll devices:\n${JSON.stringify(devices, null, 2)}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Failed to list devices: ${err}` }],
        };
      }
    },
  );

  // ── runcue_doctor ──
  server.tool(
    "runcue_doctor",
    "Diagnose RunCue WDA setup for a simulator or physical iOS device. Use when runcue_run fails with device, signing, or WDA startup issues.",
    runcueDoctorSchema,
    async ({ deviceId, platform }) => {
      try {
        const config = await loadConfig();
        const resolvedPlatform = (platform ?? config.device.defaultPlatform) as RuntimePlatform;
        const resolvedDeviceId = deviceId ?? config.defaultDevice;

        const manager = new WDAManager({
          deviceId: resolvedDeviceId,
          platform: resolvedPlatform,
          config: resolveWDAConfig(config),
        });
        const result = await manager.doctor();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                error: `RunCue doctor failed: ${err}`,
              }, null, 2),
            },
          ],
        };
      }
    },
  );

  return server;
}
