// ============================================================
// RunCue Core Types
// ============================================================

/** Supported platforms */
export type Platform = "ios" | "android";

/** iOS runtime target kind */
export type RuntimePlatform = "ios-simulator" | "ios-device";

/** Screen information for coordinate conversion */
export interface ScreenInfo {
  /** Logical width in points (e.g. 390 for iPhone 16) */
  width: number;
  /** Logical height in points (e.g. 844 for iPhone 16) */
  height: number;
  /** Device pixel ratio (e.g. 3 for @3x) */
  scale: number;
}

// ============================================================
// Actions — parsed from LLM output
// ============================================================

export type Action =
  | { type: "tap"; elementId: number }
  | { type: "tap_target"; target: string }
  | { type: "long_press"; elementId: number }
  | { type: "long_press_target"; target: string }
  | { type: "tap_xy"; x: number; y: number }
  | { type: "long_press_xy"; x: number; y: number }
  | { type: "swipe"; direction: "up" | "down" | "left" | "right"; elementId?: number; target?: string }
  | { type: "type"; text: string }
  | { type: "press_enter" }
  | { type: "home" }
  | { type: "wait" }
  | { type: "finish"; message: string };

// ============================================================
// View Tree — accessibility tree node (compact format)
// ============================================================

export interface ViewTreeNode {
  id: number;
  label?: string;
  value?: string;
  type: string;
  frame: { x: number; y: number; w: number; h: number };
  enabled?: boolean;
  children?: ViewTreeNode[];
}

// ============================================================
// VLM raw output — legacy JSON format (backward compatibility)
// ============================================================

export interface VLMRawOutput {
  thought: string;
  action: string;
  coordinate?: [number, number];
  from?: [number, number];
  to?: [number, number];
  text?: string;
  message?: string;
}

// ============================================================
// VLM Adapter
// ============================================================

export interface HistoryEntry {
  /** Step number */
  step: number;
  /** Text summary of the action taken */
  summary: string;
  /** VLM's thinking for this step */
  thinking: string;
  /** Error message if action execution failed */
  error?: string;
  /** Hint injected by agent loop (e.g., repeated action warning) */
  hint?: string;
}

export interface VLMAnalyzeInput {
  /** Screenshot PNG binary (only present in screenshot/hybrid/visual fallback modes) */
  screenshot?: Buffer;
  /** Compact accessibility tree JSON */
  viewTree?: string;
  /** Task description from user */
  task: string;
  /** History of previous steps (text only, images stripped) */
  history: HistoryEntry[];
  /** Screen resolution for coordinate conversion */
  screenInfo: ScreenInfo;
  /** Resolved input mode for this step */
  inputMode: "viewtree" | "screenshot" | "hybrid";
  /** Domain-specific hints from the caller (e.g., app-specific navigation tips) */
  hints?: string[];
}

export interface VLMAnalyzeResult {
  /** VLM's thinking/reasoning */
  thinking: string;
  /** Parsed action (elementId-based, not yet resolved to coordinates) */
  action: Action;
  /** Raw model output string */
  raw: string;
}

export interface VLMLocateTargetInput {
  /** Current screenshot PNG binary */
  screenshot: Buffer;
  /** Semantic target from planner, e.g. "Login button" */
  target: string;
  /** Action that will be performed at the located point */
  action: "tap" | "long_press" | "swipe";
  /** Optional swipe direction for swipe target locating */
  direction?: "up" | "down" | "left" | "right";
  /** Compact accessibility tree for native context if available */
  viewTree?: string;
  /** Screen resolution for coordinate output */
  screenInfo: ScreenInfo;
}

export interface VLMLocateTargetResult {
  x: number;
  y: number;
  confidence: number;
  reason?: string;
}

export interface VLMVerifyTaskInput {
  /** Current screenshot PNG binary when the current mode already needed vision */
  screenshot?: Buffer;
  /** Compact accessibility tree JSON */
  viewTree?: string;
  /** Original user task */
  task: string;
  /** Recent factual action/results history */
  history: HistoryEntry[];
  /** Screen resolution for screenshot interpretation */
  screenInfo: ScreenInfo;
  /** Observation mode used for this verification */
  inputMode: "viewtree" | "screenshot" | "hybrid";
}

export interface VLMVerifyTaskResult {
  complete: boolean;
  confidence: number;
  progress?: "advanced" | "unchanged" | "regressed" | "looped" | "unknown";
  reason: string;
  nextGoal?: string;
  avoidRepeat?: string[];
}

