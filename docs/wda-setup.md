# WDA Setup

RunCue controls iOS through WebDriverAgent (WDA). The npm package vendors `appium-webdriveragent` so RunCue can bootstrap WDA without requiring users to clone a separate repository.

## Simulator

For simulators, the usual requirements are:

- Xcode is installed and selected with `xcode-select`.
- The target simulator is available to Xcode.
- The simulator is booted or can be booted by your normal workflow.
- The target app is installed and launched, unless you are using `--fresh-app` for an already installed bundle.

Useful commands:

```bash
runcue devices
runcue doctor --device "iPhone 17 Pro Simulator" --platform ios-simulator
```

## Physical Device

Physical devices require additional setup:

- The device is trusted by the Mac.
- Developer Mode is enabled.
- The device is unlocked while RunCue runs.
- WDA signing is configured with an Apple Developer Team ID.

You can provide signing through environment/config, for example:

```bash
export RUNCUE_WDA_TEAM_ID="YOUR_TEAM_ID"
runcue doctor --device <device-udid> --platform ios-device
```

If WDA fails to build or launch, run `runcue doctor` first and fix the reported signing, trust, or device availability issue.

## Bundle ID and Fresh App

WDA needs a concrete bundle id when RunCue terminates and relaunches an app:

```bash
runcue run "Open the settings page" \
  --device <device> \
  --platform ios-simulator \
  --bundle-id com.example.MyApp \
  --fresh-app
```

Without `--fresh-app`, `bundleId` is still recommended for system apps and multi-app sessions because it helps WDA bind to the intended app context.
