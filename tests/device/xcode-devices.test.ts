import { describe, expect, it } from "vitest";
import { parseXcodeDevices } from "../../src/device/xcode-devices.js";

describe("parseXcodeDevices", () => {
  it("keeps iOS targets and filters watch/mac entries", () => {
    const devices = parseXcodeDevices(`
== Devices ==
MacBook Pro (58652202-1897-5D8B-8D3E-EE1BB9A23C91)
Example iPhone (26.5) (00008120-000935363687C01E)

== Devices Offline ==
Example Apple Watch (11.3.1) (00008301-788E308A3CB8202E)

== Simulators ==
Apple Watch Series 10 (42mm) Simulator (11.5) (3F637337-AA64-49D4-84F3-07F1BCAE272E)
iPhone 17 Pro Simulator (26.5) (F4F39BE5-B415-459A-B5E2-1365626CA26B)
Example App Simulator (26.4.1) (E0237A81-4234-493C-B84D-5CF3EC673806)
`);

    expect(devices.map((device) => device.name)).toEqual([
      "Example iPhone",
      "iPhone 17 Pro Simulator",
      "Example App Simulator",
    ]);
    expect(devices.map((device) => device.runtimePlatform)).toEqual([
      "ios-device",
      "ios-simulator",
      "ios-simulator",
    ]);
  });
});
