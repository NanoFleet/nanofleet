# 04 - MCP & Plugin Architecture

## 1. The Extensibility Challenge
NanoFleet uses **Docker-isolated plugins** to extend agent capabilities. A Plugin is an independent Docker container that exposes an **MCP Server** (HTTP transport). This approach guarantees security — if a plugin crashes or misbehaves, it is fully isolated inside its container.

## 2. The Plugin Architecture (Containers as Plugins)

When a user installs a Plugin (e.g., `nanofleet-tasks`, `nanofleet-vault`):
1. The API fetches the plugin manifest from the provided URL.
2. It pulls and starts the Plugin's Docker image as a container on the `nanofleet-net` network.
3. The API polls the plugin's MCP server until it is ready (up to 15 seconds), fetching `tools/list`.
4. The plugin is registered in the **in-memory plugin registry** and stored in the database.

**Security Benefit:** Plugins cannot directly access the host or other containers except via the strict MCP channel managed by the central API.

## 3. Plugin Manifest

A plugin is installed by providing a URL to its `plugin-manifest.json`. The key fields are:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique plugin identifier |
| `version` | string | yes | Semantic version |
| `image` | string | yes | Docker image to pull and run |
| `mcpPort` | number | yes | Port where the MCP server listens |
| `uiPort` | number | no | Port for the plugin's web UI (proxied via `/api/plugins/:name/ui/*`) |
| `generateEnvVars` | string[] | no | Auto-generated env vars (random tokens) injected into the container |
| `mountShared` | boolean | no | If true, mounts `~/.nanofleet/shared` at `/shared` in the container |
| `replacesNativeFeatures` | string[] | no | Native Dashboard features this plugin replaces |
| `sidebar` | object | no | Sidebar slot configuration for the plugin's UI |

## 4. How Agents Use Plugins (The Tooling Flow)

Agents communicate with plugins directly over MCP — the NanoFleet API does **not** proxy MCP calls at runtime. Instead:

1. **Workspace generation:** When an agent is deployed or a plugin is linked, the API writes a `.mcp.json` file into the agent's workspace. This file lists all linked plugin MCP server URLs (e.g., `http://nanofleet-plugin-tasks:3001/mcp`).
2. **Discovery:** When the agent container boots, the Mastra framework reads `.mcp.json` and connects to each listed MCP server, calling `tools/list` to discover available tools.
3. **Action:** The agent calls MCP tools directly on plugin containers over the internal Docker network.

The agent and plugin containers communicate directly over `nanofleet-net` — both are on the same internal bridge network.

## 5. Plugin Registry (In-Memory)

The API maintains an in-memory `pluginRegistry` map keyed by plugin name:

```ts
interface PluginRegistryEntry {
  pluginId: string;
  containerName: string;
  mcpPort: number;
  uiPort: number | null;
  tools: string[];       // Tool names from last tools/list probe
}
```

The registry is rebuilt on API startup by probing each known plugin's MCP server. It is updated when plugins are installed, restarted, or removed.

## 6. Plugin UI Proxying

If a plugin has a `uiPort`, its web UI is accessible through the NanoFleet API as a transparent proxy:

* `GET /api/plugins/:name/ui/*` — proxies HTML/JS/CSS assets (no auth, iframe-safe)
* `ALL /api/plugins/:name/rest/*` — proxies REST API calls (JWT auth required)

This allows the Dashboard to embed plugin UIs in iframes without CORS issues.

## 7. Plugin Lifecycle

* **Install:** `POST /api/plugins/install` — fetch manifest, pull image, start container, probe MCP, register.
* **List:** `GET /api/plugins` — returns all plugins with their current tool list from the registry.
* **Restart:** `POST /api/plugins/:id/restart` — stop and start the container, re-probe tools.
* **Uninstall:** `DELETE /api/plugins/:id` — stop container, remove from registry, cascade-delete agent links, restart affected agents.
