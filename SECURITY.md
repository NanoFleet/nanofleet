# Security Policy

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please use [GitHub private security advisories](../../security/advisories/new) to report vulnerabilities confidentially. All reports will be addressed promptly.

Include as much of the following as possible:
- Type of vulnerability
- Affected source file(s) and location
- Steps to reproduce
- Proof-of-concept or exploit code (if available)
- Impact assessment

## Security Model

### Authentication

- Login requires a username/password and a TOTP code (2FA mandatory)
- Sessions use short-lived JWT access tokens (15 min) and rotating refresh tokens (7 days), signed with `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET`
- Passwords are hashed before storage

### API Key Encryption

Agent API keys are encrypted at rest using XOR+Base64 keyed by `ENCRYPTION_KEY`. This provides obfuscation against casual inspection of the database file, but is **not** cryptographically strong encryption. Anyone with access to both the database and `ENCRYPTION_KEY` can recover all API key values.

The threat model assumes:
- The host running NanoFleet is trusted
- The database file is not directly accessible to untrusted parties
- `ENCRYPTION_KEY` is kept confidential

### Internal Token

`INTERNAL_TOKEN` authenticates communication between the NanoFleet API and plugin containers. It must be kept confidential and is not exposed to end users.

## Security Best Practices

- Use strong, unique values for `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `ENCRYPTION_KEY`, and `INTERNAL_TOKEN`
- Restrict network access to the NanoFleet API — it should not be exposed directly to the public internet
- Restrict access to the host and Docker volumes (database files, agent workspaces)
- Keep the Docker images up to date
