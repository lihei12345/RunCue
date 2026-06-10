import type {
  DeviceAdapter,
  RuntimePlatform,
  ScreenInfo,
  ViewTreeNode,
  WDAConfig,
} from "../core/types.js";
import { createLogger } from "../utils/logger.js";
import { WDAManager } from "./wda-manager.js";

const log = createLogger("wda-device");

type WDAValueResponse<T> = { value: T; sessionId?: string };

interface WDASourceNode {
  type?: string;
  name?: string;
  label?: string;
  value?: string | number | boolean | null;
  enabled?: boolean;
  visible?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  frame?: { x: number; y: number; width: number; height: number };
  children?: WDASourceNode[];
}

interface RectBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WDADeviceAdapterOptions {
  deviceId: string;
  platform?: RuntimePlatform;
  bundleId?: string;
  config: WDAConfig;
}

export class WDADeviceAdapter implements DeviceAdapter {
  readonly platform = "ios" as const;
  readonly deviceId: string;

  private readonly runtimePlatform: RuntimePlatform;
  private readonly bundleId?: string;
  private readonly manager: WDAManager;
  private sessionId: string | null = null;
  private cachedScreenInfo: ScreenInfo | null = null;

  constructor(options: WDADeviceAdapterOptions) {
    this.deviceId = options.deviceId;
    this.runtimePlatform = options.platform ?? "ios-simulator";
    this.bundleId = options.bundleId;
    this.manager = new WDAManager({
      deviceId: options.deviceId,
      platform: this.runtimePlatform,
      config: options.config,
    });
  }

  async screenshot(): Promise<Buffer> {
    const sessionId = await this.ensureSession();
    const response = await this.request<string>(`/session/${sessionId}/screenshot`);
    return Buffer.from(response, "base64");
  }

  async getScreenInfo(): Promise<ScreenInfo> {
    if (this.cachedScreenInfo) return this.cachedScreenInfo;

    const tree = JSON.parse(await this.getViewTree()) as ViewTreeNode[];
    const root = tree[0];
    if (root?.frame?.w && root?.frame?.h) {
      this.cachedScreenInfo = {
        width: Math.round(root.frame.w),
        height: Math.round(root.frame.h),
        scale: 1,
      };
      return this.cachedScreenInfo;
    }

    this.cachedScreenInfo = { width: 393, height: 852, scale: 1 };
    return this.cachedScreenInfo;
  }

  async tap(x: number, y: number): Promise<void> {
    await this.performPointerGesture([
      { type: "pointerMove", duration: 0, x: Math.round(x), y: Math.round(y) },
      { type: "pointerDown", button: 0 },
      { type: "pause", duration: 80 },
      { type: "pointerUp", button: 0 },
    ]);
  }

