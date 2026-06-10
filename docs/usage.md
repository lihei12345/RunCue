# RunCue Usage Guide

This guide covers the public CLI and MCP workflows.

## Prerequisites

- macOS with Xcode installed.
- Node.js 20 or newer.
- An iOS Simulator or trusted physical iOS device.
- A VLM provider API key, such as `DASHSCOPE_API_KEY` for the default DashScope Qwen VL provider.
- For physical devices: Developer Mode, device trust, unlocked device, and WDA signing configuration.

## Install

```bash
npm install -g runcue
```

Local development:

```bash
npm install
npm run build
node dist/cli.js --help
```

## Configure Models

RunCue reads model provider API keys from environment variables by default:

```bash
export DASHSCOPE_API_KEY="your-dashscope-api-key"
```

Inspect or update local config:

```bash
runcue config list
runcue config set model.provider dashscope-vl-flash
```

## Device Selection

List devices visible to Xcode:

```bash
runcue devices
```

Always pass an explicit simulator name or UDID. Avoid ambiguous values such as `booted`, especially when multiple simulators are running.

## Run a UI Task

```bash
runcue run "Log in and navigate to the order detail page" \
  --device "iPhone 17 Pro Simulator" \
  --platform ios-simulator \
  --bundle-id com.example.MyApp \
  --max-steps 12 \
  --timeout 120
```

Important options:

| Option | Meaning |
| --- | --- |
| `--device <id>` | Device UDID or simulator name. |
| `--platform <platform>` | `ios-simulator` or `ios-device`. |
| `--bundle-id <id>` | Target bundle id; required with `--fresh-app`. |
| `--fresh-app` | Terminate and relaunch the bundle before running. |
| `--max-steps <n>` | Maximum agent loop steps. Default: `10`. |
| `--timeout <seconds>` | Overall timeout. Default: `120`; `0` disables. |
| `--hints <hints...>` | Product-specific facts or retry hints. |
| `--provider <name>` / `--model <name>` | Override model provider or model. |
| `--dry-run` | Analyze without executing actions. |
| `--output text|json` | Output format. |

Use `--fresh-app` for independent system-app or app-start scenarios where old state may pollute the first screen:

```bash
runcue run "Open Maps and search for coffee" \
  --device "iPhone 17 Pro Simulator" \
  --platform ios-simulator \
  --bundle-id com.apple.Maps \
  --fresh-app
```

Do not use `--fresh-app` if your build tool intentionally prepared a deep app state that RunCue should continue from.

## Check the Current Screen

```bash
runcue check "Is the current screen the order detail page?" \
  --device "iPhone 17 Pro Simulator" \
  --platform ios-simulator \
  --bundle-id com.example.MyApp
```

`check` performs observation and VLM analysis without taking UI actions.

## Diagnose WDA

```bash
runcue doctor \
  --device "iPhone 17 Pro Simulator" \
  --platform ios-simulator
```

Use JSON output for agent consumption:

```bash
runcue doctor --device "iPhone 17 Pro Simulator" --platform ios-simulator --output json
```

## Debug Commands

These are intended for manual debugging rather than normal agent workflows:

```bash
runcue screenshot --device <device> --platform ios-simulator --output screen.png
runcue tap 120 340 --device <device> --platform ios-simulator
runcue swipe 200 700 200 200 --device <device> --platform ios-simulator
runcue type "hello" --device <device> --platform ios-simulator
```

Prefer `runcue run` for multi-step flows, because the agent loop observes, plans, and verifies after actions.

## MCP Server

Start the MCP server over stdio:

```bash
runcue mcp
```

Example config:

```toml
[mcp_servers.RunCue]
type = "stdio"
command = "runcue"
args = ["mcp"]
```

Local checkout:

```toml
[mcp_servers.RunCue]
type = "stdio"
command = "node"
args = ["/absolute/path/to/RunCue/dist/cli.js", "mcp"]
```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `runcue_run` | Execute a multi-step UI task. |
| `runcue_check` | Analyze current UI state without actions. |
| `runcue_devices` | List devices visible to Xcode. |
| `runcue_doctor` | Diagnose WDA readiness. |

`runcue_run` parameters:

| Parameter | Required | Notes |
| --- | --- | --- |
| `task` | Yes | Natural-language task. Be specific. |
| `deviceId` | Yes | Exact simulator/device name or UDID. Do not use `booted`. |
| `platform` | No | `ios-simulator` or `ios-device`. |
| `bundleId` | No | Required when `freshApp=true`; recommended for system apps. |
| `freshApp` | No | Terminate and relaunch `bundleId` before running. |
| `maxSteps` | No | Default: `10`. |
| `hints` | No | Product facts or retry guidance. |
| `timeout` | No | Seconds; default: `120`; `0` disables. |

Failure outputs may include `failureReason`, `lastActions`, `lastThinking`, `suggestedHint`, and artifacts. When a useful `suggestedHint` appears, store it and pass it back through `hints` on retry.
