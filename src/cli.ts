#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig, getProviderConfig, saveConfig } from "./utils/config.js";
import { setVerbose, setStderrOnly } from "./utils/logger.js";
import { createDeviceAdapter } from "./device/factory.js";
import { WDAManager } from "./device/wda-manager.js";
import { listXcodeDevices } from "./device/xcode-devices.js";
import { CloudAPIAdapter, analyzeScreenshot, analyzeViewTree } from "./vlm/cloud-api.js";
import { runAgentLoop } from "./core/agent-loop.js";
import { createMCPServer } from "./mcp/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs/promises";
import { resolveWDAConfig } from "./utils/config.js";
import type { RuntimePlatform } from "./core/types.js";


const program = new Command();

program
  .name("runcue")
  .description(
    "Developer UI navigation tool — run business flows with a single command",
  )
  .version("0.1.0");

// ── run ──
program
  .command("run")
  .description("Execute a multi-step UI task autonomously")
  .argument("<task>", "Task description in natural language")
  .option("-d, --device <id>", "Device UDID or simulator name")
  .option("--platform <platform>", "Runtime platform: ios-simulator|ios-device")
  .option("--bundle-id <id>", "Target app bundle id (required with --fresh-app)")
  .option("--fresh-app", "Terminate and relaunch --bundle-id before running the task", false)
  .option("-m, --model <name>", "VLM model name")
  .option("-p, --provider <name>", "VLM provider name")
  .option("--max-steps <n>", "Max steps", "10")
  .option("--timeout <seconds>", "Overall timeout in seconds (default: 120, 0=none)")
  .option("--hints <hints...>", "Domain-specific hints for the VLM (e.g., app navigation tips)")
  .option("--dry-run", "Analyze only, don't execute", false)
  .option("-v, --verbose", "Verbose output", false)
  .option("-o, --output <format>", "Output format: text|json", "text")
  .action(async (task, opts) => {
    setVerbose(opts.verbose);
    if (opts.freshApp && !opts.bundleId) {
      console.error("--fresh-app requires --bundle-id because WDA needs a concrete app to terminate and relaunch.");
      console.error("Example: runcue run \"Open Maps and search for Walmart\" --device <simulator> --bundle-id com.apple.Maps --fresh-app");
      process.exit(1);
    }

    const config = await loadConfig();
    const providerConfig = getProviderConfig(config, opts.provider);
    if (opts.model) providerConfig.model = opts.model;

    const device = createDeviceAdapter({
      config,
      deviceId: opts.device,
      platform: opts.platform as RuntimePlatform | undefined,
      bundleId: opts.bundleId,
    });
    if (opts.freshApp) {
      await device.resetApp();
    }
    const vlm = new CloudAPIAdapter(providerConfig);

    const result = await runAgentLoop(device, vlm, {
      task,
      maxSteps: parseInt(opts.maxSteps, 10),
      stepDelay: config.stepDelay,
      verbose: opts.verbose,
      inputMode: providerConfig.inputMode,
      hints: opts.hints,
      timeout: opts.timeout != null ? parseInt(opts.timeout, 10) * 1000 : undefined,
    });

    if (opts.output === "json") {
      // Structured JSON output for agent consumption
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
      if (opts.verbose) {
        output.history = result.history;
      }
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(
        `\n${result.success ? "✓" : "✗"} ${result.message} (${result.steps} steps)`,
      );
      if (!result.success && result.suggestion) {
        console.log(`  Suggestion: ${result.suggestion}`);
      }
    }

    process.exit(result.success ? 0 : 1);
  });

// ── screenshot ──
program
  .command("screenshot")
  .description("Capture current screen")
  .option("-d, --device <id>", "Device UDID or simulator name")
  .option("--platform <platform>", "Runtime platform: ios-simulator|ios-device")
  .option("--bundle-id <id>", "App bundle id (recommended for WDA)")
  .option("-o, --output <path>", "Output file path", "screenshot.png")
  .action(async (opts) => {
    const config = await loadConfig();
    const device = createDeviceAdapter({
      config,
      deviceId: opts.device,
      platform: opts.platform as RuntimePlatform | undefined,
      bundleId: opts.bundleId,
    });
    const buffer = await device.screenshot();
    await fs.writeFile(opts.output, buffer);
    console.log(`Screenshot saved to ${opts.output}`);
  });

// ── check ──
program
  .command("check")
  .description("Analyze current screen state with VLM")
  .argument("<question>", "Question about the current screen")
  .option("-d, --device <id>", "Device UDID or simulator name")
  .option("--platform <platform>", "Runtime platform: ios-simulator|ios-device")
  .option("--bundle-id <id>", "App bundle id (recommended for WDA)")
  .option("-p, --provider <name>", "VLM provider name")
  .option("-m, --model <name>", "VLM model name")
  .action(async (question, opts) => {
    const config = await loadConfig();
    const providerConfig = getProviderConfig(config, opts.provider);
    if (opts.model) providerConfig.model = opts.model;

    const device = createDeviceAdapter({
      config,
      deviceId: opts.device,
      platform: opts.platform as RuntimePlatform | undefined,
      bundleId: opts.bundleId,
    });
    let answer: string;
    try {
      const viewTree = await device.getViewTree();
      answer = await analyzeViewTree(providerConfig, viewTree, question);
    } catch {
      const screenshot = await device.screenshot();
      answer = await analyzeScreenshot(providerConfig, screenshot, question);
    }
    console.log(answer);
  });

