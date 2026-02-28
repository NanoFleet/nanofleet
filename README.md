# NanoFleet

Management layer for [nanofleet-agent](https://github.com/NanoFleet/nanofleet-agent) instances. Deploy and manage a fleet of AI agents from a single web dashboard, extend them with plugins, and connect them to external platforms via channels.

> [!WARNING]
> The project is currently in beta and is therefore not ready for production use.

<table>
  <tr>
    <td><img width="2486" height="1694" alt="NanoFleet Agent" src="https://github.com/user-attachments/assets/517a9c18-7400-46f2-b44d-c404432adbc4" /></td>
    <td><img width="2486" height="1694" alt="NanoFleet Dashboard" src="https://github.com/user-attachments/assets/3a0f68a2-91a5-4ac8-a4bf-8567bbbde37b" /></td>
  </tr>
</table>

## Features

- Deploy [nanofleet-agent](https://github.com/NanoFleet/nanofleet-agent) instances as isolated Docker containers
- Web dashboard to manage agents, monitor logs, and chat in real time
- Plugin system — extend agents with MCP tools and custom UIs
- Agent packs — portable zip files defining an agent's identity, tools, and rules
- Channel management — connect agents to external platforms (Telegram, ...) directly from the UI

## Getting started

> [!NOTE]
> Some browser APIs (e.g. `crypto.randomUUID`) require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (HTTPS or `localhost`). Accessing the app over a plain HTTP public IP will cause errors. Use HTTPS (see below) or an SSH tunnel.

<details>
<summary><strong>Local</strong></summary>

```bash
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — set ENCRYPTION_KEY, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET
# Uncomment and set NANOFLEET_HOST_HOME to the absolute path on your host machine
docker compose up --build
```

- Web: http://localhost:8080

On first boot, the API prints a temporary password and a QR code in the terminal. Scan it with an authenticator app to set up 2FA.

</details>

<details>
<summary><strong>Production with HTTPS (Traefik + Let's Encrypt)</strong></summary>

The `docker-compose.yml` includes a Traefik service that automatically provisions a TLS certificate via Let's Encrypt. It is disabled by default and activated with the `prod` profile.

**Prerequisites:** a domain name pointing to your server (port 80 and 443 open).

```bash
DOMAIN=your.domain.com \
ACME_EMAIL=you@email.com \
  docker compose --profile prod up --build -d
```

- Web: https://your.domain.com

</details>

<details>
<summary><strong>Production without a domain (SSH tunnel)</strong></summary>

If you don't have a domain or want to keep the server private, you can access NanoFleet securely via an SSH tunnel — no HTTPS configuration needed:

```bash
# On your local machine
ssh -L 8080:localhost:8080 user@your-server-ip
```

Then open http://localhost:8080 in your browser. Traffic goes through the SSH tunnel, so the app runs in a secure context without needing a certificate.

</details>

### Local development

```bash
bun install
cp apps/api/.env.example apps/api/.env
bun run dev
```

- API: http://localhost:3000
- Web: http://localhost:5173

**Reset the database:**

```bash
rm apps/api/nanofleet.db
```

## Documentation

| File | Description |
|------|-------------|
| [docs/01-architecture-overview.md](docs/01-architecture-overview.md) | Monorepo structure, tech stack, data flow |
| [docs/02-api-and-auth.md](docs/02-api-and-auth.md) | Authentication, 2FA, JWT, internal token |
| [docs/03-docker-orchestration.md](docs/03-docker-orchestration.md) | Agent lifecycle, Docker networking, log streaming |
| [docs/04-mcp-and-plugins.md](docs/04-mcp-and-plugins.md) | MCP protocol, plugin architecture |
| [docs/05-agent-packs.md](docs/05-agent-packs.md) | Agent packs format |
| [docs/06-ui-and-design-system.md](docs/06-ui-and-design-system.md) | UI design system |
| [docs/07-chat-system.md](docs/07-chat-system.md) | Direct chat and agent messaging |
| [docs/plugins/](docs/plugins/) | Plugin system deep-dive |

## Official plugins

| Plugin | Description |
|--------|-------------|
| [nanofleet-tasks](https://github.com/NanoFleet/nanofleet-tasks) | Kanban task manager for human-agent collaboration |
| [nanofleet-vault](https://github.com/NanoFleet/nanofleet-vault) | Secret manager with per-agent access control |
