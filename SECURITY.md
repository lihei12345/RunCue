# Security Policy

## Reporting a Vulnerability

Please report security issues privately through the repository security advisory flow if available, or by contacting the maintainers listed in the repository.

Do not open a public issue with exploit details, credentials, API keys, device identifiers, or private app information.

## Sensitive Data

RunCue may process screenshots, accessibility trees, visible UI text, and user-provided task descriptions. These can contain private data from the app under test. Configure model providers and logging according to your organization's data handling requirements.

Never commit:

- API keys or model provider tokens.
- Apple Developer Team IDs if they are private to your organization.
- Physical device identifiers from private fleets.
- Screenshots or logs containing user data.
