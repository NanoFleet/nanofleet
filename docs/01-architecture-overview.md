# 01 - NanoFleet Core Architecture Overview

## 1. Introduction
**NanoFleet** is a local-first, mobile-first AI agent orchestrator. It acts as the "Control Tower" for autonomous AI workers running as isolated Docker containers. 

The system relies on a strict separation of concerns:
* The **State** (settings, UI interactions, chat, Kanban) is managed by the central API and Database.
* The **Agents** (intelligence, actions) run in ephemeral, sandboxed Docker containers using the Nanobot engine.
* The **Artifacts** (files, generated reports, code) are stored in a shared Docker volume, acting as the bridge between agents.

## 2. Monorepo Structure
NanoFleet is built as a **TypeScript Monorepo** managed by Bun Workspaces (or Turborepo). This ensures perfect type-safety across the backend, the web dashboard, and the mobile app.

```text
/nanofleet
├── /apps
│   ├── /api          # Hono backend (Bun), Docker SDK, SQLite/PostgreSQL
│   ├── /web          # React Web Dashboard (Vite, Tailwind)
│   └── /mobile       # Expo React Native App
│
├── /packages
│   ├── /shared       # Zod schemas, TypeScript interfaces (Agent, Task, Plugin)
│   ├── /ui           # UI Components / SDUI Engine
│   └── /docker       # Base Dockerfiles (Nanobot images, Plugin templates)
│
├── /docs             # Technical documentation
└── package.json      # Workspace configurations
```

## 3. Tech Stack Deep Dive

### 3.1 Backend (Orchestrator)
* **Runtime:** Bun (Chosen for its native, high-performance WebSocket engine).
* **Framework:** Hono (Ultra-fast, edge-compatible web framework).
* **Database:** SQLite (Default for local setups) or PostgreSQL, interfaced with **Drizzle ORM**.
* **Container Management:** `docker/node-sdk` to programmatically spawn, pause, and destroy agent/plugin containers.

### 3.2 Frontends (Clients)
* **Web:** React + Vite.
* **Mobile:** React Native + Expo.
* **State Management & Fetching:** TanStack Query (React Query) for REST calls, native WebSocket hooks for real-time logs and SDUI.
* **Internationalization:** `i18next` applied strictly to all text nodes.

### 3.3 AI & Extensibility
* **Agent Engine:** Nanobot (Python-based, file-first approach, extremely lightweight).
* **Communication Protocol:** Model Context Protocol (MCP) for interactions between the backend, agents, and plugins.
* **Plugins:** Packaged as isolated Docker containers exposing an MCP Server.

## 4. The Data Flow

1. **User Action:** The user taps "Deploy Agent" on the Mobile App.
2. **API Request:** A REST request is sent to the Hono API (`POST /api/agents`).
3. **Database Update:** The API registers the new agent in the DB (status: `starting`).
4. **Docker Orchestration:** The API uses the Docker SDK to spin up a new Nanobot container.
   * It mounts the `/shared_workspace` volume.
   * It injects a secure `NANO_INTERNAL_TOKEN`.
5. **Real-Time Feedback:** The Agent container boots up and connects to the API via WebSocket. The API broadcasts the `status: running` event to the Mobile App.
6. **Execution:** The Agent reads its `SOUL.md` and `TOOLS.md`, performs its tasks, writes output files to the shared volume, and uses MCP to update the Kanban board via the API.
