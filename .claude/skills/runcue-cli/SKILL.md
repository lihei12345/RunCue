---
name: runcue-cli
description: |
  RunCue CLI — drive iOS UI navigation and state checks from natural-language tasks.
  Use after the target app is already built, installed, and launched. RunCue talks to
  WebDriverAgent for navigation, text input, observation, and verification.
  Trigger when a user needs to navigate an iOS app flow, reproduce a UI scenario,
  fill forms, or check the current UI state.
  Parameter format: /runcue-cli <run|check|devices|doctor> [options]
version: 1.0.0
compatibility: macOS + Xcode + iOS Simulator / physical iOS device
---

### Overview

RunCue is a developer UI navigation tool. It accepts a natural-language task and
runs a multi-step UI loop: observe the current screen, ask a VLM for the next
action, execute through WebDriverAgent, and verify progress until the task is
complete or blocked.

RunCue is intentionally scoped to UI navigation and checking. Build, install,
launch, screenshots, logs, and debugging should stay in Xcode, XcodeBuildMCP, or
the user's normal build workflow.

### Core Commands

**Run a UI task**:
```bash
runcue run "<task>" --device <UDID-or-simulator-name> --platform ios-simulator [options]
```

Useful options:

- `--bundle-id <id>`: target app bundle id; required with `--fresh-app`.
- `--fresh-app`: terminate and relaunch the target bundle before running.
- `--max-steps <n>`: increase for complex flows.
- `--timeout <seconds>`: set overall timeout; `0` disables it.
- `--hints <hints...>`: pass reusable product facts or non-standard UI guidance.

**Check the current UI state without actions**:
```bash
runcue check "<question>" --device <UDID-or-simulator-name> --platform ios-simulator
```

**List devices**:
```bash
runcue devices
```

**Diagnose WDA setup**:
```bash
runcue doctor --device <UDID-or-simulator-name> --platform ios-simulator
```

### Examples

```bash
runcue devices

runcue doctor \
  --device "iPhone 17 Pro Simulator" \
  --platform ios-simulator

runcue run "Log in with the test account and navigate to the order detail page" \
  --device "iPhone 17 Pro Simulator" \
  --platform ios-simulator \
  --bundle-id com.example.MyApp \
  --max-steps 12

runcue check "Is the current screen the order detail page?" \
  --device "iPhone 17 Pro Simulator" \
  --platform ios-simulator
```

### Collaboration Rules

1. Build/install/launch the app first, then call RunCue.
2. Always pass the exact simulator name or UDID used for the app under test.
3. Do not use ambiguous device names such as `booted` in multi-device sessions.
4. Put product-specific UI facts in the task or `--hints`; do not hard-code them
   into RunCue's generic agent loop.
5. After RunCue finishes, capture screenshots or logs with the normal build/debug
   tooling if needed.