export interface VLMAdapter {
  readonly name: string;
  analyze(input: VLMAnalyzeInput): Promise<VLMAnalyzeResult>;
  locateTarget(input: VLMLocateTargetInput): Promise<VLMLocateTargetResult>;
  verifyTask(input: VLMVerifyTaskInput): Promise<VLMVerifyTaskResult>;
}

// ============================================================
// Device Adapter
// ============================================================

export interface DeviceAdapter {
  readonly platform: Platform;
  readonly deviceId: string;

  screenshot(): Promise<Buffer>;
  getScreenInfo(): Promise<ScreenInfo>;
  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, duration?: number): Promise<void>;
  swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    duration?: number,
  ): Promise<void>;
  typeText(text: string): Promise<void>;
  pressEnter(): Promise<void>;
  home(): Promise<void>;
  resetApp(): Promise<void>;

  /** Read the current value of the focused text field (if any) */
  getFocusedInputValue(): Promise<string | null>;

  /** Get the accessibility tree of the current screen (compact JSON) */
  getViewTree(): Promise<string>;
}

// ============================================================
// Device Info (for device listing)
// ============================================================

export interface DeviceInfo {
  id: string;
  name: string;
  platform: Platform;
  state: "shutdown" | "unknown";
  runtime?: string;
}

// ============================================================
// Agent Loop
// ============================================================

export interface AgentLoopOptions {
  /** Task description */
  task: string;
  /** Maximum number of steps */
  maxSteps: number;
  /** Delay between steps in ms */
  stepDelay: number;
  /** Verbose logging */
  verbose: boolean;
  /** Input mode override from provider config */
  inputMode?: "viewtree" | "screenshot";
  /** Domain-specific hints injected into VLM prompt (e.g., app-specific navigation tips) */
  hints?: string[];
  /** Overall timeout in milliseconds — the entire loop must finish within this duration */
  timeout?: number;
}

export interface AgentLoopResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** Final message from VLM */
  message: string;
  /** Number of steps executed */
  steps: number;
  /** History of all steps */
  history: HistoryEntry[];
  /** View tree JSON from the final step — agent can use this to understand current page state */
  finalViewTree?: string;
  /** Structured failure reason (only set when success=false) */
  failureReason?: "stalled" | "max_steps" | "timeout" | "action_error" | "vlm_error" | "device_error";
  /** Next-step suggestion for the calling agent */
  suggestion?: string;
  /** Last few actions attempted (for diagnostics — helps the calling agent understand what was tried) */
  lastActions?: string[];
  /** VLM's last reasoning (what the model was thinking when it got stuck) */
  lastThinking?: string;
  /** Auto-generated hint suggestion based on failure pattern — calling agent can pass this back via hints to retry */
  suggestedHint?: string;
  /** Diagnostic artifacts saved on failure */
  artifacts?: {
    finalViewTreePath?: string;
    screenshotPath?: string;
  };
}

// ============================================================
// Configuration
// ============================================================

export interface VLMProviderConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Which OpenAI wire API to use: "chat" (default) or "responses" */
  wireApi?: "chat" | "responses";
  /** Input mode: "viewtree" (default, text only) or "screenshot" (image only, coordinate-based) */
  inputMode?: "viewtree" | "screenshot";
  /** Custom HTTP headers to send with API requests (e.g., User-Agent override) */
  headers?: Record<string, string>;
}

export interface DeviceConfig {
  /** Default iOS runtime platform */
  defaultPlatform: RuntimePlatform;
}

export interface WDASigningConfig {
  teamId?: string;
  bundleIdPrefix?: string;
}

export interface WDAConfig {
  /** Existing WDA HTTP endpoint. If provided and healthy, RunCue uses it directly. */
  endpoint?: string;
  /** WebDriverAgent.xcodeproj path for auto bootstrap. */
  projectPath?: string;
  scheme: string;
  bootstrapPolicy: "auto" | "manual";
  reuseSession: boolean;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  healthCheckIntervalMs: number;
  autoRestart: boolean;
  signing?: WDASigningConfig;
}

export interface Config {
  defaultDevice: string;
  maxSteps: number;
  stepDelay: number;

  device: DeviceConfig;
  wda: WDAConfig;

  vlm: {
    default: string;
    providers: Record<string, VLMProviderConfig>;
  };
}