  async longPress(x: number, y: number, duration = 1000): Promise<void> {
    await this.performPointerGesture([
      { type: "pointerMove", duration: 0, x: Math.round(x), y: Math.round(y) },
      { type: "pointerDown", button: 0 },
      { type: "pause", duration },
      { type: "pointerUp", button: 0 },
    ]);
  }

  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    duration = 300,
  ): Promise<void> {
    await this.performPointerGesture([
      { type: "pointerMove", duration: 0, x: Math.round(x1), y: Math.round(y1) },
      { type: "pointerDown", button: 0 },
      { type: "pointerMove", duration, x: Math.round(x2), y: Math.round(y2) },
      { type: "pointerUp", button: 0 },
    ]);
  }

  async typeText(text: string): Promise<void> {
    const sessionId = await this.ensureSession();
    await this.request(`/session/${sessionId}/wda/keys`, "POST", {
      value: [...text],
    });
  }

  async pressEnter(): Promise<void> {
    await this.typeText("\n");
  }

  async home(): Promise<void> {
    const sessionId = await this.ensureSession();
    try {
      await this.request(`/session/${sessionId}/wda/pressButton`, "POST", { name: "home" });
    } catch {
      await this.request(`/session/${sessionId}/wda/homescreen`, "POST", {});
    }
  }

  async resetApp(): Promise<void> {
    if (!this.bundleId) {
      throw new Error("resetApp requires a bundleId. Pass --bundle-id or configure the target app bundle id.");
    }

    await this.manager.ensureReady();
    const previousSessionId = this.sessionId;
    this.sessionId = null;
    this.cachedScreenInfo = null;

    const controlSessionId = previousSessionId ?? await this.createSession(false);
    log.info(`Resetting app ${this.bundleId}`);
    await this.rawRequest(`/session/${controlSessionId}/wda/apps/terminate`, "POST", {
      bundleId: this.bundleId,
    }).catch(() => {
      // Terminate returns false or may fail if the app is already gone; the fresh app session below is the important step.
    });

    await this.rawRequest(`/session/${controlSessionId}`, "DELETE").catch(() => {
      // The app may have been terminated under the session; a stale session is acceptable here.
    });

    this.sessionId = await this.createSession(true);
  }

  async getFocusedInputValue(): Promise<string | null> {
    const sessionId = await this.ensureSession();
    try {
      const active = await this.request<{ ELEMENT?: string; "element-6066-11e4-a52e-4f735466cecf"?: string }>(
        `/session/${sessionId}/element/active`,
      );
      const elementId = active["element-6066-11e4-a52e-4f735466cecf"] ?? active.ELEMENT;
      if (!elementId) return null;
      const value = await this.request<string | null>(
        `/session/${sessionId}/element/${elementId}/attribute/value`,
      );
      return value;
    } catch {
      return null;
    }
  }

  async getViewTree(): Promise<string> {
    const sessionId = await this.ensureSession();
    const source = await this.request<WDASourceNode | WDASourceNode[] | string>(
      `/session/${sessionId}/source?format=json`,
    );
    if (typeof source === "string") {
      throw new Error("WDA returned XML source; JSON source is required");
    }
    let nextId = 0;
    const roots = Array.isArray(source) ? source : [source];
    const compacted = roots
      .map((node) => compactWDANode(node, () => nextId++))
      .filter((node): node is ViewTreeNode => Boolean(node));
    return JSON.stringify(compacted);
  }

  private async ensureSession(): Promise<string> {
    await this.manager.ensureReady();
    if (this.sessionId) return this.sessionId;

    this.sessionId = await this.createSession(true);
    return this.sessionId;
  }

  private async createSession(includeBundleId: boolean): Promise<string> {
    const capabilities: Record<string, unknown> = {
      platformName: "iOS",
    };
    if (includeBundleId && this.bundleId) capabilities.bundleId = this.bundleId;

    const response = await this.rawRequest<{ sessionId?: string; value?: { sessionId?: string } }>(
      "/session",
      "POST",
      {
        capabilities: { alwaysMatch: capabilities },
        desiredCapabilities: capabilities,
      },
    );

    const sessionId = response.sessionId ?? response.value?.sessionId ?? null;
    if (!sessionId) {
      throw new Error("WDA session creation succeeded but no sessionId was returned");
    }
    log.info(`WDA session ready: ${sessionId}`);
    return sessionId;
  }

  private async performPointerGesture(actions: Array<Record<string, unknown>>): Promise<void> {
    const sessionId = await this.ensureSession();
    await this.request(`/session/${sessionId}/actions`, "POST", {
      actions: [
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions,
        },
      ],
    });
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST" | "DELETE" = "GET",
    body?: unknown,
  ): Promise<T> {
    try {
      const response = await this.rawRequest<WDAValueResponse<T>>(path, method, body);
      return response.value;
    } catch (err) {
      if (!this.isRecoverableAppStateError(err)) {
        throw err;
      }

      log.warn(`WDA session/app state is stale; resetting session (${String(err).slice(0, 160)})`);
      const staleSessionId = this.sessionId;
      this.sessionId = null;
      this.cachedScreenInfo = null;

      if (!this.bundleId || method !== "GET" || !staleSessionId) {
        throw err;
      }

      const nextSessionId = await this.ensureSession();
      const retryPath = path.replace(`/session/${staleSessionId}`, `/session/${nextSessionId}`);
      const response = await this.rawRequest<WDAValueResponse<T>>(retryPath, method, body);
      return response.value;
    }
  }

  private async rawRequest<T>(
    path: string,
    method: "GET" | "POST" | "DELETE" = "GET",
    body?: unknown,
  ): Promise<T> {
    const url = `${this.manager.endpoint}${path}`;
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.manager.config.requestTimeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`WDA ${method} ${path} failed: ${response.status} ${text}`);
    }

    return (await response.json()) as T;
  }

  private isRecoverableAppStateError(err: unknown): boolean {
    const text = String(err);
    return text.includes("application under test") &&
      text.includes("not running") &&
      text.includes("bundle id");
  }
}

function compactWDANode(
  node: WDASourceNode,
  nextId: () => number,
  viewport?: RectBounds,
): ViewTreeNode | null {
  const frame = node.rect ?? node.frame ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.round(frame.x ?? 0);
  const y = Math.round(frame.y ?? 0);
  const width = Math.round(frame.width ?? 0);
  const height = Math.round(frame.height ?? 0);
  const currentBounds = { x, y, w: width, h: height };
  const nextViewport = viewport ?? (width > 0 && height > 0 ? currentBounds : undefined);

  const children = node.children
    ?.map((child) => compactWDANode(child, nextId, nextViewport))
    .filter((child): child is ViewTreeNode => Boolean(child));

  if (node.visible === false) return null;
  if (width <= 0 && height <= 0 && (!children || children.length === 0)) return null;
  if (viewport && !intersects(currentBounds, viewport) && (!children || children.length === 0)) {
    return null;
  }

  const result: ViewTreeNode = {
    id: nextId(),
    type: node.type ?? "Unknown",
    frame: {
      x,
      y,
      w: width,
      h: height,
    },
  };

  const label = node.label ?? node.name;
  if (label) result.label = String(label);

  if (node.value != null) result.value = String(node.value);
  if (node.enabled === false) result.enabled = false;

  if (children && children.length > 0) {
    result.children = children;
  }

  return result;
}

function intersects(a: RectBounds, b: RectBounds): boolean {
  return a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;
}
