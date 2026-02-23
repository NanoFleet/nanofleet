# MCP Router — How Agents Call Plugin Tools

## 1. Overview

Agents call plugin MCP servers **directly** — the NanoFleet API is not on the hot path for tool calls. The API's role is to:

1. Call `tools/list` at install time to populate the in-memory registry and store the tool list in DB
2. Inject the correct MCP server URL into each agent's `config.json` at startup
3. Proxy the plugin's web frontend via `/api/plugins/:name/ui/*` (for the Dashboard iframe)

---

## 2. Agent Configuration (Tool Injection)

When an agent is started, NanoFleet generates its `config.json`. For each plugin enabled via `agent_plugins`, it injects an `mcpServers` entry pointing **directly to the plugin container**:

```json
{
  "tools": {
    "restrictToWorkspace": true,
    "mcpServers": {
      "nanofleet-chat": {
        "url": "http://nanofleet-plugin-nanofleet-chat:8811/mcp?agent_id=abc123"
      },
      "weather-api": {
        "url": "http://nanofleet-plugin-weather-api:8820/mcp?agent_id=abc123"
      }
    }
  }
}
```

The `agent_id` query parameter lets the plugin identify the calling agent without requiring authentication headers.

The nanobot engine calls `tools/list` on each configured MCP server at startup to discover available tools.

---

## 3. Tool Call Flow

```
Agent (nanobot)
    │
    │  POST http://nanofleet-plugin-nanofleet-chat:8811/mcp?agent_id=abc123
    │  { "method": "tools/call", "params": { "name": "send_message_to_channel", ... } }
    ▼
Plugin Container (nanofleet-chat)
    │  Read agent_id from session (stored at initialize time)
    │  Execute tool logic
    │  May call back to NanoFleet API via NANO_API_URL + NANO_INTERNAL_TOKEN
    │  Return JSON-RPC result
    ▼
Agent (nanobot)
    │  Receives tool result, continues execution
```

The NanoFleet API is only involved if the plugin needs to call back (e.g. `GET /internal/agents` to resolve agent names, or `POST /internal/agents/:id/messages` to forward a message to another agent).

---

## 4. UI Proxy Endpoints

The NanoFleet API provides an HTTP proxy for plugin frontends. This allows the Dashboard to embed plugin UIs in an `<iframe>` without CORS issues.

### `GET|POST /api/plugins/:name/ui/*`

Transparent proxy to `http://{containerName}:{uiPort}{path}`. All methods and headers are forwarded.

The plugin frontend receives a `?nf_token=` query parameter (set by `PluginPage.tsx`) containing the user's JWT. The plugin can use this token to authenticate its own REST calls back through the proxy.

**Errors:**
- `404` — No plugin named `:name` is installed and running, or `uiPort` not declared
- `502` — Plugin container is unreachable

### `ALL /api/plugins/:name/rest/*`

Proxy to the plugin's REST endpoints (same container, same `uiPort` by default). Used by the plugin frontend for data calls.

---

## 5. In-Memory Plugin Registry

The API maintains an in-memory registry rebuilt at startup from DB:

```typescript
interface PluginRegistryEntry {
  pluginId: string;
  containerName: string;
  mcpPort: number;
  tools: string[];
  toolsDoc: string | null;
}

// Map: pluginName → registry entry
const pluginRegistry = new Map<string, PluginRegistryEntry>();
```

On API restart:
1. Load all `status = "running"` plugins from DB
2. Connect to each plugin's MCP server and call `tools/list`
3. Populate the registry
4. If a plugin is unreachable, mark it as `status = "error"` in DB

---

## 6. Security Model

| Threat | Mitigation |
|--------|------------|
| Agent calls a plugin it's not linked to | `agent_plugins` is checked before writing `config.json` — unlisted plugins are simply not injected |
| Plugin receives calls from unknown agents | Plugin reads `agent_id` from session; can verify against `NANO_API_URL /internal/agents` if needed |
| Plugin calls back to the API without authorization | `NANO_INTERNAL_TOKEN` required for all `/internal/*` endpoints |
| Plugin escapes Docker network | Container attached only to `nanofleet-net`, no host network access |
| Plugin accesses agent workspace | Plugins have no volume mounts by default; only communication is via MCP and REST callbacks |
| iframe frontend accesses other plugins | Each plugin's iframe is sandboxed to its own proxy path `/api/plugins/:name/ui/*` |
