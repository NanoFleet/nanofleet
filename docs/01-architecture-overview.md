# 01 - NanoFleet Core Architecture Overview

## 1. Introduction
**NanoFleet** is a local-first AI agent orchestrator. It acts as the "Control Tower" for autonomous AI workers running as isolated Docker containers.

The system relies on a strict separation of concerns:
* The **State** (settings, agent config, workspace files) is managed by the central API and Database.
* The **Agents** (intelligence, actions) run in sandboxed Docker containers using the `nanofleet-agent` TypeScript runtime (Mastra framework).
* The **Artifacts** (files, generated reports, code) are stored in per-agent and shared host directories, bind-mounted into containers.

## 2. Monorepo Structure
NanoFleet is built as a **TypeScript Monorepo** managed by Bun Workspaces and Turborepo.

```text
/nanofleet
├── /apps
│   ├── /api          # Hono backend (Bun), Docker SDK, SQLite
│   └── /web          # React Web Dashboard (Vite, Tailwind)
│
├── /packages
│   ├── /shared       # Zod schemas, TypeScript interfaces (Agent, Plugin, Channel)
│   └── /docker       # Docker SDK wrapper (@nanofleet/docker)
│
└── /docs             # Technical documentation
```

## 3. Tech Stack Deep Dive

### 3.1 Backend (Orchestrator)
* **Runtime:** Bun.
* **Framework:** Hono (ultra-fast web framework).
* **Database:** SQLite, interfaced with **Drizzle ORM**.
* **Container Management:** `dockerode` wrapper (`@nanofleet/docker`) to programmatically spawn, stop, and destroy agent/plugin containers.

### 3.2 Frontend (Client)
* **Web:** React + Vite + Tailwind CSS.
* **State Management & Fetching:** TanStack Query (React Query) for REST calls, native WebSocket hooks for real-time logs.

### 3.3 AI & Extensibility
* **Agent Engine:** `nanofleet-agent` — a TypeScript/Bun runtime built on the **Mastra** framework. Each agent runs in a Docker container and exposes an HTTP API on port `4111`.
* **Communication Protocol:** Model Context Protocol (MCP) for interactions between agents and plugins.
* **Plugins:** Packaged as isolated Docker containers exposing an MCP Server (HTTP transport).

## 4. The Data Flow

1. **User Action:** The user clicks "Deploy Agent" on the Web Dashboard.
2. **API Request:** A REST request is sent to the Hono API (`POST /api/agents`).
3. **Workspace Setup:** The API creates the agent workspace under `~/.nanofleet/agents/{agentId}/`, copies pack files (`SOUL.md`, `skills/`), and generates `.mcp.json` with MCP endpoints for all linked plugins.
4. **Docker Orchestration:** The API uses the Docker SDK to spin up a new `nanofleet-agent` container, bind-mounting the workspace and injecting the model/API key as env vars.
5. **Real-Time Feedback:** The API attaches to the container's `stdout`/`stderr` and broadcasts log chunks to the Web Dashboard via WebSocket.
6. **Execution:** The agent reads its workspace files, performs tasks using the Mastra framework, and uses MCP to call plugin tools.
