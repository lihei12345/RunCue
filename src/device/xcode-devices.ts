import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { DeviceInfo, RuntimePlatform } from "../core/types.js";

const exec = promisify(execCb);
const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export interface XcodeDeviceInfo extends DeviceInfo {
  runtimePlatform: RuntimePlatform;
}

export async function listXcodeDevices(): Promise<XcodeDeviceInfo[]> {
  const { stdout } = await exec("xcrun xctrace list devices", { timeout: 10_000 });
  return parseXcodeDevices(stdout);
}

export function parseXcodeDevices(output: string): XcodeDeviceInfo[] {
  const devices: XcodeDeviceInfo[] = [];
  let section = "";

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^==\s*(.+?)\s*==$/);
    if (heading) {
      section = heading[1].toLowerCase();
      continue;
    }

    const parsed = parseDeviceLine(line);
    if (!parsed) continue;

    if (section === "simulators") {
      if (isWatchDevice(parsed.name)) continue;
      devices.push({
        ...parsed,
        platform: "ios",
        runtimePlatform: "ios-simulator",
        state: "unknown",
      });
    } else if (section === "devices") {
      if (isMacHost(parsed.id) || isWatchDevice(parsed.name)) continue;
      devices.push({
        ...parsed,
        platform: "ios",
        runtimePlatform: "ios-device",
        state: "unknown",
      });
    } else if (section === "devices offline") {
      if (isWatchDevice(parsed.name)) continue;
      devices.push({
        ...parsed,
        platform: "ios",
        runtimePlatform: "ios-device",
        state: "shutdown",
      });
    }
  }

  return devices;
}

export async function resolveXcodeDevice(
  deviceId: string,
  platform: RuntimePlatform,
): Promise<XcodeDeviceInfo | undefined> {
  if (UUID_RE.test(deviceId)) {
    return {
      id: deviceId,
      name: deviceId,
      platform: "ios",
      runtimePlatform: platform,
      state: "unknown",
    };
  }

  const devices = await listXcodeDevices();
  return devices.find(
    (device) =>
      device.runtimePlatform === platform &&
      (device.id === deviceId || device.name === deviceId),
  );
}

export function xcodeDestinationFor(device: XcodeDeviceInfo | undefined, requestedId: string): string {
  if (device?.id && UUID_RE.test(device.id)) return `id=${device.id}`;
  if (UUID_RE.test(requestedId)) return `id=${requestedId}`;
  return `name=${requestedId}`;
}

function parseDeviceLine(line: string): Pick<XcodeDeviceInfo, "id" | "name" | "runtime"> | undefined {
  const match = line.match(/^(.*)\s+\(([^()]+)\)\s*$/);
  if (!match) return undefined;

  const beforeId = match[1].trim();
  const id = match[2].trim();
  const runtimeMatch = beforeId.match(/^(.*)\s+\(([^()]+)\)\s*$/);

  if (runtimeMatch) {
    return {
      name: runtimeMatch[1].trim(),
      runtime: runtimeMatch[2].trim(),
      id,
    };
  }

  return {
    name: beforeId,
    id,
  };
}

function isWatchDevice(name: string): boolean {
  return /\bwatch\b/i.test(name);
}

function isMacHost(id: string): boolean {
  return UUID_RE.test(id);
}
