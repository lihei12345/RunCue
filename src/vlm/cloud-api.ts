import OpenAI from "openai";
import type {
  VLMAdapter,
  VLMAnalyzeInput,
  VLMAnalyzeResult,
  VLMLocateTargetInput,
  VLMLocateTargetResult,
  VLMVerifyTaskInput,
  VLMVerifyTaskResult,
  Action,
  VLMProviderConfig,
} from "../core/types.js";
import { screenshotToBase64 } from "../utils/image.js";
import { SYSTEM_PROMPT } from "./prompt-templates/default.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("vlm");

const LOCATOR_SYSTEM_PROMPT = `You are a visual UI grounding assistant.
Your only job is to locate one semantic UI target on the CURRENT screenshot.
Return ONLY compact JSON:
{"x": number, "y": number, "confidence": number, "reason": "short"}

Rules:
- Coordinates must be logical screen points, not pixels.
- Use the provided screen size.
- If an accessibility tree is provided, use it only as context. The screenshot is the source of truth for visibility.
- Do not choose a target from memory or previous screens.
- Return the center of the actionable visual region. Avoid edges, icons, or neighboring controls unless the target is exactly that icon/control.
- If the target is not visible, return confidence 0 with your best reason.
- Keep confidence between 0 and 1.`;

const VERIFIER_SYSTEM_PROMPT = `You are a UI task progress verifier.
Your job is to decide whether the CURRENT observation satisfies the user's original task and whether the latest action made useful progress.
Return ONLY compact JSON:
{"complete": boolean, "confidence": number, "progress": "advanced|unchanged|regressed|looped|unknown", "reason": "short", "nextGoal": "short optional", "avoidRepeat": ["short optional"]}

Rules:
- Judge the current UI state, not the planner's confidence.
- Use previous-step history only as factual context for what was tried.
- Do not assume a task is complete from an intermediate screen unless the user's requested end state is visibly satisfied.
- progress compares the latest action result against the original task: advanced means closer, unchanged means no meaningful state change, regressed means farther away or wrong context, looped means returned to a previously seen non-terminal state.
- If the current state is still in progress, return complete=false and describe the next missing goal in nextGoal.
- If repeating a recent action would likely loop or reopen the same intermediate state, include it in avoidRepeat.
- Keep confidence between 0 and 1.`;

/** Build the task text, appending hints if provided */
function buildTaskText(prefix: string, task: string, hints?: string[]): string {
  let text = `${prefix}${task}`;
  if (hints && hints.length > 0) {
    text += `\n\nHints:\n${hints.map((h) => `- ${h}`).join("\n")}`;
  }
  return text;
}

function requireScreenshot(input: VLMAnalyzeInput): Buffer {
  if (!input.screenshot) {
    throw new Error(`Screenshot is required for ${input.inputMode} mode`);
  }
  return input.screenshot;
}

function formatHistoryEntry(entry: VLMAnalyzeInput["history"][number]): string {
  const lines = [
    `Previous step ${entry.step}:`,
    `- action: ${entry.summary}`,
  ];

  if (entry.hint) {
    lines.push(`- result: ${entry.hint}`);
  }
  if (entry.error) {
    lines.push(`- error: ${entry.error}`);
  }

  return lines.join("\n");
}

export class CloudAPIAdapter implements VLMAdapter {
  readonly name: string;
  private client: OpenAI;
  private model: string;
  private wireApi: "chat" | "responses";

