# 03 - Docker Orchestration & Container Lifecycle

## 1. The Orchestrator Pattern
Unlike traditional web applications, the NanoFleet Hono backend serves a dual purpose: it is an API server and a **local container orchestrator**.

Instead of relying on heavy tools like Kubernetes or Docker Compose files for agent deployment, NanoFleet programmatically interacts with the host's Docker Daemon using the Docker SDK for Node/TypeScript (`docker/node-sdk` or equivalent `dockerode` wrappers). This allows the Dashboard and Mobile App to deploy, pause, and destroy agents instantly.

## 2. Infrastructure Isolation (Network & Volumes)

To ensure security and proper communication, the orchestrator manages specific Docker resources.

### 2.1 The Internal Network (`nanofleet-net`)
* Upon initialization, the backend creates a dedicated, isolated Docker bridge network (e.g., `nanofleet-net`).
* All Agent (Nanobot) containers and Plugin containers are attached to this network.
* **Security:** Containers on this network can resolve each other and the main API container by name (e.g., `http://host.docker.internal:3000`), but they do not expose any ports to the host machine or the public internet.

### 2.2 The Workspaces (Host Bind Mounts)
All workspace directories live under `~/.nanofleet/` on the host and are bind-mounted into containers (not named Docker volumes, so the API can access them directly).

* **Per-agent workspace:** `~/.nanofleet/workspace/{agentId}/` → mounted at `/workspace/{agentId}` inside each container.
  * Contains `SOUL.md`, `TOOLS.md`, and any files the agent produces.
  * Only the owning agent's container has this mount.
* **Shared workspace:** `~/.nanofleet/shared/` → mounted at `/shared` in every container.
  * Used to exchange artifacts between agents (files, reports, generated code, etc.).
* **Rule:** System state (chat messages, Kanban cards, calendar events) is **NEVER** written to these directories. State mutations must go through MCP/API calls to the backend.

## 3. Agent Lifecycle Management

When a user initiates an action from the UI, the backend translates it into Docker API commands.

### 3.1 Spawning an Agent (Deployment)
1. **Payload Reception:** The user requests to deploy an "Agent Pack" (e.g., Marketing Lead).
2. **Configuration:** The backend reads the pack's `SOUL.md` and `TOOLS.md`, copies them to `~/.nanofleet/workspace/{agentId}/`, and generates `~/.nanofleet/instances/{agentId}/config.json`.
3. **Container Creation:** The orchestrator calls `docker.createContainer()`.
   * **Image:** `nanofleet-nanobot:latest` (custom build in `packages/docker/`).
   * **Binds:**
     - `~/.nanofleet/workspace/{agentId}` → `/workspace/{agentId}`
     - `~/.nanofleet/shared` → `/shared`
     - `~/.nanofleet/instances/{agentId}` → `/root/.nanobot`
   * **Env:** Injects `NANO_INTERNAL_TOKEN`, `NANO_API_URL`, `NANO_AGENT_ID`.
4. **Start:** The orchestrator calls `container.start()`. The agent is now alive and autonomous.
5. **Connection:** On boot, the container's NanoFleet channel connects back to `NANO_API_URL/internal/ws` using `NANO_INTERNAL_TOKEN` to register itself for bidirectional messaging.

### 3.2 Pausing, Resuming, and Terminating
* **Pause:** `container.pause()` freezes the agent's processes without losing its in-memory context. Useful to halt token spending temporarily.
* **Resume:** `container.unpause()` wakes the agent up.
* **Terminate:** `container.stop()` followed by `container.remove()`. The agent's temporary container is destroyed, leaving behind only the artifacts it produced in the workspace.

## 4. The NanoFleet Channel (Agent ↔ API Communication)

Nanobot does not expose any HTTP or WebSocket server by default. To enable bidirectional communication between the NanoFleet API and a running agent, a custom Python **channel** is injected into the container at build time.

### 4.1 How It Works
The `packages/docker/` directory contains:
* `nanofleet_channel.py` — A Python class extending nanobot's channel system. On startup, it connects to `NANO_API_URL/internal/ws`, authenticates with `NANO_INTERNAL_TOKEN`, then:
  * **Inbound:** Listens for `{ type: "message", content: "...", sessionKey: "..." }` from the API and pushes them into nanobot's `MessageBus.inbound`.
  * **Outbound:** Reads from nanobot's `MessageBus.outbound` and forwards responses back to the API.
* `entrypoint.sh` — Copies `nanofleet_channel.py` into nanobot's channels directory before launching `nanobot gateway`.

### 4.2 Internal WebSocket Endpoint (`/internal/ws`)
The NanoFleet API exposes a dedicated WebSocket endpoint for agent containers:
* **Auth:** `Authorization: Bearer <NANO_INTERNAL_TOKEN>` on connect. The API looks up the token in the DB to identify the `agentId`.
* **Agent registration:** The connection is stored in `agentConnections: Map<agentId, ServerWebSocket>`.
* **Message forwarding:**
  * API → Agent: `{ type: "message", content: "...", sessionKey: "nanofleet:{agentId}" }`
  * Agent → API: `{ type: "response", content: "...", agentId: "..." }` → saved to DB + broadcasted to UI clients via the existing `/ws` endpoint.

## 5. Real-Time Log Streaming (I/O)

The backend attaches to container `stdout`/`stderr` right after `container.start()` and broadcasts log chunks over the existing WebSocket room for that agent. This is used for observability (not for chat — chat goes through the NanoFleet channel described above).
