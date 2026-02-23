# Plugin Manifest Format

## 1. Overview

Every plugin is described by a `manifest.json` file hosted at a publicly accessible URL. This is the **only** input required to install a plugin — NanoFleet does the rest.

```
POST /api/plugins/install
{ "manifestUrl": "https://example.com/my-plugin/manifest.json" }
```

---

## 2. Full Manifest Schema

```json
{
  "name": "nanofleet-chat",
  "version": "1.0.0",
  "description": "Multi-agent chat channels for NanoFleet",
  "author": "NanoFleet",
  "image": "ghcr.io/nanofleet/nanofleet-chat:latest",
  "mcpPort": 8811,
  "uiPort": 8810,
  "requiredEnvVars": [],
  "sidebar": {
    "icon": "MessageSquare",
    "label": "Chat",
    "route": "/plugins/nanofleet-chat/ui"
  },
  "toolsDoc": "## nanofleet-chat — Multi-agent chat\n\nYou have access to a shared chat system..."
}
```

---

## 3. Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique plugin identifier. Used as the MCP server name injected into agent config. Must be URL-safe (no spaces). |
| `version` | string | ✅ | Semver version string (e.g. `"1.2.0"`). |
| `description` | string | ❌ | Human-readable description shown in the UI. |
| `author` | string | ❌ | Author name or organization. |
| `image` | string | ✅ | Full Docker image reference. Must be pullable by the host's Docker daemon. |
| `mcpPort` | integer | ✅ | Port the MCP server listens on **inside the container**. NanoFleet connects to `http://{containerName}:{mcpPort}/mcp`. |
| `uiPort` | integer | ❌ | Port the web frontend listens on inside the container. Required if `sidebar` is declared. NanoFleet proxies `/api/plugins/:name/ui/*` to this port. |
| `requiredEnvVars` | string[] | ❌ | List of environment variable names that must exist in NanoFleet's API Key Vault before the plugin can start. |
| `sidebar` | object | ❌ | If present, injects a navigation entry in the Dashboard sidebar. |
| `sidebar.icon` | string | ✅ (if sidebar) | Lucide React icon name (e.g. `"MessageSquare"`, `"Calendar"`, `"Kanban"`). |
| `sidebar.label` | string | ✅ (if sidebar) | Navigation label shown in the sidebar. |
| `sidebar.route` | string | ✅ (if sidebar) | Frontend route path. Convention: `/plugins/{name}/ui`. Must be unique across installed plugins. |
| `toolsDoc` | string | ❌ | Markdown documentation for the plugin's tools, injected into each agent's `TOOLS.md` file. Updated automatically on every agent restart. |

---

## 4. Validation Rules

NanoFleet validates the manifest at install time and rejects it if:

- `name`, `version`, `image`, `mcpPort` are missing or wrong type
- `mcpPort` is not an integer between 1024 and 65535
- `uiPort` is present but not an integer between 1024 and 65535
- `name` contains characters outside `[a-z0-9-]`
- `image` is empty
- `sidebar.icon` is not a recognized Lucide icon name (soft warning, not hard error)
- Two installed plugins declare the same `sidebar.route`

---

## 5. Environment Variables Injected at Runtime

NanoFleet automatically injects the following env vars into every plugin container:

| Variable | Description |
|----------|-------------|
| `NANO_API_URL` | Internal URL of the NanoFleet API (e.g. `http://nanofleet-api:3000`) |
| `NANO_INTERNAL_TOKEN` | Shared secret for authenticating callbacks to the API |
| `NANO_PLUGIN_ID` | UUID of this plugin record in the DB |

Any additional variables listed in `requiredEnvVars` are pulled from NanoFleet's API Key Vault and injected as well.

---

## 6. Example: Minimal Plugin (No Sidebar)

A plugin that only provides MCP tools to agents, with no UI:

```json
{
  "name": "weather-api",
  "version": "0.1.0",
  "description": "Provides weather data tools to agents",
  "image": "ghcr.io/myorg/nanofleet-weather:latest",
  "mcpPort": 8820,
  "requiredEnvVars": ["OPENWEATHER_API_KEY"],
  "toolsDoc": "## weather-api\n\n### get_weather\nReturns current weather for a location.\n- `location` (string): city name or coordinates"
}
```

---

## 7. Example: Full Plugin (With Sidebar + UI)

A plugin with MCP tools, a Dashboard sidebar entry, and its own web frontend:

```json
{
  "name": "nanofleet-kanban",
  "version": "1.0.0",
  "description": "Kanban board for agent task tracking",
  "author": "NanoFleet",
  "image": "ghcr.io/nanofleet/nanofleet-kanban:latest",
  "mcpPort": 8812,
  "uiPort": 8813,
  "requiredEnvVars": [],
  "sidebar": {
    "icon": "Kanban",
    "label": "Tasks",
    "route": "/plugins/nanofleet-kanban/ui"
  },
  "toolsDoc": "## nanofleet-kanban\n\n### create_task\nCreate a new task on the kanban board.\n- `title` (string): task title\n- `column` (string): board column (todo, in-progress, done)"
}
```

---

## 8. Plugin Development: MCP Server Requirements

Every plugin container **must** expose an MCP-compatible HTTP server at `POST /mcp` on the declared `mcpPort`. At minimum it must handle:

- `initialize` — return plugin capabilities
- `tools/list` — return the list of available tools with their input schemas
- `tools/call` — execute a tool and return the result

The NanoFleet API calls `tools/list` at install time to register the plugin's capabilities. Agents call the MCP server **directly** (not via a proxy) using the URL injected in their `config.json`:

```
http://nanofleet-plugin-{name}:{mcpPort}/mcp?agent_id={agentId}
```

The `agent_id` query parameter lets the plugin identify which agent is calling.

Recommended libraries:
- Python: [`mcp`](https://github.com/modelcontextprotocol/python-sdk)
- TypeScript/Bun: [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
