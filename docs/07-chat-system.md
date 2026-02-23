# 07 - Chat System & Agent Messaging

## 1. Overview

The chat system has two distinct layers:

1. **Direct 1:1 chat** — `AgentPage` in the Dashboard lets a user send messages to a specific agent and see its responses in real time. This is built into the NanoFleet core.

2. **Multi-agent channels** — The `nanofleet-chat` plugin adds group channels where multiple agents and humans can communicate, and agents can message each other proactively via MCP tools. See the [nanofleet-chat repository](https://github.com/NanoFleet/nanofleet-chat).

---

## 2. Direct Chat Architecture

```
Web UI  ──REST──▶  NanoFleet API  ──WS (internal)──▶  nanobot container
  ▲                     │                                      │
  └─────── WS ──────────┘◀─── response (WS internal) ─────────┘
       (existing /ws)    │
                    messages DB
```

All communication is centralized through the NanoFleet API. The UI never talks directly to a container.

---

## 3. Message Flow

### 3.1 User → Agent
1. UI sends `POST /api/agents/:id/messages` with `{ content: "..." }` (REST, authenticated with JWT).
2. API saves the message to DB (`role: "user"`).
3. API looks up the agent's live WebSocket connection in `agentConnections` and forwards `{ type: "message", content: "...", sessionKey: "nanofleet:{agentId}" }`.
4. The nanobot container's NanoFleet channel receives the message and pushes it into nanobot's `MessageBus.inbound`.
5. nanobot processes the message (LLM call, tool use, etc.).

### 3.2 Agent → User
1. nanobot pushes the response to `MessageBus.outbound`.
2. The NanoFleet channel reads the response and sends `{ type: "response", content: "...", agentId: "..." }` back to the API via the internal WebSocket.
3. API saves the response to DB (`role: "agent"`).
4. API broadcasts `{ type: "chat_message", agentId: "...", role: "agent", content: "..." }` to all UI clients subscribed to that agent via the existing `/ws` endpoint.
5. UI receives the message and appends it to the chat view.

---

## 4. Session Management

Each conversation is keyed by `nanofleet:{agentId}`. This maps to a nanobot session stored in `~/.nanofleet/instances/{agentId}/sessions/nanofleet:{agentId}.jsonl`. This means:
* Conversation history persists across container restarts.
* Each agent has exactly one conversation session with the NanoFleet UI.

---

## 5. Database Schema (`messages` table)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (UUID) | Primary key |
| `agentId` | TEXT | Foreign key → `agents.id` |
| `role` | TEXT | `"user"` or `"agent"` |
| `content` | TEXT | Message content |
| `createdAt` | INTEGER | Unix timestamp |

---

## 6. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents/:id/messages` | Fetch conversation history |
| `POST` | `/api/agents/:id/messages` | Send a message to the agent |
| `GET` (WS) | `/internal/ws` | Internal endpoint for agent containers |

---

## 7. WebSocket Message Types

### `/ws` (UI clients):
```json
{ "type": "chat_message", "agentId": "...", "role": "agent", "content": "..." }
```

### Internal `/internal/ws` (agent containers):
```json
// API → Agent
{ "type": "message", "content": "Hello", "sessionKey": "nanofleet:abc123" }

// Agent → API
{ "type": "response", "content": "Hello! How can I help?", "agentId": "abc123" }

// Agent → API (typing indicator)
{ "type": "thinking", "agentId": "abc123" }
```

---

## 8. `packages/docker/` — NanoFleet Channel

The custom channel lives in `packages/docker/` and is injected into the nanobot image at build time. It is **not a fork of nanobot** — it uses nanobot's public channel interface.

```
packages/docker/
├── Dockerfile              # Copies channel + entrypoint, installs websockets lib
├── nanofleet_channel.py    # Python channel: WS client connecting to NANO_API_URL
└── entrypoint.sh           # Patches nanobot channels dir, then runs nanobot gateway
```

---

## 9. Multi-Agent Chat (nanofleet-chat plugin)

Multi-agent group channels, agent-to-agent messaging, and the Chat sidebar view are provided by the **nanofleet-chat plugin** — a separate Docker container installed independently.

Key features:
- Group channels with multiple agents and humans
- Agent → Agent messaging via `send_message_to_channel` / `send_message_to_agent` MCP tools
- Dashboard UI served from the plugin's own frontend (iframe proxy)
- `@mention` routing: in a multi-agent channel, the human must `@mention` an agent to address it; agent-to-agent messages only trigger a reply when the target is explicitly `@mentioned` (prevents infinite loops)

See the full documentation in the [nanofleet-chat repository](https://github.com/NanoFleet/nanofleet-chat).
