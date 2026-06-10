import type {
  Action,
  AgentLoopOptions,
  AgentLoopResult,
  DeviceAdapter,
  HistoryEntry,
  VLMAdapter,
  VLMAnalyzeInput,
  VLMLocateTargetResult,
  VLMVerifyTaskResult,
  ViewTreeNode,
} from "./types.js";
import { createLogger } from "../utils/logger.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const log = createLogger("agent-loop");

type VisualLocateFn = (
  target: string,
  action: "tap" | "long_press" | "swipe",
  direction?: "up" | "down" | "left" | "right",
) => Promise<VLMLocateTargetResult>;

function actionSummary(action: Action): string {
  switch (action.type) {
    case "tap":
      return `tap(id=${action.elementId})`;
    case "tap_target":
      return `tap(target='${action.target}')`;
    case "long_press":
      return `long_press(id=${action.elementId})`;
    case "long_press_target":
      return `long_press(target='${action.target}')`;
    case "tap_xy":
      return `tap_xy(${action.x}, ${action.y})`;
    case "long_press_xy":
      return `long_press_xy(${action.x}, ${action.y})`;
    case "swipe":
      return action.elementId != null
        ? `swipe(${action.direction}, id=${action.elementId})`
        : action.target
          ? `swipe(${action.direction}, target='${action.target}')`
        : `swipe(${action.direction})`;
    case "type":
      return `type('${action.text}')`;
    case "press_enter":
      return "press_enter()";
    case "home":
      return "home()";
    case "wait":
      return "wait()";
    case "finish":
      return `finish('${action.message}')`;
  }
}

