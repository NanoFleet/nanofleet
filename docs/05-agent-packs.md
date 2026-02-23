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

## 3. Orchestrator Integration
1. **Validation:** When the user imports an Agent Pack, the API parses `manifest.json` to ensure compatibility and prompts the user for any missing API keys.
2. **Mounting:** When deploying the agent, the Orchestrator mounts this folder directly into the Nanobot Docker container (e.g., at `/app/config`).
3. **Execution:** The Nanobot engine reads `SOUL.md` to build its system prompt and reads `TOOLS.md` to understand the MCP capabilities provided by the Dashboard.
