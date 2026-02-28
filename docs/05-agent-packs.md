# 05 - Agent Packs Structure

## 1. What is an Agent Pack?
From the Orchestrator's perspective, an Agent Pack is simply a standardized directory (or a `.zip` file extracted into a directory) containing the behavior, rules, and local tools for a specific agent persona. 

The Dashboard downloads these packs from the NanoFleet Marketplace or loads them from a local path, and the Orchestrator mounts them into the Agent's Docker container at boot.

## 2. Directory Structure
A valid Agent Pack must follow a strict "File-First" architecture:

```text
/my-agent-pack
├── manifest.json     # Metadata (Name, version, author, required env vars like OPENAI_API_KEY)
├── SOUL.md           # The core prompt: Persona, constraints, and professional tone
├── TOOLS.md          # Instructions on how the agent should use its available MCP tools
└── /skills           # (Optional) Directory containing custom Python scripts specific to this agent
```

## 3. manifest.json Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Pack identifier (display only) |
| `version` | string | yes | Semantic version (display only) |
| `author` | string | no | Pack author (display only) |
| `model` | string | yes | LLM model to use (e.g. `anthropic/claude-haiku-4-5`) |
| `requiredEnvVars` | string[] | no | API keys the agent needs, resolved from the vault at deploy time |

Web search is enabled by default for all agents (Anthropic native `webSearch_20250305` tool) — no configuration required.

Example:
```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "author": "you",
  "model": "anthropic/claude-haiku-4-5"
}
```

## 4. Orchestrator Integration
1. **Validation:** The API checks that `manifest.json` and `SOUL.md` exist in the pack.
2. **Env var resolution:** `requiredEnvVars` are looked up in the API key vault; deployment fails if any are missing.
3. **Workspace setup:** Pack files are copied; missing workspace files are created empty.
4. **`.mcp.json` generation:** Written with MCP endpoints of all plugins currently linked to the agent.
5. **Container launch:** Workspace bind-mounted at `/workspace`; model and provider key injected as env vars.