/** Find a node by id in the view tree (depth-first) */
function findNodeById(nodes: ViewTreeNode[], id: number): ViewTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function collectNodeText(node: ViewTreeNode): string {
  const parts = [node.label, node.value, node.type].filter(Boolean).map(String);
  if (node.children) {
    for (const child of node.children) {
      parts.push(collectNodeText(child));
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function targetTokens(target: string): string[] {
  const normalized = normalizeText(target);
  const spaced = normalized.split(" ").filter((token) => token.length >= 2);
  if (spaced.length > 0) return spaced;
  return normalized ? [normalized] : [];
}

function isInteractableType(type: string): boolean {
  return ["Button", "TextField", "SearchField", "Cell", "Link", "TextView", "Switch", "Slider"].includes(type);
}

function nodeLocatorScore(node: ViewTreeNode, target: string, screenInfo: { width: number; height: number }): number {
  if (node.enabled === false) return -Infinity;
  if (node.frame.w <= 0 || node.frame.h <= 0) return -Infinity;

  const cx = node.frame.x + node.frame.w / 2;
  const cy = node.frame.y + node.frame.h / 2;
  if (cx < 0 || cy < 0 || cx > screenInfo.width || cy > screenInfo.height) return -Infinity;

  const nodeText = normalizeText(collectNodeText(node));
  const targetText = normalizeText(target);
  if (!nodeText || !targetText) return -Infinity;

  let score = 0;
  if (nodeText === targetText) score += 160;
  if (normalizeText(String(node.label ?? "")) === targetText) score += 180;
  if (normalizeText(String(node.value ?? "")) === targetText) score += 140;
  if (nodeText.includes(targetText)) score += 110;
  if (targetText.includes(nodeText) && nodeText.length >= 2) score += 80;

  for (const token of targetTokens(target)) {
    if (nodeText.includes(token)) score += 24;
  }

  if (isInteractableType(node.type)) score += 35;
  if (node.type === "Button") score += 20;
  if (node.type === "StaticText" || node.type === "Heading") score -= 25;

  const textLengthPenalty = Math.min(Math.max(nodeText.length - targetText.length, 0), 80) * 0.2;
  return score - textLengthPenalty;
}

function flattenNodes(nodes: ViewTreeNode[], output: ViewTreeNode[] = []): ViewTreeNode[] {
  for (const node of nodes) {
    output.push(node);
    if (node.children) flattenNodes(node.children, output);
  }
  return output;
}

function locateNodeByTarget(
  nodes: ViewTreeNode[],
  target: string,
  screenInfo: { width: number; height: number },
): ViewTreeNode | null {
  let best: { node: ViewTreeNode; score: number } | null = null;
  for (const node of flattenNodes(nodes)) {
    const score = nodeLocatorScore(node, target, screenInfo);
    if (!best || score > best.score) {
      best = { node, score };
    }
  }
  return best && best.score >= 45 ? best.node : null;
}


/** Count all leaf nodes in the tree */
function countLeafNodes(nodes: ViewTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (!node.children || node.children.length === 0) {
      count++;
    } else {
      count += countLeafNodes(node.children);
    }
  }
  return count;
}

/**
 * Detect "sparse tree" — a tree with very few leaf nodes, likely indicating
 * the accessibility tree only contains native chrome (toolbar, nav bar) but
 * not the actual content (e.g., webview, canvas, or SPA still rendering).
 * In this case, hybrid mode sends both screenshot and tree so the VLM can
 * see the rendered content while still using id-based actions for native elements.
 */
const SPARSE_TREE_THRESHOLD = 10;
export function isSparseTree(nodes: ViewTreeNode[] | null): boolean {
  if (!nodes) return false;
  return countLeafNodes(nodes) <= SPARSE_TREE_THRESHOLD;
}

/** Get the label of the first leaf node with a label */
function getFirstLeafLabel(nodes: ViewTreeNode[]): string {
  for (const node of nodes) {
    if (!node.children || node.children.length === 0) {
      if (node.label) return node.label;
    } else {
      const label = getFirstLeafLabel(node.children);
      if (label) return label;
    }
  }
  return "";
}

function flattenVisibleText(nodes: ViewTreeNode[], output: string[] = []): string[] {
  for (const node of nodes) {
    const text = String(node.label ?? node.value ?? "").trim();
    if (text) {
      output.push(text.replace(/\s+/g, " ").slice(0, 80));
    }
    if (node.children) {
      flattenVisibleText(node.children, output);
    }
  }
  return output;
}

function uniqueTop(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function quoteList(items: string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}

function diffVisibleText(before: string[], after: string[]): { appeared: string[]; disappeared: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    appeared: uniqueTop(after.filter((item) => !beforeSet.has(item)), 6),
    disappeared: uniqueTop(before.filter((item) => !afterSet.has(item)), 4),
  };
}

function describeUiChange(
  beforeCount: number,
  afterCount: number,
  beforeFirstLabel: string,
  afterFirstLabel: string,
  beforeText: string[],
  afterText: string[],
): string | undefined {
  const fragments: string[] = [];
  const countDelta = afterCount - beforeCount;
  const textDiff = diffVisibleText(beforeText, afterText);

  if (countDelta > 0) {
    fragments.push(`${countDelta} new element(s) appeared`);
  } else if (countDelta < 0) {
    fragments.push(`${Math.abs(countDelta)} element(s) removed`);
  }

  if (beforeFirstLabel && beforeFirstLabel !== afterFirstLabel) {
    fragments.push(`first item changed from "${beforeFirstLabel.slice(0, 50)}" to "${afterFirstLabel.slice(0, 50)}"`);
  }

  if (textDiff.appeared.length > 0) {
    fragments.push(`new labels include: ${quoteList(textDiff.appeared)}`);
  }
  if (textDiff.disappeared.length > 0) {
    fragments.push(`labels no longer visible include: ${quoteList(textDiff.disappeared)}`);
  }

  return fragments.length > 0 ? `UI changed after action: ${fragments.join("; ")}.` : undefined;
}

function appendHistoryHint(entry: HistoryEntry, hint: string): void {
  entry.hint = entry.hint ? `${entry.hint}; ${hint}` : hint;
}

function verifierRejectHint(verification: VLMVerifyTaskResult): string {
  return [
    `Completion verifier rejected finish: ${verification.reason}`,
    verification.nextGoal ? `Next missing goal: ${verification.nextGoal}` : undefined,
  ].filter(Boolean).join(" ");
}

function progressVerifierHint(verification: VLMVerifyTaskResult): string {
  const parts = [
    `Progress verifier: ${verification.progress ?? "unknown"} - ${verification.reason}`,
    verification.nextGoal ? `Next missing goal: ${verification.nextGoal}` : undefined,
    verification.avoidRepeat && verification.avoidRepeat.length > 0
      ? `Avoid repeating: ${verification.avoidRepeat.join("; ")}`
      : undefined,
  ];
  return parts.filter(Boolean).join(" ");
}

function shouldEscalateObservation(verification: VLMVerifyTaskResult): boolean {
  return verification.progress === "unchanged" ||
    verification.progress === "regressed" ||
    verification.progress === "looped";
}

/** Resolve effective input mode based on config and tree availability */
export function resolveInputMode(
  configMode: "viewtree" | "screenshot" | undefined,
  viewTree: ViewTreeNode[] | null,
  forceScreenshot: boolean,
): "viewtree" | "screenshot" | "hybrid" {
  // Force screenshot (e.g., tree unchanged after tap → possible overlay not in tree)
  if (forceScreenshot) return "screenshot";

  // User explicit override
  if (configMode === "screenshot") return "screenshot";

  // No tree available → fall back to screenshot
  if (!viewTree) return "screenshot";

  // Sparse tree (e.g., webview/canvas with only native chrome) → hybrid mode
  if (isSparseTree(viewTree)) return "hybrid";

  return "viewtree";
}

/** Resolve action to device coordinates using the view tree */
async function executeAction(
  device: DeviceAdapter,
  action: Action,
  viewTree: ViewTreeNode[],
  screenInfo: { width: number; height: number },
  visualLocate?: VisualLocateFn,
): Promise<string | undefined> {
  const tapNode = async (node: ViewTreeNode, actionName: "tap" | "long_press"): Promise<string> => {
    if (node.frame.w <= 0 || node.frame.h <= 0) {
      throw new Error(`Element id=${node.id} is not ${actionName === "tap" ? "tappable" : "pressable"} because its frame is ${node.frame.w}x${node.frame.h}`);
    }
    const x = Math.round(node.frame.x + node.frame.w / 2);
    const y = Math.round(node.frame.y + node.frame.h / 2);
    if (x < 0 || y < 0 || x > screenInfo.width || y > screenInfo.height) {
      throw new Error(`Element id=${node.id} is not ${actionName === "tap" ? "tappable" : "pressable"} because its center (${x}, ${y}) is outside the screen ${screenInfo.width}x${screenInfo.height}`);
    }
    if (actionName === "tap") {
      log.info(`  → tap(${x}, ${y}) [${node.label ?? node.type}]`);
      await device.tap(x, y);
      return `Tapped ${describeNode(node)} at (${x}, ${y}).`;
    }
    log.info(`  → long_press(${x}, ${y}) [${node.label ?? node.type}]`);
    await device.longPress(x, y);
    return `Long-pressed ${describeNode(node)} at (${x}, ${y}).`;
  };

  const locateTargetPoint = async (
    target: string,
    actionName: "tap" | "long_press" | "swipe",
    direction?: "up" | "down" | "left" | "right",
  ): Promise<{ x: number; y: number; feedback: string }> => {
    const node = locateNodeByTarget(viewTree, target, screenInfo);
    if (node) {
      const x = Math.round(node.frame.x + node.frame.w / 2);
      const y = Math.round(node.frame.y + node.frame.h / 2);
      log.info(`  → located target "${target}" as ${describeNode(node)}`);
      return {
        x,
        y,
        feedback: `Located target "${target}" in current view tree as ${describeNode(node)}.`,
      };
    }

    if (!visualLocate) {
      throw new Error(`Target "${target}" could not be located in the current view tree`);
    }

    const located = await visualLocate(target, actionName, direction);
    if (located.confidence < 0.35) {
      throw new Error(`Target "${target}" could not be located visually with enough confidence (${located.confidence}). ${located.reason ?? ""}`.trim());
    }

    const x = Math.round(located.x);
    const y = Math.round(located.y);
    if (x < 0 || y < 0 || x > screenInfo.width || y > screenInfo.height) {
      throw new Error(`Visual locator returned (${x}, ${y}) outside the screen ${screenInfo.width}x${screenInfo.height}`);
    }

    log.info(`  → visually located target "${target}" at (${x}, ${y}) confidence=${located.confidence}`);
    return {
      x,
      y,
      feedback: `Visually located target "${target}" at (${x}, ${y}) with confidence ${located.confidence}.${located.reason ? ` ${located.reason}` : ""}`,
    };
  };

  switch (action.type) {
    case "tap": {
      const node = findNodeById(viewTree, action.elementId);
      if (!node) throw new Error(`Element id=${action.elementId} not found in view tree`);
      return tapNode(node, "tap");
    }
    case "tap_target": {
      const point = await locateTargetPoint(action.target, "tap");
      log.info(`  → tap(${point.x}, ${point.y}) [target=${action.target}]`);
      await device.tap(point.x, point.y);
      return `${point.feedback} Tapped target "${action.target}".`;
    }
    case "long_press": {
      const node = findNodeById(viewTree, action.elementId);
      if (!node) throw new Error(`Element id=${action.elementId} not found in view tree`);
      return tapNode(node, "long_press");
    }
    case "long_press_target": {
      const point = await locateTargetPoint(action.target, "long_press");
      log.info(`  → long_press(${point.x}, ${point.y}) [target=${action.target}]`);
      await device.longPress(point.x, point.y);
      return `${point.feedback} Long-pressed target "${action.target}".`;
    }
    case "tap_xy": {
      const x = Math.round(action.x);
      const y = Math.round(action.y);
      log.info(`  → tap_xy(${x}, ${y})`);
      await device.tap(x, y);
      return `Tapped screen coordinates (${x}, ${y}).`;
    }
    case "long_press_xy": {
      const x = Math.round(action.x);
      const y = Math.round(action.y);
      log.info(`  → long_press_xy(${x}, ${y})`);
      await device.longPress(x, y);
      return `Long-pressed screen coordinates (${x}, ${y}).`;
    }
    case "swipe": {
      // Determine swipe center: use element center if elementId given, else screen center
      let cx: number, cy: number;
      if (action.elementId != null) {
        const node = findNodeById(viewTree, action.elementId);
        if (!node) throw new Error(`Element id=${action.elementId} not found in view tree`);
        cx = Math.round(node.frame.x + node.frame.w / 2);
        cy = Math.round(node.frame.y + node.frame.h / 2);
      } else if (action.target) {
        const point = await locateTargetPoint(action.target, "swipe", action.direction);
        cx = point.x;
        cy = point.y;
      } else {
        cx = Math.round(screenInfo.width / 2);
        cy = Math.round(screenInfo.height / 2);
      }
      let x1: number, y1: number, x2: number, y2: number;
      switch (action.direction) {
        case "down": {
          const dist = Math.round(screenInfo.height * 0.3);
          x1 = cx; y1 = cy + dist / 2; x2 = cx; y2 = cy - dist / 2;
          break;
        }
        case "up": {
          const dist = Math.round(screenInfo.height * 0.3);
          x1 = cx; y1 = cy - dist / 2; x2 = cx; y2 = cy + dist / 2;
          break;
        }
        case "left": {
          // For element-targeted swipe, use element width; otherwise screen width
          const swipeWidth = action.elementId != null || action.target
            ? (() => {
              const n = action.elementId != null
                ? findNodeById(viewTree, action.elementId)
                : locateNodeByTarget(viewTree, action.target!, screenInfo);
              return n ? n.frame.w : screenInfo.width;
            })()
            : screenInfo.width;
          x1 = cx + Math.round(swipeWidth * 0.3); y1 = cy;
          x2 = cx - Math.round(swipeWidth * 0.3); y2 = cy;
          break;
        }
        case "right": {
          const swipeWidth = action.elementId != null || action.target
            ? (() => {
              const n = action.elementId != null
                ? findNodeById(viewTree, action.elementId)
                : locateNodeByTarget(viewTree, action.target!, screenInfo);
              return n ? n.frame.w : screenInfo.width;
            })()
            : screenInfo.width;
          x1 = cx - Math.round(swipeWidth * 0.3); y1 = cy;
          x2 = cx + Math.round(swipeWidth * 0.3); y2 = cy;
          break;
        }
      }
      log.info(`  → swipe(${x1},${y1} → ${x2},${y2})`);
      await device.swipe(x1, y1, x2, y2);
      return action.elementId != null
        ? `Swiped ${action.direction} on element id=${action.elementId}.`
        : action.target
          ? `Swiped ${action.direction} on target "${action.target}".`
        : `Swiped ${action.direction} on the screen.`;
    }
    case "type":
      await device.typeText(action.text);
      return `Sent text through WDA: "${action.text}".`;
    case "press_enter":
      await device.pressEnter();
      return "Pressed Enter/Return.";
    case "home":
      await device.home();
      return "Pressed Home.";
    case "wait":
      // wait is handled by stepDelay
      return "Waited for the UI to settle.";
    case "finish":
      // nothing to execute
      return undefined;
  }
}

function describeNode(node: ViewTreeNode): string {
  const text = node.label ?? node.value ?? node.type;
  return `${node.type} id=${node.id} "${String(text).slice(0, 120)}"`;
}

/** Generate a concrete hint suggestion from failure context */
function generateSuggestedHint(
  failureReason: "stalled" | "max_steps",
  history: HistoryEntry[],
  lastThinking: string | undefined,
): string | undefined {
  if (history.length === 0) return undefined;

  const recentActions = history.slice(-3);

  if (failureReason === "stalled") {
    // Repeated same action — describe what was attempted and suggest bypass
    const repeatedAction = recentActions[recentActions.length - 1]?.summary;
    if (!repeatedAction) return undefined;

    // Extract the element description from the action summary
    const idMatch = repeatedAction.match(/id=(\d+)/);
    if (idMatch) {
      return `The element id=${idMatch[1]} was tapped repeatedly without effect. Try an alternative way to achieve this step, or describe what button/element to use instead.`;
    }
    return `Action "${repeatedAction}" was repeated without progress. Describe an alternative navigation path for this step.`;
  }

  if (failureReason === "max_steps") {
    // Ran out of steps — summarize what happened toward the end
    const lastFew = recentActions.map((h) => h.summary).join(" → ");
    const stuckContext = lastThinking
      ? ` The VLM was thinking: "${lastThinking.slice(0, 150)}"`
      : "";
    return `Task ran out of steps. Last actions: ${lastFew}.${stuckContext} Consider breaking this into smaller subtasks or adding hints about the specific UI flow.`;
  }

  return undefined;
}

async function saveFailureArtifacts(
  device: DeviceAdapter,
  finalViewTree: string | undefined,
  reason: string,
): Promise<AgentLoopResult["artifacts"] | undefined> {
  const dir = path.join(os.tmpdir(), "runcue", `${Date.now()}-${reason}`);
  const artifacts: NonNullable<AgentLoopResult["artifacts"]> = {};

  try {
    await fs.mkdir(dir, { recursive: true });
    if (finalViewTree) {
      const finalViewTreePath = path.join(dir, "final-view-tree.json");
      await fs.writeFile(finalViewTreePath, finalViewTree, "utf-8");
      artifacts.finalViewTreePath = finalViewTreePath;
    }
    try {
      const screenshot = await device.screenshot();
      const screenshotPath = path.join(dir, "screenshot.png");
      await fs.writeFile(screenshotPath, screenshot);
      artifacts.screenshotPath = screenshotPath;
    } catch {
      // Screenshot artifacts are best effort.
    }
    return Object.keys(artifacts).length > 0 ? artifacts : undefined;
  } catch {
    return undefined;
  }
}

export async function runAgentLoop(
  device: DeviceAdapter,
  vlm: VLMAdapter,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const { task, maxSteps, stepDelay, verbose, inputMode: configInputMode, hints } = options;
  const history: HistoryEntry[] = [];
  let consecutiveRepeats = 0;
  let lastActionKey = "";
  const MAX_CONSECUTIVE_REPEATS = 3;
  let prevTreeNodeCount = 0;
  let prevFirstLabel = "";
  let prevVisibleText: string[] = [];
  let prevTreeJson = "";
  let forceScreenshotNextStep = false;
  let lastActionType = "";
  let latestViewTreeJson: string | undefined; // track for finalViewTree output

  // Overall timeout: default 120s, 0 = no timeout
  const DEFAULT_TIMEOUT_MS = 120_000;
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : 0;

  log.info(`Starting task: ${task}`);
  log.info(`Max steps: ${maxSteps}, delay: ${stepDelay}ms`);

  const screenInfo = await device.getScreenInfo();
  log.info(
    `Screen: ${screenInfo.width}×${screenInfo.height} @${screenInfo.scale}x`,
  );

  for (let step = 1; step <= maxSteps; step++) {
    // Check overall timeout before each step
    if (deadline > 0 && Date.now() > deadline) {
      const elapsed = Math.round((timeoutMs) / 1000);
      log.warn(`Overall timeout reached (${elapsed}s)`);
      const artifacts = await saveFailureArtifacts(device, latestViewTreeJson, "timeout");
      return {
        success: false,
        message: `Task timed out after ${elapsed}s at step ${step}/${maxSteps}`,
        steps: step - 1,
        history,
        finalViewTree: latestViewTreeJson,
        failureReason: "timeout",
        suggestion: `The task exceeded the ${elapsed}s timeout. Consider breaking it into smaller subtasks, or increase the timeout.`,
        lastActions: history.slice(-3).map((h) => h.summary),
        lastThinking: history.at(-1)?.thinking,
        artifacts,
      };
    }

    log.info(`\n── Step ${step}/${maxSteps} ──`);

    // 1. Get view tree first. Screenshot is captured on demand only.
    let viewTreeJson: string | undefined;
    let viewTree: ViewTreeNode[] | null = null;
    try {
      viewTreeJson = await device.getViewTree();
      viewTree = JSON.parse(viewTreeJson) as ViewTreeNode[];
      latestViewTreeJson = viewTreeJson;
      log.info(`View tree: ${viewTree.length} root nodes`);
      if (verbose) {
        log.debug(`View tree JSON: ${viewTreeJson}`);
      }
    } catch (err) {
      log.warn(`View tree failed: ${err}`);
      // viewTree stays null → resolveInputMode will fall back to screenshot
    }

    // 1b. Detect tree changes from previous step (inject into last history entry)
    if (viewTree && prevTreeNodeCount > 0 && history.length > 0) {
      const currentCount = countLeafNodes(viewTree);
      const currentFirstLabel = getFirstLeafLabel(viewTree);
      const currentVisibleText = flattenVisibleText(viewTree);
      if (
        currentCount !== prevTreeNodeCount ||
        (prevFirstLabel && prevFirstLabel !== currentFirstLabel) ||
        diffVisibleText(prevVisibleText, currentVisibleText).appeared.length > 0 ||
        diffVisibleText(prevVisibleText, currentVisibleText).disappeared.length > 0
      ) {
        const lastEntry = history[history.length - 1];
        const changeNote = describeUiChange(
          prevTreeNodeCount,
          currentCount,
          prevFirstLabel,
          currentFirstLabel,
          prevVisibleText,
          currentVisibleText,
        );
        if (changeNote) {
          appendHistoryHint(lastEntry, changeNote);
          log.info(changeNote);
        }
      }
    }

    // 1c. Detect tree-unchanged after an action and feed that fact back.
    if (viewTreeJson && prevTreeJson && viewTreeJson === prevTreeJson && history.length > 0) {
      const shouldUseVisualFallback = ["tap", "long_press", "tap_xy", "long_press_xy", "swipe", "wait"].includes(lastActionType);
      if (shouldUseVisualFallback) {
        forceScreenshotNextStep = true;
      }

      const unchangedHint =
        lastActionType === "wait"
          ? "No UI change detected after waiting. Do not keep waiting unless the screen clearly shows active progress; choose another actionable control or report failure if no path remains."
          : "No UI change detected after the previous action. Do not repeat the same action; choose another actionable control or report failure if no path remains.";
      log.warn(unchangedHint);
      const lastEntry = history[history.length - 1];
      appendHistoryHint(lastEntry, unchangedHint);
    }

    // 2. Resolve effective input mode for this step
    let effectiveInputMode = resolveInputMode(configInputMode, viewTree, forceScreenshotNextStep);
    if (forceScreenshotNextStep) {
      log.info(`Input mode: screenshot (forced — tree unchanged after previous action)`);
      forceScreenshotNextStep = false; // consume the flag
    } else if (effectiveInputMode === "hybrid") {
      log.info(`Input mode: hybrid (sparse tree — content likely in webview/canvas, attaching screenshot)`);
    } else {
      log.info(`Input mode: ${effectiveInputMode}${configInputMode ? ` (config: ${configInputMode})` : ""}`);
    }

    // 3. Capture screenshot only when current input mode needs visual context.
    let screenshot: Buffer | undefined;
    const ensureScreenshot = async (): Promise<Buffer | undefined> => {
      if (screenshot) return screenshot;
      try {
        screenshot = await device.screenshot();
        log.info("Screenshot captured");
        return screenshot;
      } catch (err) {
        log.error(`Screenshot failed: ${err}`);
        return undefined;
      }
    };

    if (effectiveInputMode === "screenshot" || effectiveInputMode === "hybrid") {
      const captured = await ensureScreenshot();
      if (!captured) {
        return {
          success: false,
          message: `Screenshot failed at step ${step}`,
          steps: step,
          history,
          finalViewTree: latestViewTreeJson,
          failureReason: "device_error",
          suggestion: "Screenshot capture failed. Check if the simulator is running and accessible.",
        };
      }
    }

    // 3b. Verify progress from the previous action before asking for the next action.
    if (history.length > 0) {
      try {
        const verification = await vlm.verifyTask({
          screenshot: effectiveInputMode === "viewtree" ? undefined : screenshot,
          viewTree: viewTreeJson,
          task,
          history,
          screenInfo,
          inputMode: effectiveInputMode,
        });
        const hint = progressVerifierHint(verification);
        log.info(hint);

        if (verification.complete && verification.confidence >= 0.6) {
          return {
            success: true,
            message: verification.reason,
            steps: step - 1,
            history,
            finalViewTree: latestViewTreeJson,
          };
        }

        const progress = verification.progress ?? "unknown";
        if (progress !== "advanced" && progress !== "unknown") {
          appendHistoryHint(history[history.length - 1], hint);
        }

        if (
          effectiveInputMode === "viewtree" &&
          viewTreeJson &&
          shouldEscalateObservation(verification)
        ) {
          const captured = await ensureScreenshot();
          if (captured) {
            effectiveInputMode = "hybrid";
            log.info(`Input mode upgraded to hybrid (progress verifier: ${verification.progress})`);
          }
        }
      } catch (err) {
        log.warn(`Progress verifier failed: ${err}`);
        appendHistoryHint(
          history[history.length - 1],
          `Progress verifier failed: ${String(err).slice(0, 200)}`,
        );
      }
    }

    // 4. Call LLM (with 1 retry)
    let result: { thinking: string; action: Action; raw: string };
    try {
      result = await callVLMWithRetry(vlm, {
          screenshot,
        viewTree: effectiveInputMode !== "screenshot" ? viewTreeJson : undefined,
        task,
        history,
        screenInfo,
        inputMode: effectiveInputMode,
        hints,
      });
    } catch (err) {
      // Content filter error on view tree text → retry with screenshot mode
      const errStr = String(err);
      if (
        effectiveInputMode === "viewtree" &&
        (errStr.includes("DataInspectionFailed") || errStr.includes("content_filter"))
      ) {
        log.warn(`Content filter blocked view tree text — retrying with screenshot mode`);
        try {
          screenshot ??= await device.screenshot();
          result = await callVLMWithRetry(vlm, {
            screenshot,
            viewTree: undefined,
            task,
            history,
            screenInfo,
            inputMode: "screenshot",
            hints,
          });
        } catch (retryErr) {
          log.error(`Screenshot fallback also failed: ${retryErr}`);
          const artifacts = await saveFailureArtifacts(device, latestViewTreeJson, "vlm_error");
          return {
            success: false,
            message: `LLM analysis failed at step ${step}: ${retryErr}`,
            steps: step,
            history,
            finalViewTree: latestViewTreeJson,
            failureReason: "vlm_error",
            suggestion: "VLM API call failed after retries. Check API key, network connectivity, and model availability.",
            artifacts,
          };
        }
      } else {
        log.error(`LLM call failed: ${err}`);
        const artifacts = await saveFailureArtifacts(device, latestViewTreeJson, "vlm_error");
        return {
          success: false,
          message: `LLM analysis failed at step ${step}: ${err}`,
          steps: step,
          history,
          finalViewTree: latestViewTreeJson,
          failureReason: "vlm_error",
          suggestion: "VLM API call failed. Check API key, network connectivity, and model availability.",
          artifacts,
        };
      }
    }

    log.info(`Thinking: ${result.thinking}`);
    log.info(`Action: ${actionSummary(result.action)}`);
    if (verbose) {
      log.debug(`Raw LLM output: ${result.raw}`);
    }

    // 4. Check if task is finished. A separate verifier prevents the planner
    // from marking an intermediate UI state as successful.
    if (result.action.type === "finish") {
      let verification: VLMVerifyTaskResult;
      try {
        const verifierScreenshot = effectiveInputMode === "viewtree" ? undefined : screenshot;
        verification = await vlm.verifyTask({
          screenshot: verifierScreenshot,
          viewTree: viewTreeJson,
          task,
          history,
          screenInfo,
          inputMode: effectiveInputMode,
        });
      } catch (err) {
        log.warn(`Completion verifier failed: ${err}`);
        history.push({
          step,
          summary: actionSummary(result.action),
          thinking: result.thinking,
          error: String(err),
          hint: "Completion could not be verified. Continue by observing the current UI and choose a concrete next action or fail explicitly.",
        });
        if (step < maxSteps) {
          await new Promise((resolve) => setTimeout(resolve, stepDelay));
        }
        continue;
      }

      if (!verification.complete || verification.confidence < 0.6) {
        const hint = verifierRejectHint(verification);
        log.warn(hint);
        history.push({
          step,
          summary: actionSummary(result.action),
          thinking: result.thinking,
          hint,
        });
        if (step < maxSteps) {
          await new Promise((resolve) => setTimeout(resolve, stepDelay));
        }
        continue;
      }

      log.info(`\nTask completed: ${result.action.message}`);
      return {
        success: true,
        message: result.action.message,
        steps: step,
        history,
        finalViewTree: latestViewTreeJson,
      };
    }

    // 5. Execute action
    let actionError: string | undefined;
    let executionFeedback: string | undefined;
    const visualLocate: VisualLocateFn = async (target, actionName, direction) => {
      screenshot ??= await device.screenshot();
      log.info(`Visual locator: locating "${target}" for ${actionName}`);
      return vlm.locateTarget({
        screenshot,
        target,
        action: actionName,
        direction,
        viewTree: viewTreeJson,
        screenInfo,
      });
    };
    try {
      executionFeedback = await executeAction(device, result.action, viewTree ?? [], screenInfo, visualLocate);
      log.info(`Executed: ${actionSummary(result.action)}`);
    } catch (err) {
      actionError = String(err);
      log.error(`Action execution failed: ${actionError}`);
    }

    // 6. Track consecutive repeated actions
    const currentActionKey = actionSummary(result.action);
    if (currentActionKey === lastActionKey) {
      consecutiveRepeats++;
      if (consecutiveRepeats >= MAX_CONSECUTIVE_REPEATS) {
        log.warn(`${MAX_CONSECUTIVE_REPEATS} consecutive identical actions — aborting`);
        const stalledLastActions = history.slice(-3).map((h) => h.summary);
        const artifacts = await saveFailureArtifacts(device, latestViewTreeJson, "stalled");
        return {
          success: false,
          message: `Task stalled: repeated "${currentActionKey}" ${MAX_CONSECUTIVE_REPEATS} times`,
          steps: step,
          history,
          finalViewTree: latestViewTreeJson,
          failureReason: "stalled",
          suggestion: "The UI may be stuck or the target element is not interactable. Try adding hints about how to navigate this screen, or adjust the task description.",
          lastActions: stalledLastActions,
          lastThinking: result.thinking,
          suggestedHint: generateSuggestedHint("stalled", history, result.thinking),
          artifacts,
        };
      }
    } else {
      consecutiveRepeats = 0;
    }
    lastActionKey = currentActionKey;
    lastActionType = result.action.type;

    // 6b. After type action, provide feedback to the model
    let inputFeedback: string | undefined;
    if (result.action.type === "type" && !actionError) {
      const typedText = result.action.text;
      try {
        const currentValue = await device.getFocusedInputValue();
        if (currentValue) {
          inputFeedback = `Text entered through WDA. Current input field value: "${currentValue}". Do NOT re-type "${typedText}" — proceed to the next step.`;
          log.info(`Input field value: ${currentValue}`);
        } else {
          inputFeedback = `Text "${typedText}" was sent through WDA. Do NOT re-type it — proceed to the next step.`;
        }
      } catch {
        inputFeedback = `Text "${typedText}" was sent through WDA. Do NOT re-type it — proceed to the next step.`;
      }
    }

    // 6c. Record current tree stats for change detection in next step
    // (viewTree is the tree from the START of this step, before action execution)
    if (viewTree) {
      prevTreeNodeCount = countLeafNodes(viewTree);
      prevFirstLabel = getFirstLeafLabel(viewTree);
      prevVisibleText = flattenVisibleText(viewTree);
    }
    prevTreeJson = viewTreeJson ?? "";

    // 7. Record history
    history.push({
      step,
      summary: actionSummary(result.action),
      thinking: result.thinking,
      error: actionError,
      hint: [executionFeedback, inputFeedback].filter(Boolean).join(" ") || undefined,
    });

    // 8. Wait for UI to settle
    if (step < maxSteps) {
      await new Promise((resolve) => setTimeout(resolve, stepDelay));
    }
  }

  // Max steps reached
  log.warn(`Max steps (${maxSteps}) reached without completion`);
  const maxStepsLastActions = history.slice(-3).map((h) => h.summary);
  const maxStepsLastThinking = history.length > 0 ? history[history.length - 1].thinking : undefined;
  const artifacts = await saveFailureArtifacts(device, latestViewTreeJson, "max_steps");
  return {
    success: false,
    message: `Task did not complete within ${maxSteps} steps`,
    steps: maxSteps,
    history,
    finalViewTree: latestViewTreeJson,
    failureReason: "max_steps",
    suggestion: `Task needed more than ${maxSteps} steps. Increase maxSteps, break into smaller subtasks, or add hints to guide the VLM through tricky UI flows.`,
    lastActions: maxStepsLastActions,
    lastThinking: maxStepsLastThinking,
    suggestedHint: generateSuggestedHint("max_steps", history, maxStepsLastThinking),
    artifacts,
  };
}

const VLM_TIMEOUT_MS = 60_000;

async function callVLMWithRetry(
  vlm: VLMAdapter,
  input: VLMAnalyzeInput,
): Promise<{ thinking: string; action: Action; raw: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await Promise.race([
        vlm.analyze(input),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("VLM call timed out")), VLM_TIMEOUT_MS),
        ),
      ]);
      return result;
    } catch (err) {
      if (attempt === 0) {
        log.warn(`LLM call failed (attempt 1), retrying: ${err}`);
        continue;
      }
      throw err;
    }
  }
  throw new Error("LLM call failed after retries");
}
