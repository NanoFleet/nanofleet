# 03 - Docker Orchestration & Container Lifecycle

## 1. The Orchestrator Pattern
Unlike traditional web applications, the NanoFleet Hono backend serves a dual purpose: it is an API server and a **local container orchestrator**.

Instead of relying on heavy tools like Kubernetes or Docker Compose files for agent deployment, NanoFleet programmatically interacts with the host's Docker Daemon via the `@nanofleet/docker` package (a `dockerode` wrapper). This allows the Dashboard to deploy, stop, and destroy agents and plugins dynamically.

## 2. Infrastructure Isolation (Network & Volumes)

To ensure security and proper communication, the orchestrator manages specific Docker resources.

### 2.1 The Internal Network (`nanofleet-net`)
* Upon initialization, the backend ensures a dedicated, isolated Docker bridge network named `nanofleet-net` exists.
* All Agent containers and Plugin containers are attached to this network.
* Containers can resolve each other by container name (e.g., `http://nanofleet-plugin-tasks:3001`).
* No ports are exposed to the host machine by default.

### 2.2 The Workspaces (Host Bind Mounts)
All workspace directories live under `~/.nanofleet/` on the host and are bind-mounted into containers.

* **Per-agent workspace:** `~/.nanofleet/agents/{agentId}/` → mounted at `/workspace` inside the agent container.
  * Contains `SOUL.md`, `.mcp.json`, `skills/`, and any files the agent produces.
  * Only the owning agent's container has this mount.
* **Shared workspace:** `~/.nanofleet/shared/` → mounted at `/shared` in every agent container.
  * Used to exchange artifacts between agents.
* **Plugin data volume:** Each plugin gets a named Docker volume `nanofleet-plugin-{name}-data` mounted at `/data` for persistent plugin data.

## 3. Agent Lifecycle Management

### 3.1 Spawning an Agent (Deployment)
1. **Payload Reception:** The user requests to deploy an Agent Pack via `POST /api/agents`.
2. **Workspace Setup:** The API copies pack files (`SOUL.md`, `skills/`) to `~/.nanofleet/agents/{agentId}/` and generates `.mcp.json` containing MCP endpoint URLs for all linked plugins.
3. **Container Creation:** The orchestrator calls `docker.createContainer()`.
   * **Image:** `ghcr.io/nanofleet/nanofleet-agent:latest`
   * **Name:** `nanofleet-agent-{agentId}`
   * **Binds:**
     - `~/.nanofleet/agents/{agentId}` → `/workspace`
     - `~/.nanofleet/shared` → `/shared`
   * **Env:** `AGENT_MODEL`, `AGENT_WORKSPACE=/workspace`, `MEMORY_DB_PATH`, `PORT=4111`, and the provider API key (e.g. `ANTHROPIC_API_KEY`).
4. **Start:** `container.start()`. The agent is now alive and listening on port `4111` (internal network only).
5. **Log Streaming:** The API attaches to container `stdout`/`stderr` and broadcasts log chunks to the Web Dashboard via WebSocket.

### 3.2 Stopping and Resuming
* **Stop (Pause):** `container.stop()` — gracefully stops the agent container. Status set to `stopped`.
* **Resume:** `container.start()` on the existing container. Log streaming is re-attached. Status set to `running`.
* **Delete:** `container.stop()` + `container.remove()`. The agent's workspace files are left intact on the host.

### 3.3 Upgrade
When a user triggers an upgrade (`POST /api/agents/:id/upgrade`):
1. The old container is stopped and removed.
2. A new container is created from the latest `nanofleet-agent:latest` image with the same workspace bind-mount.
3. The provider API key is re-resolved from the vault.

## 4. Agent ↔ API Communication

Agent containers expose an HTTP API on port `4111` (Mastra framework). The NanoFleet API communicates with agents via direct HTTP calls on the internal Docker network:

* `GET  http://nanofleet-agent-{id}:4111/health` — health check
* `GET  http://nanofleet-agent-{id}:4111/api/agents/main/usage` — token usage
* `GET  http://nanofleet-agent-{id}:4111/identity` — agent identity
* `GET  http://nanofleet-agent-{id}:4111/skills` — available skills
* `POST http://nanofleet-agent-{id}:4111/api/agents/main/generate` — send a message to the agent

The `/internal/agents/:id/messages` endpoint on the NanoFleet API proxies user messages to agents, requiring a valid internal token.

## 5. Real-Time Log Streaming

After `container.start()`, the API calls `attachToContainerLogs()` which attaches to the container's `stdout`/`stderr` stream and broadcasts log chunks over WebSocket to the Dashboard. This provides live observability into the agent's background activity.
