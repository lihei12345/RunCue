# Troubleshooting

Start with `doctor`:

```bash
runcue doctor --device <device-or-udid> --platform ios-simulator
runcue doctor --device <device-or-udid> --platform ios-device --output json
```

## Device Not Found

- Run `runcue devices` and copy the exact name or UDID.
- Do not pass `booted` in multi-simulator sessions.
- Make sure Xcode can see the simulator/device.

## WDA Not Ready

- Run `runcue doctor`.
- For simulators, confirm Xcode is installed and the simulator runtime is available.
- For physical devices, confirm trust, Developer Mode, unlock state, and signing.
- Set `RUNCUE_WDA_TEAM_ID` or equivalent config when signing is required.

## `freshApp` Validation Error

`freshApp` requires `bundleId`:

```bash
runcue run "Open Maps" --bundle-id com.apple.Maps --fresh-app --device <device>
```

If another tool already prepared the desired app state, omit `--fresh-app`.

## Agent Loops or Taps the Wrong Element

- Add more precise task text.
- Pass reusable product facts through `--hints` or MCP `hints`.
- Prefer semantic hints over coordinates.
- On failure, inspect `lastActions`, `lastThinking`, and `suggestedHint`.

Example retry:

```bash
runcue run "Search for the nearest store and start navigation" \
  --device <device> \
  --platform ios-simulator \
  --bundle-id com.apple.Maps \
  --fresh-app \
  --hints "If there is no Start button, tap the Route Steps item in the route card."
```

## Model/API Failures

- Confirm the provider API key is set, for example `DASHSCOPE_API_KEY`.
- Run `runcue config list` to check provider settings.
- Use `--provider` / `--model` to override a single command.

## Sensitive Data

RunCue may send screenshots, accessibility trees, visible UI text, and task descriptions to the configured model provider. Avoid posting logs or screenshots that contain credentials, user data, private device identifiers, or unreleased product information.
