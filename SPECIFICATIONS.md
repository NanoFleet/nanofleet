# NanoFleet - Project Specifications

## 1. Project Overview

**NanoFleet** is a self-hosted fleet manager for AI agents. It allows users to deploy, manage, and interact with a fleet of autonomous AI agents directly from a Web Dashboard.

Instead of relying on heavy monolithic architectures or locked-in cloud providers, NanoFleet leverages **Docker**, **Nanobot** (as the lightweight agent engine), and the **Model Context Protocol (MCP)** to create a secure, extensible, and fully sovereign ecosystem.

### Core Principles

- **Sovereignty & Privacy:** 1 Agent = 1 isolated Docker container. Execution runs locally or on the user's VPS.
- **Extensibility:** Dynamic plugin system using isolated MCP Docker containers.
- **English-First:** All source code, variables, commits, and user interfaces must be written in English.
- **Strict i18n:** No hardcoded strings in React components. All text goes through `t('key')` referencing `en.json`.

---

## 2. Architecture

> See [`docs/01-architecture-overview.md`](docs/01-architecture-overview.md) for a full breakdown of the tech stack, monorepo structure, and data flow.

**Summary:**
- **Monorepo:** Bun Workspaces + Turborepo
- **API:** TypeScript, Bun, Hono, Drizzle ORM, Docker Engine SDK
- **Web:** TypeScript, React, Vite, TailwindCSS
- **Agent Engine:** [Nanobot](https://github.com/HKUDS/nanobot) (Python, File-First approach)
- **Database:** SQLite (Drizzle ORM)
- **Communication:** WebSockets, REST, MCP (Model Context Protocol)

---

## 3. Authentication & Security

> See [`docs/02-api-and-auth.md`](docs/02-api-and-auth.md) for the full authentication architecture.

- Mandatory 2FA (TOTP) for all users
- Dual JWT tokens: short-lived Access Token (15min) + rotating Refresh Token (7d)
- First-boot Bootstrap Mode: generates temp password + QR code in terminal
- Emergency recovery: `bun apps/api/scripts/reset-2fa.ts` wipes TOTP secret and re-enters Bootstrap Mode

---

## 4. Agent Engine (Nanobot)

Agents follow a File-First configuration design. An **Agent Pack** consists of:

- `SOUL.md` — defines the agent's persona, behavior rules, and constraints
- `TOOLS.md` — explains how the agent should use its available MCP tools
- `/skills` — optional directory containing custom scripts for the agent

> See [`docs/05-agent-packs.md`](docs/05-agent-packs.md) for the full pack format and orchestrator integration.

---

## 5. Plugin System

Plugins are **independent Docker containers** exposing an MCP server. NanoFleet acts as the MCP router.

- Installed by pointing NanoFleet at a `manifest.json` URL
- Can declare a sidebar slot to inject UI into the Dashboard
- Agents opt-in to plugins individually

> See [`docs/plugins/`](docs/plugins/) for the full plugin architecture and manifest format.

### Official plugins

| Plugin | Description |
|--------|-------------|
| [nanofleet-tasks](https://github.com/NanoFleet/nanofleet-tasks) | Kanban task manager for human-agent collaboration |
| [nanofleet-vault](https://github.com/NanoFleet/nanofleet-vault) | Secret manager with per-agent access control |
