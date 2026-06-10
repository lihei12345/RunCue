import { describe, it, expect } from "vitest";
import { parseVLMOutput, extractXMLTag, parseVerifierOutput } from "../../src/vlm/cloud-api.js";

describe("extractXMLTag", () => {
  it("extracts a simple tag", () => {
    const result = extractXMLTag("<thought>hello</thought>", "thought");
    expect(result?.content).toBe("hello");
  });

  it("extracts tag with attributes", () => {
    const result = extractXMLTag('<complete success="true">done</complete>', "complete");
    expect(result?.content).toBe("done");
    expect(result?.attrs).toContain("success");
  });

  it("finds last occurrence (backward search)", () => {
    const text = '<thought>first</thought> some text <thought>second</thought>';
    const result = extractXMLTag(text, "thought");
    expect(result?.content).toBe("second");
  });

  it("handles half-open tag (no closing tag)", () => {
    const result = extractXMLTag("<action>tap", "action");
    expect(result?.content).toBe("tap");
  });

  it("returns null for missing tag", () => {
    expect(extractXMLTag("no tags here", "action")).toBeNull();
  });
});

describe("parseVLMOutput — XML format", () => {
  it("parses a normal tap action", () => {
    const raw = '<thought>click button</thought>\n<action>tap</action>\n<param>{"id": 5}</param>';
    const result = parseVLMOutput(raw);
    expect(result.thinking).toBe("click button");
    expect(result.action).toEqual({ type: "tap", elementId: 5 });
    expect(result.parseFailure).toBe(false);
  });

  it("parses a semantic tap target", () => {
    const raw = '<thought>tap settings</thought>\n<action>tap</action>\n<param>{"target": "Settings button"}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap_target", target: "Settings button" });
    expect(result.parseFailure).toBe(false);
  });

  it("parses a type action", () => {
    const raw = '<thought>input email</thought>\n<action>type</action>\n<param>{"text": "test@test.com"}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "type", text: "test@test.com" });
  });

  it("parses a swipe action", () => {
    const raw = '<thought>scroll down</thought>\n<action>swipe</action>\n<param>{"direction": "down"}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "swipe", direction: "down" });
  });

  it("parses swipe left", () => {
    const raw = '<thought>swipe left</thought>\n<action>swipe</action>\n<param>{"direction": "left"}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "swipe", direction: "left" });
  });

  it("parses swipe on a specific element", () => {
    const raw = '<thought>swipe to delete</thought>\n<action>swipe</action>\n<param>{"direction": "left", "id": 3}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "swipe", direction: "left", elementId: 3 });
  });

  it("parses swipe on a semantic target", () => {
    const raw = '<thought>swipe row</thought>\n<action>swipe</action>\n<param>{"direction": "left", "target": "first file row"}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "swipe", direction: "left", target: "first file row" });
  });

  it("parses a complete (finish) action", () => {
    const raw = '<thought>done</thought>\n<complete success="true">Task complete</complete>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "finish", message: "Task complete" });
  });

  it("parses a failed complete", () => {
    const raw = '<thought>cannot proceed</thought>\n<complete success="false">Button not found</complete>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "finish", message: "Button not found" });
  });

  it("parses home action", () => {
    const raw = '<thought>go home</thought>\n<action>home</action>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "home" });
  });

  it("parses press_enter action", () => {
    const raw = '<thought>submit the URL</thought>\n<action>press_enter</action>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "press_enter" });
  });

  it("treats 'enter' as alias for 'press_enter'", () => {
    const raw = '<thought>confirm</thought>\n<action>enter</action>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "press_enter" });
  });

  it("treats 'return' as alias for 'press_enter'", () => {
    const raw = '<thought>submit</thought>\n<action>return</action>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "press_enter" });
  });

  it("parses wait action", () => {
    const raw = '<thought>page loading</thought>\n<action>wait</action>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(false);
  });

  it("parses long_press action", () => {
    const raw = '<thought>long press</thought>\n<action>long_press</action>\n<param>{"id": 8}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "long_press", elementId: 8 });
  });

  it("parses semantic long_press target", () => {
    const raw = '<thought>open context menu</thought>\n<action>long_press</action>\n<param>{"target": "first message from Alice"}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "long_press_target", target: "first message from Alice" });
  });

  it("parses tap_xy coordinate action", () => {
    const raw = '<thought>tap close button visible in screenshot</thought>\n<action>tap_xy</action>\n<param>{"x": 30, "y": 120}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap_xy", x: 30, y: 120 });
    expect(result.parseFailure).toBe(false);
  });

  it("parses long_press_xy coordinate action", () => {
    const raw = '<thought>long press on overlay element</thought>\n<action>long_press_xy</action>\n<param>{"x": 200, "y": 300}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "long_press_xy", x: 200, y: 300 });
    expect(result.parseFailure).toBe(false);
  });

  it("returns parseFailure when tap_xy is missing coordinates", () => {
    const raw = '<thought>tap</thought>\n<action>tap_xy</action>\n<param>{"x": 30}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
  });

  it("treats 'click' as alias for 'tap'", () => {
    const raw = '<thought>click button</thought>\n<action>click</action>\n<param>{"id": 3}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap", elementId: 3 });
  });

  // ── Conflict resolution ──

  it("action wins over complete when both present", () => {
    const raw = '<thought>keep going</thought>\n<action>tap</action>\n<param>{"id": 5}</param>\n<complete success="true">Done</complete>';
    const result = parseVLMOutput(raw);
    expect(result.action.type).toBe("tap");
    expect(result.parseFailure).toBe(false);
  });

  // ── Edge cases ──

  it("handles <think> tags from Qwen3-VL", () => {
    const raw = '<think>\nLet me analyze...\n</think>\n<thought>click login</thought>\n<action>tap</action>\n<param>{"id": 7}</param>';
    const result = parseVLMOutput(raw);
    expect(result.thinking).toBe("click login");
    expect(result.action.type).toBe("tap");
  });

  it("handles XML wrapped in code fences", () => {
    const raw = '```xml\n<thought>click</thought>\n<action>tap</action>\n<param>{"id": 2}</param>\n```';
    const result = parseVLMOutput(raw);
    expect(result.action.type).toBe("tap");
  });

  it("returns parseFailure for empty output", () => {
    const result = parseVLMOutput("");
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
  });

  it("returns parseFailure for pure text with no tags or JSON", () => {
    const raw = "I cannot determine what to do next.";
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
  });

  it("returns parseFailure for unknown action type", () => {
    const raw = '<thought>hmm</thought>\n<action>double_tap</action>\n<param>{"id": 2}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
    expect(result.thinking).toContain("unknown action");
  });

  it("returns parseFailure when tap is missing id", () => {
    const raw = '<thought>click</thought>\n<action>tap</action>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
  });

  it("returns parseFailure when swipe has invalid direction", () => {
    const raw = '<thought>swipe</thought>\n<action>swipe</action>\n<param>{"direction": "diagonal"}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
  });

  it("handles half-open action tag", () => {
    const raw = '<thought>click it</thought>\n<action>home';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "home" });
  });

  it("handles tap with id=0", () => {
    const raw = '<thought>tap root</thought>\n<action>tap</action>\n<param>{"id": 0}</param>';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap", elementId: 0 });
    expect(result.parseFailure).toBe(false);
  });
});

