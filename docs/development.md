# Development

## Setup

```bash
npm install
npm run build
npm run lint
npm test
```

## Useful Commands

```bash
npm run dev              # TypeScript watch mode
npm run build            # Compile to dist/
npm run lint             # ESLint
npm test                 # Vitest test suite
npm pack --dry-run       # Verify npm package contents
npm audit                # Dependency audit
```

## Repository Principles

- Keep RunCue WDA-only for iOS control.
- Keep build/install/launch/logs outside RunCue.
- Keep product-specific UI facts in user tasks or hints, not hard-coded rules.
- Add tests for parser, MCP schema, device, and agent-loop behavior changes.
- Do not commit secrets, local MCP config, `.env` files, screenshots with user data, or private device identifiers.
