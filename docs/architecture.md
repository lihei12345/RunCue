# RunCue Architecture

RunCue is a WDA-only iOS UI navigation tool for coding agents and developer workflows. It does not build, install, or debug the app under test. Instead, it assumes the target app or system app is already available, then uses WebDriverAgent plus a VLM-driven agent loop to navigate UI flows and verify state.

## System Boundary

```text
Coding agent / developer
  -> build tool or Xcode: build, install, launch, logs, screenshots
  -> RunCue CLI or MCP server
      -> Agent loop: observe -> plan -> locate -> act -> verify
      -> WDADeviceAdapter
          -> WebDriverAgent HTTP API
          -> iOS Simulator or physical iOS device
      -> VLM adapter
          -> OpenAI-compatible provider
```

RunCue owns:

- UI navigation tasks.
- UI state checks.
- WDA-backed tap, swipe, text input, screenshot, and accessibility source calls.
- Agent loop state, progress detection, and completion verification.

RunCue does not own:

- Xcode project build/test.
- App installation and initial launch, except `--fresh-app` relaunch for an already installed bundle.
- Runtime logs, breakpoints, or source-level debugging.
- Product-specific app rules hard-coded into RunCue.

## WDA-only Device Layer

RunCue's only iOS device control path is WebDriverAgent. There is no `simctl` backend, no `legacy-simctl` fallback, and no clipboard-paste text path.

Key modules:

| Module | Responsibility |
| --- | --- |
| `src/device/wda.ts` | WDA session, view tree, screenshots, actions, and `/keys` text input. |
| `src/device/wda-manager.ts` | WDA endpoint health checks, startup, and doctor diagnostics. |
| `src/device/xcode-devices.ts` | Lists devices visible to Xcode through `xcrun xctrace list devices`. |
| `src/device/factory.ts` | Creates the WDA device adapter. |
| `src/mcp/server.ts` | Exposes RunCue tools over MCP stdio. |
| `src/core/agent-loop.ts` | Runs the autonomous UI navigation loop. |
| `src/vlm/cloud-api.ts` | OpenAI-compatible VLM provider adapter. |

## Agent Loop

RunCue uses a layered GUI agent loop:

```text
Current observation
  -> Planner: choose the next semantic UI action
  -> Locator: resolve semantic target to current element or coordinates
  -> Executor: perform the action through WDA
  -> Progress verifier: detect advanced / unchanged / regressed / looped state
  -> Completion verifier: accept finish only when the original task is satisfied
```

The planner should describe intent, such as `tap(target="Search field")`, rather than rely on stale element ids. The locator always resolves against the current screen.

## Observation Strategy

RunCue is tree-first:

1. Prefer the current accessibility tree / WDA source.
2. Use screenshots only when the tree is unavailable, sparse, unchanged after an action, or insufficient for WebView, SwiftUI, custom-drawn UI, or third-party overlays.
3. Avoid carrying old screenshots or old element ids through the history.

Modes:

| Mode | Sent to VLM | Typical trigger |
| --- | --- | --- |
| `viewtree` | Accessibility tree | Normal native UI. |
| `hybrid` | Tree + current screenshot | Sparse tree, no progress, or custom UI. |
| `screenshot` | Current screenshot | Tree fetch failed or tree is unusable. |

## Hints and Product Knowledge

RunCue remains generic. If an app has hidden entry points, non-standard labels, or product-specific flow knowledge, pass that through the task or `hints` instead of adding app-specific logic to RunCue.

Example:

```text
Open Maps, search for the nearest store, and start navigation.
Hint: if there is no normal Start button, tap the Route Steps item in the route card.
```

## Diagrams

Current editable diagrams live in `docs/assets/`:

- `runcue-architecture-v2.svg` / `.png` / `.json`
- `runcue-agent-optimization-v2.svg` / `.png` / `.json`

The longer design record remains in [`tech-solution-v2.md`](tech-solution-v2.md).