describe("parseVLMOutput — legacy JSON fallback", () => {
  it("parses legacy JSON tap action", () => {
    const raw = '{"thought": "click button", "action": "tap", "id": 5}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap", elementId: 5 });
    expect(result.parseFailure).toBe(false);
  });

  it("parses legacy JSON semantic tap action", () => {
    const raw = '{"thought": "click button", "action": "tap", "target": "Login button"}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap_target", target: "Login button" });
    expect(result.parseFailure).toBe(false);
  });

  it("parses legacy JSON finish action", () => {
    const raw = '{"thought": "done", "action": "finish", "message": "Task complete"}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "finish", message: "Task complete" });
  });

  it("parses legacy JSON with <think> prefix", () => {
    const raw = '<think>\nAnalyzing...\n</think>\n{"thought": "click login", "action": "tap", "id": 7}';
    const result = parseVLMOutput(raw);
    expect(result.action.type).toBe("tap");
  });

  it("treats thought-only legacy JSON as parse failure", () => {
    const raw = '{"thought":"The screen shows a Drive 36 minutes button (id=12), so I need to tap it to enter the route page."}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
  });

  it("parses legacy JSON wrapped in code fences", () => {
    const raw = '```json\n{"thought": "click", "action": "tap", "id": 2}\n```';
    const result = parseVLMOutput(raw);
    expect(result.action.type).toBe("tap");
  });

  it("handles legacy JSON click alias", () => {
    const raw = '{"thought": "click button", "action": "click", "id": 5}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap", elementId: 5 });
  });

  it("handles legacy JSON missing action field", () => {
    const raw = '{"thought": "I see a page"}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "wait" });
    expect(result.parseFailure).toBe(true);
  });

  it("parses legacy JSON swipe with direction", () => {
    const raw = '{"thought": "scroll down", "action": "swipe", "direction": "down"}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "swipe", direction: "down" });
  });

  it("parses legacy JSON swipe on element", () => {
    const raw = '{"thought": "swipe to delete", "action": "swipe", "direction": "left", "id": 3}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "swipe", direction: "left", elementId: 3 });
  });

  it("parses legacy JSON tap_xy action", () => {
    const raw = '{"thought": "tap overlay button", "action": "tap_xy", "x": 30, "y": 120}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "tap_xy", x: 30, y: 120 });
  });

  it("parses legacy JSON long_press_xy action", () => {
    const raw = '{"thought": "long press overlay", "action": "long_press_xy", "x": 200, "y": 300}';
    const result = parseVLMOutput(raw);
    expect(result.action).toEqual({ type: "long_press_xy", x: 200, y: 300 });
  });
});

describe("parseVerifierOutput", () => {
  it("parses a completed verification result", () => {
    const result = parseVerifierOutput('{"complete":true,"confidence":0.92,"progress":"advanced","reason":"The requested page is visible."}');
    expect(result).toEqual({
      complete: true,
      confidence: 0.92,
      progress: "advanced",
      reason: "The requested page is visible.",
    });
  });

  it("parses an incomplete verification result with a next goal", () => {
    const result = parseVerifierOutput('```json\n{"complete":false,"confidence":0.84,"progress":"looped","reason":"The current screen is an intermediate selection screen.","nextGoal":"Find the final confirmation control.","avoidRepeat":["tap the same summary row"]}\n```');
    expect(result).toEqual({
      complete: false,
      confidence: 0.84,
      progress: "looped",
      reason: "The current screen is an intermediate selection screen.",
      nextGoal: "Find the final confirmation control.",
      avoidRepeat: ["tap the same summary row"],
    });
  });

  it("rejects invalid verifier output", () => {
    expect(parseVerifierOutput('{"complete":"yes","confidence":1,"reason":"done"}')).toBeNull();
  });
});
