import type {
  Config,
  DeviceAdapter,
  RuntimePlatform,
} from "../core/types.js";
import { resolveWDAConfig } from "../utils/config.js";
import { WDADeviceAdapter } from "./wda.js";

export interface CreateDeviceOptions {
  deviceId?: string;
  platform?: RuntimePlatform;
  bundleId?: string;
  config: Config;
}

export function createDeviceAdapter(options: CreateDeviceOptions): DeviceAdapter {
  const deviceId = options.deviceId ?? options.config.defaultDevice;
  const platform = options.platform ?? options.config.device.defaultPlatform;

  if (!deviceId) {
    throw new Error("Device UDID or simulator name is required for the WDA path. Pass --device or configure defaultDevice.");
  }
  if (deviceId === "booted") {
    throw new Error("'booted' is ambiguous in the WDA path. Pass the simulator UDID or name used by XcodeBuildMCP.");
  }

  return new WDADeviceAdapter({
    deviceId,
    platform,
    bundleId: options.bundleId,
    config: resolveWDAConfig(options.config),
  });
}
