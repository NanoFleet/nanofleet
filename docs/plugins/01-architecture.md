# Plugin System — Architecture

## 1. Core Principle

A Plugin in NanoFleet is **not a script injected into the backend**. It is an **independent Docker container** that:

1. Exposes an **MCP Server** (JSON-RPC over HTTP) on a configurable port (`mcpPort`)
2. Optionally exposes a **web frontend** on a second port (`uiPort`)
3. Lives on the `nanofleet-net` internal Docker network
4. Is discovered and registered by the NanoFleet API at install time
5. Optionally declares a **sidebar slot** to inject navigation and UI into the Dashboard

This design provides:
- **Security isolation**: a buggy or malicious plugin is trapped in its container
- **Language independence**: plugins can be written in Python, Go, Bun, or any language
- **Dynamic extensibility**: install/uninstall without restarting the core API

---

## 2. Network Topology

```
┌──────────────────────────────────────────────────────────┐
│                    nanofleet-net (Docker bridge)         │
│                                                          │
│  ┌──────────────┐     MCP JSON-RPC     ┌──────────────┐  │
│  │              │◄────────────────────►│   Plugin A   │  │
│  │  NanoFleet   │     :mcpPort         │  MCP + UI    │  │
│  │     API      │     MCP JSON-RPC     ├──────────────┤  │
│  │              │◄────────────────────►│   Plugin B   │  │
│  │              │     :mcpPort         │  MCP only    │  │
│  └──────┬───────┘                      └──────────────┘  │
│         │                              ▲                 │
│  ┌──────┴───────┐  .mcp.json ──────────┘                 │
│  │  Agent A     │  agent calls plugin MCP directly       │
│  │  (nf-agent)  │                                        │
│  └──────────────┘                                        │
└──────────────────────────────────────────────────────────┘
         │
         │  REST + WebSocket + iframe proxy
         ▼
    Web Dashboard
```

Agents call plugin MCP servers **directly** via the URL injected in their `.mcp.json`. The NanoFleet API is not on the hot path for tool calls — it only calls `tools/list` at install time to populate the registry.

---

## 3. Plugin Lifecycle

### 3.1 Installation

```
POST /api/plugins/install
{ "manifestUrl": "https://example.com/my-plugin/manifest.json" }
```

Steps:
1. API fetches and validates `manifest.json` from `manifestUrl`
2. API calls `docker.pull(manifest.image)` to download the image
3. API starts the container:
   - Network: `nanofleet-net`
   - Env vars: `NANO_API_URL`, `NANO_INTERNAL_TOKEN` (shared secret for callbacks)
   - Container name: `nanofleet-plugin-{pluginName}`
4. API connects to `http://{containerName}:{manifest.mcpPort}/mcp` and calls `tools/list`
5. API registers all tools in the in-memory registry + DB
6. Plugin record saved to DB with `status: "running"`
7. **All existing agents are auto-linked** (`agent_plugins` rows inserted) and restarted (fire-and-forget) so their `.mcp.json` is updated

### 3.2 Tool Registration (in-memory registry)

```typescript
interface PluginRegistryEntry {
  pluginId: string;
  containerName: string;
  mcpPort: number;
  tools: string[];          // e.g. ["send_message_to_channel", "list_agents"]
  toolsDoc: string | null;  // markdown doc for this plugin's tools (stored in DB)
}

// Map: pluginName → registry entry
const pluginRegistry = new Map<string, PluginRegistryEntry>();
```

On API restart, the registry is rebuilt by reconnecting to all `running` plugins in DB.

### 3.3 Deletion

```
DELETE /api/plugins/:id
```

Steps:
1. Remove plugin from the in-memory registry
2. `container.stop()` + `container.remove()`
3. Delete `agent_plugins` rows (cascade)
4. Delete plugin row from DB
5. **All affected agents are restarted** (fire-and-forget) so their `.mcp.json` no longer references the deleted plugin

---

## 4. Agent ↔ Plugin Scope (Many-to-Many)

Plugins are **automatically linked to all existing agents** at install time, and to **new agents at creation time**. The `agent_plugins` join table records the link.

```
agents ──────< agent_plugins >────── plugins
```

When an agent is started, the API generates its `.mcp.json`. For each linked plugin, it adds an `mcpServers` entry pointing directly to the plugin container:

```json
{
  "tools": {
    "mcpServers": {
      "nanofleet-chat": {
        "url": "http://nanofleet-plugin-nanofleet-chat:8811/mcp?agent_id={agentId}"
      }
    }
  }
}
```

The agent discovers tools automatically via `tools/list` at startup.

---

## 5. SDUI — Sidebar Slots + iframe Frontend

A plugin can declare a **sidebar slot** to inject a navigation entry into the Dashboard:

```json
{
  "sidebar": {
    "icon": "MessageSquare",
    "label": "Chat",
    "route": "/plugins/nanofleet-chat/ui"
  }
}
```

When the user navigates to `/plugins/:name/ui`, the Web App renders a full-screen `<iframe>` pointing to `/api/plugins/:name/ui/`. The NanoFleet API proxies that path to `http://{containerName}:{uiPort}/`. The plugin frontend receives a `?nf_token=` query parameter so it can authenticate back-channel REST calls through the same proxy.

The plugin is fully responsible for its own UI — NanoFleet only provides the iframe proxy.

---

## 6. Database Schema

### `plugins` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (UUID) | Primary key |
| `name` | TEXT | Plugin name (from manifest) |
| `version` | TEXT | Plugin version |
| `image` | TEXT | Docker image reference |
| `mcpPort` | INTEGER | MCP server port inside the container |
| `uiPort` | INTEGER | Web frontend port inside the container (nullable) |
| `containerName` | TEXT | Docker container name |
| `status` | TEXT | `running`, `stopped`, `error` |
| `manifestUrl` | TEXT | Source URL of the manifest |
| `sidebarSlot` | TEXT (JSON) | Serialized sidebar declaration, or NULL |
| `toolsDoc` | TEXT | Markdown documentation for the plugin's tools, or NULL |
| `createdAt` | INTEGER | Unix timestamp |

### `agent_plugins` table

| Column | Type | Description |
|--------|------|-------------|
| `agentId` | TEXT | Foreign key → `agents.id` |
| `pluginId` | TEXT | Foreign key → `plugins.id` |

Primary key: `(agentId, pluginId)`.
