import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  runcueCheckSchema,
  runcueDoctorSchema,
  runcueRunSchema,
} from "../../src/mcp/schemas.js";

describe("MCP tool schemas", () => {
  const runSchema = z.object(runcueRunSchema);
  const checkSchema = z.object(runcueCheckSchema);
  const doctorSchema = z.object(runcueDoctorSchema);

  it("accepts WDA runcue_run fields", () => {
    const result = runSchema.parse({
      task: "login",
      deviceId: "SIM-UDID",
      platform: "ios-simulator",
      bundleId: "com.example.app",
      maxSteps: 12,
      hints: ["Use the test account"],
      timeout: 120,
    });

    expect(result.platform).toBe("ios-simulator");
  });

  it("accepts runcue_check platform", () => {
    const result = checkSchema.parse({
      question: "What page is this?",
      deviceId: "SIM-UDID",
      platform: "ios-simulator",
    });

    expect(result.platform).toBe("ios-simulator");
  });

  it("accepts runcue_doctor with optional fields", () => {
    expect(doctorSchema.parse({})).toEqual({});
    expect(
      doctorSchema.parse({
        deviceId: "SIM-UDID",
        platform: "ios-device",
      }),
    ).toMatchObject({ platform: "ios-device" });
  });
});