// ── tap ──
program
  .command("tap")
  .description("Tap at coordinates (for debugging)")
  .argument("<x>", "X coordinate (pixels)")
  .argument("<y>", "Y coordinate (pixels)")
  .option("-d, --device <id>", "Device UDID or simulator name")
  .option("--platform <platform>", "Runtime platform: ios-simulator|ios-device")
  .option("--bundle-id <id>", "App bundle id (recommended for WDA)")
  .action(async (x, y, opts) => {
    const config = await loadConfig();
    const device = createDeviceAdapter({
      config,
      deviceId: opts.device,
      platform: opts.platform as RuntimePlatform | undefined,
      bundleId: opts.bundleId,
    });
    await device.tap(parseInt(x, 10), parseInt(y, 10));
    console.log(`Tapped at (${x}, ${y})`);
  });

// ── swipe ──
program
  .command("swipe")
  .description("Swipe between coordinates (for debugging)")
  .argument("<x1>", "Start X")
  .argument("<y1>", "Start Y")
  .argument("<x2>", "End X")
  .argument("<y2>", "End Y")
  .option("-d, --device <id>", "Device UDID or simulator name")
  .option("--platform <platform>", "Runtime platform: ios-simulator|ios-device")
  .option("--bundle-id <id>", "App bundle id (recommended for WDA)")
  .action(async (x1, y1, x2, y2, opts) => {
    const config = await loadConfig();
    const device = createDeviceAdapter({
      config,
      deviceId: opts.device,
      platform: opts.platform as RuntimePlatform | undefined,
      bundleId: opts.bundleId,
    });
    await device.swipe(
      parseInt(x1, 10),
      parseInt(y1, 10),
      parseInt(x2, 10),
      parseInt(y2, 10),
    );
    console.log(`Swiped from (${x1},${y1}) to (${x2},${y2})`);
  });

// ── type ──
program
  .command("type")
  .description("Type text (for debugging)")
  .argument("<text>", "Text to type")
  .option("-d, --device <id>", "Device UDID or simulator name")
  .option("--platform <platform>", "Runtime platform: ios-simulator|ios-device")
  .option("--bundle-id <id>", "App bundle id (recommended for WDA)")
  .action(async (text, opts) => {
    const config = await loadConfig();
    const device = createDeviceAdapter({
      config,
      deviceId: opts.device,
      platform: opts.platform as RuntimePlatform | undefined,
      bundleId: opts.bundleId,
    });
    await device.typeText(text);
    console.log(`Typed: ${text}`);
  });

// ── devices ──
program
  .command("devices")
  .description("List available iOS devices and simulators visible to Xcode")
  .action(async (opts) => {
    const config = await loadConfig();
    void opts;
    const manager = new WDAManager({
      deviceId: config.defaultDevice,
      platform: config.device.defaultPlatform,
      config: resolveWDAConfig(config),
    });
    const ready = await manager.status();
    console.log(`WDA endpoint: ${manager.endpoint} (${ready ? "ready" : "not ready"})`);

    const devices = await listXcodeDevices();
    if (devices.length === 0) {
      console.log("No devices found");
      return;
    }
    for (const d of devices) {
      const unavailable = d.state === "shutdown" ? " (offline)" : "";
      console.log(`${d.name}${unavailable}  ${d.id}  ${d.runtimePlatform}  ${d.runtime ?? ""}`);
    }
  });

// ── config ──
const configCmd = program
  .command("config")
  .description("Configuration management");

configCmd
  .command("list")
  .description("Show current configuration")
  .action(async () => {
    const config = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command("set")
  .description("Set a configuration value")
  .argument("<key>", "Config key (e.g. provider, apiKey, device)")
  .argument("<value>", "Config value")
  .action(async (key, value) => {
    const config = await loadConfig();
    switch (key) {
      case "provider":
        config.vlm.default = value;
        break;
      case "device":
        config.defaultDevice = value;
        break;
      case "platform":
        if (value !== "ios-simulator" && value !== "ios-device") {
          console.error("platform must be ios-simulator or ios-device");
          process.exit(1);
        }
        config.device.defaultPlatform = value;
        break;
      case "maxSteps":
        config.maxSteps = parseInt(value, 10);
        break;
      case "stepDelay":
        config.stepDelay = parseInt(value, 10);
        break;
      default:
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
    }
    await saveConfig(config);
    console.log(`Set ${key} = ${value}`);
  });

// ── doctor ──
program
  .command("doctor")
  .description("Diagnose RunCue WDA setup")
  .option("-d, --device <id>", "Device UDID or simulator name")
  .option("--platform <platform>", "Runtime platform: ios-simulator|ios-device")
  .option("-o, --output <format>", "Output format: text|json", "text")
  .action(async (opts) => {
    const config = await loadConfig();
    const platform = (opts.platform ?? config.device.defaultPlatform) as RuntimePlatform;
    const deviceId = opts.device ?? config.defaultDevice;

    const manager = new WDAManager({
      deviceId,
      platform,
      config: resolveWDAConfig(config),
    });
    const result = await manager.doctor();
    if (opts.output === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`RunCue doctor: ${result.ok ? "ok" : "issues found"} (WDA)`);
      for (const check of result.checks) {
        console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.message}`);
        if (!check.ok && check.fix) console.log(`  Fix: ${check.fix}`);
      }
    }
    process.exit(result.ok ? 0 : 1);
  });

// ── mcp ──
program
  .command("mcp")
  .description("Start RunCue MCP server (stdio transport)")
  .action(async () => {
    setStderrOnly(true);
    const server = createMCPServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  });

program.parse();