  constructor(config: VLMProviderConfig) {
    this.name = config.model;
    this.model = config.model;
    this.wireApi = config.wireApi ?? "chat";
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      defaultHeaders: config.headers,
    });
  }

  async analyze(input: VLMAnalyzeInput): Promise<VLMAnalyzeResult> {
    const raw = await this.callModel(input, 0);
    let parsed = parseVLMOutput(raw);

    // Parse failure retry: if output couldn't be parsed, try once more
    if (parsed.parseFailure) {
      const retryRaw = await this.callModel(input, 0.1, raw);
      const retryParsed = parseVLMOutput(retryRaw);
      if (!retryParsed.parseFailure) {
        return {
          thinking: retryParsed.thinking,
          action: retryParsed.action,
          raw: retryRaw,
        };
      }
      throw new Error(
        `VLM output format invalid after retry. First output: ${raw.slice(0, 300)} Retry output: ${retryRaw.slice(0, 300)}`,
      );
    }

    return {
      thinking: parsed.thinking,
      action: parsed.action,
      raw,
    };
  }

  async locateTarget(input: VLMLocateTargetInput): Promise<VLMLocateTargetResult> {
    const raw = this.wireApi === "responses"
      ? await this.callLocatorResponses(input)
      : await this.callLocatorChat(input);
    const parsed = parseLocatorOutput(raw);
    if (!parsed) {
      throw new Error(`VLM locator output invalid: ${raw.slice(0, 300)}`);
    }
    return parsed;
  }

  async verifyTask(input: VLMVerifyTaskInput): Promise<VLMVerifyTaskResult> {
    const raw = this.wireApi === "responses"
      ? await this.callVerifierResponses(input)
      : await this.callVerifierChat(input);
    const parsed = parseVerifierOutput(raw);
    if (!parsed) {
      throw new Error(`VLM verifier output invalid: ${raw.slice(0, 300)}`);
    }
    return parsed;
  }

  private buildLocatorText(input: VLMLocateTargetInput): string {
    const lines = [
      `Target: ${input.target}`,
      `Action: ${input.action}${input.direction ? ` ${input.direction}` : ""}`,
      `Screen: ${input.screenInfo.width}x${input.screenInfo.height} logical points`,
      "Return the center point of the target if it is visible and actionable.",
    ];
    if (input.viewTree) {
      lines.push(`\nAccessibility tree context:\n${input.viewTree.slice(0, 12000)}`);
    }
    return lines.join("\n");
  }

  private async callLocatorChat(input: VLMLocateTargetInput): Promise<string> {
    const base64 = screenshotToBase64(input.screenshot);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: LOCATOR_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64}` },
            },
            { type: "text", text: this.buildLocatorText(input) },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 256,
    });
    return response.choices[0]?.message?.content ?? "";
  }

  private async callLocatorResponses(input: VLMLocateTargetInput): Promise<string> {
    const base64 = screenshotToBase64(input.screenshot);
    const response = await this.client.responses.create({
      model: this.model,
      instructions: LOCATOR_SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: `data:image/png;base64,${base64}`, detail: "high" },
            { type: "input_text", text: this.buildLocatorText(input) },
          ],
        },
      ],
      temperature: 0,
      max_output_tokens: 256,
    });

    for (const item of response.output) {
      if (item.type === "message") {
        for (const block of item.content) {
          if (block.type === "output_text") return block.text;
        }
      }
    }
    return "";
  }

  private buildVerifierText(input: VLMVerifyTaskInput): string {
    const lines = [
      `Task: ${input.task}`,
      `Screen: ${input.screenInfo.width}x${input.screenInfo.height} logical points`,
    ];
    if (input.history.length > 0) {
      lines.push("\nRecent factual history:");
      for (const entry of input.history.slice(-6)) {
        lines.push(formatHistoryEntry(entry));
      }
    }
    if (input.viewTree) {
      lines.push(`\nCurrent accessibility tree:\n${input.viewTree.slice(0, 16000)}`);
    }
    lines.push("\nIs the original task fully complete in the current observation? Did the latest action make useful progress?");
    return lines.join("\n");
  }

  private async callVerifierChat(input: VLMVerifyTaskInput): Promise<string> {
    const content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"] = input.screenshot
      ? [
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${screenshotToBase64(input.screenshot)}` },
        },
        { type: "text", text: this.buildVerifierText(input) },
      ]
      : this.buildVerifierText(input);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: "system", content: VERIFIER_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: 0,
      max_tokens: 256,
    });
    return response.choices[0]?.message?.content ?? "";
  }

  private async callVerifierResponses(input: VLMVerifyTaskInput): Promise<string> {
    const content = input.screenshot
      ? [
        { type: "input_image" as const, image_url: `data:image/png;base64,${screenshotToBase64(input.screenshot)}`, detail: "high" as const },
        { type: "input_text" as const, text: this.buildVerifierText(input) },
      ]
      : this.buildVerifierText(input);

    const response = await this.client.responses.create({
      model: this.model,
      instructions: VERIFIER_SYSTEM_PROMPT,
      input: [{ role: "user", content }],
      temperature: 0,
      max_output_tokens: 256,
    });

    for (const item of response.output) {
      if (item.type === "message") {
        for (const block of item.content) {
          if (block.type === "output_text") return block.text;
        }
      }
    }
    return "";
  }

  private async callModel(
    input: VLMAnalyzeInput,
    temperature: number,
    previousInvalidOutput?: string,
  ): Promise<string> {
    if (this.wireApi === "responses") {
      return this.callResponses(input, temperature, previousInvalidOutput);
    }
    return this.callChatCompletions(input, temperature, previousInvalidOutput);
  }

  private async callChatCompletions(
    input: VLMAnalyzeInput,
    temperature: number,
    previousInvalidOutput?: string,
  ): Promise<string> {
    const messages = this.buildMessages(input, previousInvalidOutput);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature,
      max_tokens: 512,
    });

    // Log token usage including cache hits
    const usage = response.usage;
    if (usage) {
      const details = (usage as unknown as Record<string, unknown>).prompt_tokens_details as
        { cached_tokens?: number } | undefined;
      const cached = details?.cached_tokens ?? 0;
      log.debug(
        `Tokens: ${usage.prompt_tokens} in (${cached} cached), ${usage.completion_tokens} out`,
      );
    }

    return response.choices[0]?.message?.content ?? "";
  }

  private async callResponses(
    input: VLMAnalyzeInput,
    temperature: number,
    previousInvalidOutput?: string,
  ): Promise<string> {
    const inputMessages = this.buildResponsesInput(input, previousInvalidOutput);
    const response = await this.client.responses.create({
      model: this.model,
      instructions: SYSTEM_PROMPT,
      input: inputMessages,
      temperature,
      max_output_tokens: 512,
    });

    // Extract text from response output
    for (const item of response.output) {
      if (item.type === "message") {
        for (const block of item.content) {
          if (block.type === "output_text") {
            return block.text;
          }
        }
      }
    }
    return "";
  }

  private buildResponsesInput(
    input: VLMAnalyzeInput,
    previousInvalidOutput?: string,
  ): OpenAI.Responses.ResponseInputItem[] {
    const items: OpenAI.Responses.ResponseInputItem[] = [];

    // Add history as factual user-side observations. Do not add assistant JSON
    // history here; it can teach models to emit thought-only JSON.
    for (const entry of input.history) {
      items.push({ role: "user", content: formatHistoryEntry(entry) });
    }

    // Current step: viewtree sends tree text, screenshot sends image, hybrid sends both
    const taskPrefix =
      input.history.length > 0 ? "Continue task: " : "Task: ";
    const taskText = buildTaskText(taskPrefix, input.task, input.hints);

    if (input.inputMode === "hybrid") {
      // Hybrid mode: send both screenshot and view tree
      const base64 = screenshotToBase64(requireScreenshot(input));
      const treeText = input.viewTree ? `\nView Tree:\n${input.viewTree}\n` : "";
      items.push({
        role: "user",
        content: [
          { type: "input_image", image_url: `data:image/png;base64,${base64}`, detail: "high" },
          { type: "input_text", text: `${treeText}\n${taskText}` },
        ],
      });
    } else if (input.inputMode === "screenshot") {
      const base64 = screenshotToBase64(requireScreenshot(input));
      items.push({
        role: "user",
        content: [
          { type: "input_image", image_url: `data:image/png;base64,${base64}`, detail: "high" },
          { type: "input_text", text: taskText },
        ],
      });
    } else {
      const content = input.viewTree
        ? `View Tree:\n${input.viewTree}\n\n${taskText}`
        : taskText;
      items.push({ role: "user", content });
    }

    if (previousInvalidOutput) {
      items.push({
        role: "assistant",
        content: previousInvalidOutput.slice(0, 1200),
      });
      items.push({
        role: "user",
        content:
          "Your previous response was invalid because it did not contain a parseable XML <action> or <complete>. Retry the same step. Output ONLY the required XML format: <thought>...</thought> followed by either <action>...</action><param>{...}</param> or <complete success=\"true|false\">...</complete>.",
      });
    }

    return items;
  }

  private buildMessages(
    input: VLMAnalyzeInput,
    previousInvalidOutput?: string,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    // Add history as factual user-side observations. Do not add assistant JSON
    // history here; it can teach models to emit thought-only JSON.
    for (const entry of input.history) {
      messages.push({
        role: "user",
        content: formatHistoryEntry(entry),
      });
    }

    // Current step: viewtree sends tree text, screenshot sends image, hybrid sends both
    const taskPrefix =
      input.history.length > 0 ? "Continue task: " : "Task: ";
    const taskText = buildTaskText(taskPrefix, input.task, input.hints);

    if (input.inputMode === "hybrid") {
      // Hybrid mode: send both screenshot and view tree
      const base64 = screenshotToBase64(requireScreenshot(input));
      const treeText = input.viewTree ? `\nView Tree:\n${input.viewTree}\n` : "";
      messages.push({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64}` },
          },
          { type: "text", text: `${treeText}\n${taskText}` },
        ],
      });
    } else if (input.inputMode === "screenshot") {
      const base64 = screenshotToBase64(requireScreenshot(input));
      messages.push({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64}` },
          },
          { type: "text", text: taskText },
        ],
      });
    } else {
      const content = input.viewTree
        ? `View Tree:\n${input.viewTree}\n\n${taskText}`
        : taskText;
      messages.push({ role: "user", content });
    }

    if (previousInvalidOutput) {
      messages.push({
        role: "assistant",
        content: previousInvalidOutput.slice(0, 1200),
      });
      messages.push({
        role: "user",
        content:
          "Your previous response was invalid because it did not contain a parseable XML <action> or <complete>. Retry the same step. Output ONLY the required XML format: <thought>...</thought> followed by either <action>...</action><param>{...}</param> or <complete success=\"true|false\">...</complete>.",
      });
    }

    return messages;
  }
}

