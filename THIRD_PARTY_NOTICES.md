# Third-Party Notices

RunCue includes third-party open-source software. The notices below are provided for attribution and license compliance. Each vendored component keeps its upstream license file in the vendored directory.

## appium-webdriveragent

- Path: `vendor/appium-webdriveragent`
- Upstream: https://github.com/appium/WebDriverAgent
- Vendored version: `13.2.0`
- License files / metadata:
  - `vendor/appium-webdriveragent/LICENSE`
  - `vendor/appium-webdriveragent/package.json`
- Note: the vendored upstream package metadata and license file may use different SPDX-style summaries across versions. RunCue preserves the upstream license file in place; use the vendored `LICENSE` file as the complete redistribution notice for the bundled code.

RunCue vendors WebDriverAgent so the CLI can automatically bootstrap WDA for iOS simulators and physical devices. The upstream copyright and license terms remain owned by their respective contributors.

## npm Dependencies

Runtime and development npm dependencies are listed in `package.json` and locked in `package-lock.json`. Their package licenses are distributed by npm with each package.
