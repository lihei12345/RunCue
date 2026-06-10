import { spawn, exec as execCb, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimePlatform, WDAConfig } from "../core/types.js";
import { createLogger } from "../utils/logger.js";
import { resolveXcodeDevice, xcodeDestinationFor } from "./xcode-devices.js";

const exec = promisify(execCb);
const log = createLogger("wda-manager");
const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface WDAManagerOptions {
  deviceId: string;
  platform: RuntimePlatform;
  config: WDAConfig;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean;
  deviceId: string;
  platform: RuntimePlatform;
  endpoint: string;
  checks: DoctorCheck[];
}

export class WDAManager {
  readonly deviceId: string;
  readonly platform: RuntimePlatform;
  readonly config: WDAConfig;
  readonly endpoint: string;

  private process: ChildProcess | null = null;

  constructor(options: WDAManagerOptions) {
    this.deviceId = options.deviceId;
    this.platform = options.platform;
    this.config = options.config;
    this.endpoint = options.config.endpoint ?? "http://127.0.0.1:8100";
  }

  async status(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/status`, {
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureReady(): Promise<void> {
    if (await this.status()) return;

    if (this.config.bootstrapPolicy === "manual") {
      throw new Error(
        `WDA is not reachable at ${this.endpoint}. Start WDA manually or set wda.bootstrapPolicy=auto.`,
      );
    }

    const projectPath = resolveWDAProjectPath(this.config);
    if (!projectPath) {
      throw new Error(
        "WDA is not reachable and no bundled/configured WebDriverAgent.xcodeproj was found. Run runcue doctor for setup details.",
      );
    }

    await this.start();
    await this.waitUntilReady();
  }

  async start(): Promise<void> {
    const projectPath = resolveWDAProjectPath(this.config);
    if (!projectPath) {
      throw new Error("A configured or bundled WebDriverAgent.xcodeproj is required to auto-start WDA");
    }

    const resolvedDevice = await resolveXcodeDevice(this.deviceId, this.platform);
    const destinationTarget = xcodeDestinationFor(resolvedDevice, this.deviceId);
    const destination =
      this.platform === "ios-simulator"
        ? `platform=iOS Simulator,${destinationTarget}`
        : `platform=iOS,${destinationTarget}`;

    const args = [
      "-project",
      projectPath,
      "-scheme",
      this.config.scheme,
      "-destination",
      destination,
      "test",
    ];
    if (this.platform === "ios-device") {
      args.splice(args.length - 1, 0, "-allowProvisioningUpdates");
    }

    log.info(`Starting WDA: xcodebuild ${args.join(" ")}`);
    this.process = spawn("xcodebuild", args, {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        USE_PORT: String(new URL(this.endpoint).port || "8100"),
      },
    });
    this.process.unref();
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    this.process.kill("SIGTERM");
    this.process = null;
  }

  async waitUntilReady(): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.config.startupTimeoutMs) {
      if (await this.status()) return;
      await new Promise((resolve) => setTimeout(resolve, this.config.healthCheckIntervalMs));
    }
    throw new Error(`WDA did not become ready within ${this.config.startupTimeoutMs}ms`);
  }

  async doctor(): Promise<DoctorResult> {
    const checks: DoctorCheck[] = [];

    checks.push(await checkCommand("xcodebuild", "xcodebuild -version"));
    checks.push(await checkCommand("xcrun", "xcrun --version"));

    if (this.platform === "ios-simulator") {
      checks.push(await checkSimulator(this.deviceId));
    } else {
      checks.push(await checkPhysicalDevice(this.deviceId));
      checks.push(checkSigning(this.config));
    }

    const projectPath = resolveWDAProjectPath(this.config);
    if (projectPath) {
      checks.push(await checkPath("wda.projectPath", projectPath));
    } else {
      checks.push({
        name: "wda.projectPath",
        ok: Boolean(this.config.endpoint),
        message: this.config.endpoint
          ? "No WDA projectPath configured; using existing endpoint only."
          : "No WDA projectPath configured.",
        fix: "Run the packaged build, set wda.projectPath to WebDriverAgent.xcodeproj, or configure wda.endpoint.",
      });
    }

    const wdaStatus = await this.status();
    const canAutoStart = this.config.bootstrapPolicy === "auto" && Boolean(projectPath);
    checks.push({
      name: "wda.status",
      ok: wdaStatus || canAutoStart,
      message: wdaStatus
        ? `WDA is reachable at ${this.endpoint}.`
        : canAutoStart
          ? `WDA is not running at ${this.endpoint}; RunCue will auto-start it from ${projectPath}.`
          : `WDA is not reachable at ${this.endpoint}.`,
      fix: wdaStatus || canAutoStart
        ? undefined
        : "Configure bundled/configured wda.projectPath, or start WDA manually and set wda.endpoint.",
    });

    return {
      ok: checks.every((check) => check.ok),
      deviceId: this.deviceId,
      platform: this.platform,
      endpoint: this.endpoint,
      checks,
    };
  }
}

export function resolveWDAProjectPath(config: WDAConfig): string | undefined {
  if (config.projectPath) return config.projectPath;

  try {
    const packageJson = require.resolve("appium-webdriveragent/package.json");
    return path.join(path.dirname(packageJson), "WebDriverAgent.xcodeproj");
  } catch {
    // Fall through to vendored WDA.
  }

  return path.resolve(moduleDir, "../../vendor/appium-webdriveragent/WebDriverAgent.xcodeproj");
}

async function checkCommand(name: string, cmd: string): Promise<DoctorCheck> {
  try {
    const { stdout } = await exec(cmd, { timeout: 10_000 });
    return {
      name,
      ok: true,
      message: stdout.trim().split("\n")[0] || `${name} is available.`,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      message: `${name} is not available: ${err}`,
      fix: "Install full Xcode and ensure xcode-select points to it.",
    };
  }
}

async function checkPath(name: string, filePath: string): Promise<DoctorCheck> {
  try {
    await fs.access(filePath);
    return { name, ok: true, message: `${filePath} exists.` };
  } catch {
    return {
      name,
      ok: false,
      message: `${filePath} does not exist.`,
      fix: "Configure wda.projectPath to a valid WebDriverAgent.xcodeproj.",
    };
  }
}

async function checkSimulator(deviceId: string): Promise<DoctorCheck> {
  try {
    if (deviceId === "booted") {
      return {
        name: "simulator",
        ok: false,
        message: "'booted' is ambiguous in the WDA path.",
        fix: "Pass the simulator UDID or name used by XcodeBuildMCP build_run_sim.",
      };
    }

    const device = await resolveXcodeDevice(deviceId, "ios-simulator");
    if (device) {
      return {
        name: "simulator",
        ok: true,
        message: `${device.name} (${device.id}) is visible to xctrace.`,
      };
    }

    return {
      name: "simulator",
      ok: false,
      message: `Simulator not found: ${deviceId}`,
      fix: "Pass the simulator UDID used by XcodeBuildMCP build_run_sim.",
    };
  } catch (err) {
    return {
      name: "simulator",
      ok: false,
      message: `Failed to list simulators: ${err}`,
      fix: "Check Xcode simulator installation.",
    };
  }
}

async function checkPhysicalDevice(deviceId: string): Promise<DoctorCheck> {
  try {
    const device = await resolveXcodeDevice(deviceId, "ios-device");
    const found = Boolean(device && device.state !== "shutdown");
    return {
      name: "physical-device",
      ok: found,
      message: found
        ? `Physical device ${device?.name ?? deviceId} (${device?.id ?? deviceId}) is visible to xctrace.`
        : `Physical device ${deviceId} is not visible to xctrace.`,
      fix: found
        ? undefined
        : "Connect and unlock the device, trust this Mac, and enable Developer Mode.",
    };
  } catch (err) {
    return {
      name: "physical-device",
      ok: false,
      message: `Failed to list physical devices: ${err}`,
      fix: "Install full Xcode and check that the device is connected, trusted, unlocked, and Developer Mode is enabled.",
    };
  }
}

function checkSigning(config: WDAConfig): DoctorCheck {
  const teamId = config.signing?.teamId;
  const bundleIdPrefix = config.signing?.bundleIdPrefix;
  const ok = Boolean(teamId && bundleIdPrefix);
  return {
    name: "wda-signing",
    ok,
    message: ok
      ? `WDA signing configured for team ${teamId}.`
      : "WDA signing is not fully configured.",
    fix: ok
      ? undefined
      : "Set RUNCUE_WDA_TEAM_ID or wda.signing.teamId, and configure wda.signing.bundleIdPrefix.",
  };
}