/** Create a CloudAPIAdapter for screen analysis (check command) */
export async function analyzeScreenshot(
  config: VLMProviderConfig,
  screenshot: Buffer,
  question: string,
): Promise<string> {
  const { CHECK_SYSTEM_PROMPT } = await import(
    "./prompt-templates/default.js"
  );
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    defaultHeaders: config.headers,
  });

  const base64 = screenshotToBase64(screenshot);
  const wireApi = config.wireApi ?? "chat";

  if (wireApi === "responses") {
    const response = await client.responses.create({
      model: config.model,
      instructions: CHECK_SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [
            { type: "input_image", image_url: `data:image/png;base64,${base64}`, detail: "high" },
            { type: "input_text", text: question },
          ],
        },
      ],
      temperature: 0,
      max_output_tokens: 1024,
    });

    for (const item of response.output) {
      if (item.type === "message") {
        for (const block of item.content) {
          if (block.type === "output_text") {
            return block.text;
          }
        }
      }
    }
    return "";
  }

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: CHECK_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64}` },
          },
          { type: "text", text: question },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content ?? "";
}

/** Analyze a compact accessibility tree without sending a screenshot. */
export async function analyzeViewTree(
  config: VLMProviderConfig,
  viewTree: string,
  question: string,
): Promise<string> {
  const { CHECK_SYSTEM_PROMPT } = await import(
    "./prompt-templates/default.js"
  );
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    defaultHeaders: config.headers,
  });
  const wireApi = config.wireApi ?? "chat";
  const text = `View Tree:\n${viewTree}\n\nQuestion: ${question}`;

  if (wireApi === "responses") {
    const response = await client.responses.create({
      model: config.model,
      instructions: CHECK_SYSTEM_PROMPT,
      input: [{ role: "user", content: text }],
      temperature: 0,
      max_output_tokens: 1024,
    });

    for (const item of response.output) {
      if (item.type === "message") {
        for (const block of item.content) {
          if (block.type === "output_text") {
            return block.text;
          }
        }
      }
    }
    return "";
  }

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: CHECK_SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
    temperature: 0,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content ?? "";
}

// ── VLM output parsing (exported for testing) ──

/** Strip <think>...</think> tags that Qwen3-VL may emit in thinking mode */
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Extract content of an XML tag from text.
 * Searches from the END of the string backwards to handle models that
 * prepend <think> blocks or other preamble before the actual output.
 * Falls back to half-open tags (tag opened but not closed).
 */
export function extractXMLTag(
  text: string,
  tagName: string,
): { content: string; attrs?: string } | null {
  // Try closed tag first (search from end)
  const closingTag = `</${tagName}>`;
  const closeIdx = text.lastIndexOf(closingTag);
  if (closeIdx !== -1) {
    // Find the matching opening tag before this closing tag
    const beforeClose = text.slice(0, closeIdx);
    const openRegex = new RegExp(`<${tagName}(\\s[^>]*)?>`, "gi");
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = openRegex.exec(beforeClose)) !== null) {
      lastMatch = match;
    }
    if (lastMatch) {
      const contentStart = lastMatch.index + lastMatch[0].length;
      return {
        content: text.slice(contentStart, closeIdx).trim(),
        attrs: lastMatch[1]?.trim(),
      };
    }
  }

  // Fallback: half-open tag (opened but not closed — model truncated output)
  const openRegex = new RegExp(`<${tagName}(\\s[^>]*)?>([\\s\\S]*)$`, "i");
  const halfMatch = text.match(openRegex);
  if (halfMatch) {
    return {
      content: halfMatch[2].trim(),
      attrs: halfMatch[1]?.trim(),
    };
  }

  return null;
}

/** Extract the first complete JSON object from a string using balanced braces */
function extractJSON(text: string): string | null {
  const startIdx = text.indexOf("{");
  if (startIdx === -1) return null;

  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null; // incomplete
}

/** Safe JSON parse with extractJSON fallback */
function safeParseJSON(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const jsonStr = extractJSON(text);
    if (jsonStr) {
      try {
        return JSON.parse(jsonStr);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseLocatorOutput(raw: string): VLMLocateTargetResult | null {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const parsed = safeParseJSON(cleaned);
  if (!parsed) {
    const pairMatch = cleaned.match(/"x"\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*"confidence"\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (pairMatch) {
      return {
        x: Number(pairMatch[1]),
        y: Number(pairMatch[2]),
        confidence: Math.max(0, Math.min(1, Number(pairMatch[3]))),
      };
    }
    return null;
  }
  const xValue = Array.isArray(parsed?.x) ? parsed.x[0] : parsed?.x;
  const yValue = Array.isArray(parsed?.x) && parsed.x.length >= 2 ? parsed.x[1] : parsed?.y;
  const point = parsed?.point ?? parsed?.coordinate ?? parsed?.coordinates;
  const x = Number(Array.isArray(point) ? point[0] : xValue);
  const y = Number(Array.isArray(point) ? point[1] : yValue);
  const confidence = Number(parsed?.confidence);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(confidence)) {
    return null;
  }

  return {
    x,
    y,
    confidence: Math.max(0, Math.min(1, confidence)),
    ...(typeof parsed?.reason === "string" ? { reason: parsed.reason } : {}),
  };
}

export function parseVerifierOutput(raw: string): VLMVerifyTaskResult | null {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  const parsed = safeParseJSON(cleaned);
  if (!parsed) return null;

  const complete = parsed.complete;
  const confidence = Number(parsed.confidence);
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

  if (typeof complete !== "boolean" || !Number.isFinite(confidence) || !reason) {
    return null;
  }

  return {
    complete,
    confidence: Math.max(0, Math.min(1, confidence)),
    ...(isVerifierProgress(parsed.progress) ? { progress: parsed.progress } : {}),
    reason,
    ...(typeof parsed.nextGoal === "string" && parsed.nextGoal.trim()
      ? { nextGoal: parsed.nextGoal.trim() }
      : {}),
    ...(Array.isArray(parsed.avoidRepeat)
      ? { avoidRepeat: parsed.avoidRepeat.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 4) }
      : {}),
  };
}

function isVerifierProgress(value: unknown): value is NonNullable<VLMVerifyTaskResult["progress"]> {
  return typeof value === "string" &&
    ["advanced", "unchanged", "regressed", "looped", "unknown"].includes(value);
}

export interface ParseResult {
  thinking: string;
  action: Action;
  /** Whether this result came from a parse failure fallback (vs explicit model output) */
  parseFailure: boolean;
}

/** Parse raw VLM output string into structured thinking + action */
export function parseVLMOutput(
  raw: string,
): ParseResult {
  // Step 1: Strip <think> tags and code fences
  let cleaned = stripThinkTags(raw).trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:xml|json)?\s*/, "").replace(/\s*```$/, "");
  }

  // Step 2: Handle empty output
  if (!cleaned) {
    return { thinking: "VLM returned empty output", action: { type: "wait" }, parseFailure: true };
  }

  // Step 3: Extract <thought>
  const thoughtTag = extractXMLTag(cleaned, "thought");
  const thinking = thoughtTag?.content ?? "";

  // Step 4: Extract <action> and <complete>
  const actionTag = extractXMLTag(cleaned, "action");
  const completeTag = extractXMLTag(cleaned, "complete");

  // Step 5: Conflict resolution — action wins over complete
  if (actionTag && completeTag) {
    // Ignore complete, proceed with action
  }

  // Step 6: Handle <complete> (only if no <action>)
  if (!actionTag && completeTag) {
    const success = completeTag.attrs?.includes('false') ? false : true;
    return {
      thinking,
      action: { type: "finish", message: completeTag.content || (success ? "Task completed" : "Task failed") },
      parseFailure: false,
    };
  }

  // Step 7: Handle <action>
  if (actionTag) {
    const paramTag = extractXMLTag(cleaned, "param");
    const actionName = actionTag.content === "click" ? "tap" : actionTag.content;

    let action: Action;
    switch (actionName) {
      case "tap": {
        const params = paramTag ? safeParseJSON(paramTag.content) : null;
        const id = params?.id as number | undefined;
        const target = typeof params?.target === "string" ? params.target.trim() : "";
        if (id != null) {
          action = { type: "tap", elementId: id };
        } else if (target) {
          action = { type: "tap_target", target };
        } else {
          return { thinking, action: { type: "wait" }, parseFailure: true };
        }
        break;
      }
      case "long_press": {
        const params = paramTag ? safeParseJSON(paramTag.content) : null;
        const id = params?.id as number | undefined;
        const target = typeof params?.target === "string" ? params.target.trim() : "";
        if (id != null) {
          action = { type: "long_press", elementId: id };
        } else if (target) {
          action = { type: "long_press_target", target };
        } else {
          return { thinking, action: { type: "wait" }, parseFailure: true };
        }
        break;
      }
      case "tap_xy": {
        const params = paramTag ? safeParseJSON(paramTag.content) : null;
        const x = params?.x as number | undefined;
        const y = params?.y as number | undefined;
        if (x == null || y == null) {
          return { thinking, action: { type: "wait" }, parseFailure: true };
        }
        action = { type: "tap_xy", x, y };
        break;
      }
      case "long_press_xy": {
        const params = paramTag ? safeParseJSON(paramTag.content) : null;
        const x = params?.x as number | undefined;
        const y = params?.y as number | undefined;
        if (x == null || y == null) {
          return { thinking, action: { type: "wait" }, parseFailure: true };
        }
        action = { type: "long_press_xy", x, y };
        break;
      }
      case "swipe": {
        const params = paramTag ? safeParseJSON(paramTag.content) : null;
        const direction = params?.direction as string | undefined;
        if (!direction || !["up", "down", "left", "right"].includes(direction)) {
          return { thinking, action: { type: "wait" }, parseFailure: true };
        }
        const swipeId = params?.id as number | undefined;
        const target = typeof params?.target === "string" ? params.target.trim() : "";
        action = {
          type: "swipe",
          direction: direction as "up" | "down" | "left" | "right",
          ...(swipeId != null ? { elementId: swipeId } : {}),
          ...(target ? { target } : {}),
        };
        break;
      }
      case "type": {
        const params = paramTag ? safeParseJSON(paramTag.content) : null;
        action = { type: "type", text: (params?.text as string) ?? "" };
        break;
      }
      case "press_enter":
      case "enter":
      case "return":
        action = { type: "press_enter" };
        break;
      case "home":
        action = { type: "home" };
        break;
      case "wait":
        action = { type: "wait" };
        break;
      default:
        return {
          thinking: `${thinking} [unknown action: ${actionName}]`,
          action: { type: "wait" },
          parseFailure: true,
        };
    }

    return { thinking, action, parseFailure: false };
  }

  // Step 8: No <action> or <complete> found — try legacy JSON fallback
  const jsonResult = tryParseLegacyJSON(cleaned, thinking);
  if (jsonResult) return jsonResult;

  // Step 9: Complete parse failure
  return {
    thinking: thinking || `VLM output could not be parsed: ${raw.slice(0, 200)}`,
    action: { type: "wait" },
    parseFailure: true,
  };
}

