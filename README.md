# NanoFleet

A self-hosted fleet manager for AI agents. Deploy agents in isolated Docker containers, interact with them via a web dashboard, and extend them with plugins.

## Features

- Deploy agents as isolated Docker containers (powered by [nanobot](https://github.com/HKUDS/nanobot))
- Web dashboard to manage agents, monitor logs, and chat in real time
- Plugin system — extend agents with MCP tools and custom UIs
- Agent packs — portable zip files defining an agent's behavior, tools, and rules

## Stack

| Layer | Technology |
|-------|-----------|
| API | Bun + Hono |
| Web | Bun + React + Vite |
| Database | SQLite (Drizzle ORM) |
| Containers | Docker SDK |
| Auth | JWT (HS256) + TOTP |
| Agent engine | [nanobot](https://github.com/HKUDS/nanobot) |

## Getting started

### Docker (recommended)

```bash
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env — set ENCRYPTION_KEY, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET
# Uncomment and set NANOFLEET_HOST_HOME to the absolute path on your host machine
docker compose up --build
```

- Web: http://localhost:8080

On first boot, the API prints a temporary password and a QR code in the terminal. Scan it with an authenticator app to set up 2FA.

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

## Lint

```bash
bun run lint
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
| [nanofleet-chat](https://github.com/NanoFleet/nanofleet-chat) | Multi-agent chat channels |
| [nanofleet-tasks](https://github.com/NanoFleet/nanofleet-tasks) | Kanban task manager for human-agent collaboration |
| [nanofleet-vault](https://github.com/NanoFleet/nanofleet-vault) | Secret manager with per-agent access control |
