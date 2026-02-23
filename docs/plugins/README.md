# NanoFleet Plugin System

This directory contains the full technical documentation for the NanoFleet Plugin System (Phase 7).

## Documents

| File | Description |
|------|-------------|
| [01-architecture.md](./01-architecture.md) | Core plugin architecture, lifecycle, MCP router, SDUI |
| [02-plugin-manifest.md](./02-plugin-manifest.md) | Plugin manifest format and validation rules |
| [03-mcp-router.md](./03-mcp-router.md) | MCP gateway — how agents call plugin tools |

## Quick Concept

A **Plugin** in NanoFleet is:
- An **independent Docker container** running an MCP Server
- Installed by pointing NanoFleet at a `manifest.json` URL
- Scoped per agent via an opt-in `agent_plugins` table
- Optionally declaring a **sidebar slot** to inject UI into the Dashboard

Plugins never talk directly to agents. All communication goes through the central NanoFleet API acting as MCP Router.