/** Fallback: try parsing as legacy JSON format for backward compatibility */
function tryParseLegacyJSON(
  text: string,
  existingThinking: string,
): ParseResult | null {
  const parsed = safeParseJSON(text);
  if (!parsed || !parsed.action) return null;

  const thinking = (parsed.thought as string) ?? existingThinking;
  const actionName = (parsed.action as string) === "click" ? "tap" : (parsed.action as string);

  let action: Action;
  switch (actionName) {
    case "tap": {
      const id = parsed.id as number | undefined;
      const target = typeof parsed.target === "string" ? parsed.target.trim() : "";
      if (id != null) {
        action = { type: "tap", elementId: id };
      } else if (target) {
        action = { type: "tap_target", target };
      } else {
        return null;
      }
      break;
    }
    case "long_press": {
      const id = parsed.id as number | undefined;
      const target = typeof parsed.target === "string" ? parsed.target.trim() : "";
      if (id != null) {
        action = { type: "long_press", elementId: id };
      } else if (target) {
        action = { type: "long_press_target", target };
      } else {
        return null;
      }
      break;
    }
    case "tap_xy": {
      const x = parsed.x as number | undefined;
      const y = parsed.y as number | undefined;
      if (x == null || y == null) return null;
      action = { type: "tap_xy", x, y };
      break;
    }
    case "long_press_xy": {
      const x = parsed.x as number | undefined;
      const y = parsed.y as number | undefined;
      if (x == null || y == null) return null;
      action = { type: "long_press_xy", x, y };
      break;
    }
    case "swipe": {
      const direction = parsed.direction as string | undefined;
      if (!direction || !["up", "down", "left", "right"].includes(direction)) return null;
      const swipeId = parsed.id as number | undefined;
      const target = typeof parsed.target === "string" ? parsed.target.trim() : "";
      action = {
        type: "swipe",
        direction: direction as "up" | "down" | "left" | "right",
        ...(swipeId != null ? { elementId: swipeId } : {}),
        ...(target ? { target } : {}),
      };
      break;
    }
    case "type":
      action = { type: "type", text: (parsed.text as string) ?? "" };
      break;
    case "press_enter":
    case "enter":
    case "return":
      action = { type: "press_enter" };
      break;
    case "home":
      action = { type: "home" };
      break;
    case "wait":
      action = { type: "wait" };
      break;
    case "finish":
      action = { type: "finish", message: (parsed.message as string) ?? "Task completed" };
      break;
    default:
      return null;
  }

  return { thinking, action, parseFailure: false };
}
