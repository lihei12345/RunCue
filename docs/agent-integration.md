# Agent Integration Guide

This guide describes how coding agents should use RunCue alongside build tools such as Xcode, XcodeBuildMCP, or custom project scripts.

## Recommended Debug Loop

```text
Modify code
-> build/install/launch app with project tooling
-> RunCue navigates to the target UI state
-> RunCue check verifies current state if needed
-> build/debug tooling captures screenshots, logs, or test results
```

RunCue should be invoked after the target app is already running, unless the task intentionally uses `freshApp` to relaunch an already installed bundle.

## Collaboration Rules

1. Use build tooling for build, install, launch, logs, screenshots, and source debugging.
2. Use RunCue for UI navigation, text input, and UI state checks.
3. Pass the exact simulator/device name or UDID used by the build tool. Do not pass `booted`.
4. Pass `platform` explicitly when there is any ambiguity: `ios-simulator` or `ios-device`.
5. Pass `bundleId` for system apps, multi-app sessions, and any `freshApp` task.
6. Put app-specific facts in task text or `hints`; do not add hard-coded app rules to RunCue.
7. Do not mix RunCue UI actions with other tap/type automation at the same time.

## MCP Tools

```text
runcue_run(task, deviceId, platform?, bundleId?, freshApp?, maxSteps?, hints?, timeout?)
runcue_check(question, deviceId, platform?, bundleId?)
runcue_devices()
runcue_doctor(deviceId?, platform?)
```

## Example MCP Flow

1. Build and launch the app with your build tool.
2. List devices if the exact identifier is unknown:

```text
runcue_devices()
```

3. Navigate:

```json
{
  "task": "Log in with the test account and navigate to the order detail page",
  "deviceId": "iPhone 17 Pro Simulator",
  "platform": "ios-simulator",
  "bundleId": "com.example.MyApp",
  "maxSteps": 12
}
```

4. Verify:

```json
{
  "question": "Is the current screen the order detail page?",
  "deviceId": "iPhone 17 Pro Simulator",
  "platform": "ios-simulator",
  "bundleId": "com.example.MyApp"
}
```

## Hints Lifecycle

When `runcue_run` fails, it may return `suggestedHint`. Agents should treat hints as reusable but expiring product facts:

1. Store useful hints for the app or flow.
2. Apply them on retry through `hints`.
3. Expire them when UI changes or the same hint stops helping.

Prefer hints such as:

```text
On this route card, start navigation by tapping the Route Steps item when there is no normal Start button.
```

Avoid hard-coded coordinates unless debugging a one-off issue.

## Failure Handling

- Device or WDA issue: call `runcue_doctor`.
- Navigation stalled: inspect `failureReason`, `lastActions`, `lastThinking`, and `suggestedHint`.
- Visual ambiguity: retry with clearer task text or `hints`.
- Sensitive flows such as passwords, OTP, payment, or private data: consider manual takeover or limit what is sent to the configured model provider.
