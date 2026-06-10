# Contributing

Thanks for helping improve RunCue.

## Development Setup

See [docs/development.md](docs/development.md) for the detailed development guide.

```bash
npm install
npm run build
npm test
```

## Pull Requests

- Keep changes focused on one behavior or feature.
- Add or update tests for parser, MCP schema, device, and agent-loop changes.
- Run `npm run build`, `npm run lint`, and `npm test` before opening a pull request.
- Do not add app-specific UI hacks to the agent loop. Prefer generic planner, locator, executor, and verifier improvements.
- Do not commit secrets, local device names, `.env` files, or local MCP configuration.

## Architecture Principles

- RunCue is WDA-only for iOS automation.
- XcodeBuildMCP and Xcode remain responsible for build, install, launch, logs, and debugging.
- RunCue is responsible for navigation, text input, UI observation, and state checks.
- Product-specific facts belong in user tasks or hints, not hard-coded logic.
