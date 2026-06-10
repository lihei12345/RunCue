import { z } from "zod";

export const runcueRunSchema = {
  task: z
    .string()
    .describe(
      "Task description in natural language. Be specific: include credentials, target pages, expected outcomes, and known non-standard interaction rules. For complex or stuck flows, include exact UI clues such as which label/card advances the flow.",
    ),
  deviceId: z
    .string()
    .describe("Device UDID or simulator name. Required. Must match the simulator/device prepared by XcodeBuildMCP or returned by runcue_devices. Do not use 'booted'."),
  platform: z
    .enum(["ios-simulator", "ios-device"])
    .optional()
    .describe("Runtime platform. Optional. Defaults to config.device.defaultPlatform; pass ios-simulator for simulators and ios-device for physical devices. ios-device requires WDA signing setup."),
  bundleId: z
    .string()
    .optional()
    .describe("Target app bundle id, e.g. com.apple.Maps. Required when freshApp=true; strongly recommended for system apps and multi-app WDA sessions."),
  freshApp: z
    .boolean()
    .optional()
    .describe("Terminate and relaunch bundleId before running. Requires bundleId. Use for system apps or independent tasks when old app state can pollute the flow. Do not use when XcodeBuildMCP intentionally prepared a deep app state."),
  maxSteps: z
    .number()
    .optional()
    .describe("Maximum operation steps (default: 10). Increase for complex flows."),
  hints: z
    .array(z.string())
    .optional()
    .describe("Domain-specific hints for the VLM. Use for reusable app facts, non-standard wording, hidden controls, or retries after a stuck/looping run. Pass suggestedHint from previous failures plus any stored hints for this app."),
  timeout: z
    .number()
    .optional()
    .describe("Overall timeout in seconds (default: 120). Set to 0 to disable."),
};

export const runcueCheckSchema = {
  question: z
    .string()
    .describe(
      "Question about the current screen, e.g. 'What page is this?' or 'Is login successful?'",
    ),
  deviceId: z
    .string()
    .describe("Device UDID or simulator name. Required. Must match the simulator/device prepared by XcodeBuildMCP or returned by runcue_devices."),
  platform: z
    .enum(["ios-simulator", "ios-device"])
    .optional()
    .describe("Runtime platform. Optional. Defaults to config.device.defaultPlatform; pass ios-simulator for simulators and ios-device for physical devices."),
  bundleId: z
    .string()
    .optional()
    .describe("Target app bundle id. Recommended for WDA sessions so RunCue can bind the session to the intended app."),
};

export const runcueDoctorSchema = {
  deviceId: z
    .string()
    .optional()
    .describe("Device UDID or simulator name. Optional; defaults to RunCue config.defaultDevice."),
  platform: z
    .enum(["ios-simulator", "ios-device"])
    .optional()
    .describe("Runtime platform. Optional; defaults to config.device.defaultPlatform."),
};
