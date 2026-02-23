# 04 - MCP & Plugin Architecture

## 1. The Extensibility Challenge
Traditional AI agents rely on hardcoded Python/TypeScript tools injected directly into their execution environment. This approach is not scalable, poses severe security risks (executing third-party code in the host), and makes it impossible to dynamically update the UI across both Web and Mobile platforms simultaneously.

NanoFleet solves this by leveraging the **Model Context Protocol (MCP)** and **Docker Isolation**. In NanoFleet, a Plugin is NOT a script injected into the backend; it is an independent Docker container exposing an MCP Server.

## 2. The Plugin Architecture (Containers as Plugins)

When a user installs a Plugin (e.g., "Google Calendar Integration" or "Jira Sync"):
1. The orchestrator downloads the Plugin's Docker image or builds it from a Git repository.
2. It spins up the Plugin in a sandboxed Docker container attached to the `nanofleet-net` internal network.
3. The central Hono API acts as the **MCP Router / Gateway**. It connects to the Plugin's MCP Server and asks for its capabilities (available Tools, Resources, and UI components).
4. The API registers these capabilities in its global routing table.

**Security Benefit:** If a malicious or buggy Plugin crashes or attempts to steal data, it is trapped inside its container. It can only communicate with the outside world through the strict, heavily monitored MCP channels managed by the central API.

## 3. How Agents Use Plugins (The Tooling Flow)

Agents (Nanobots) never talk to Plugins directly. All communication goes through the central Hono API.

1. **Discovery:** When an Agent boots, the API injects the list of all available MCP tools into the Agent's context (e.g., `create_calendar_event`).
2. **Action:** The Agent decides to schedule a meeting. It sends an MCP JSON-RPC request to the API: 
   `{ "method": "tools/call", "params": { "name": "create_calendar_event", "arguments": {...} } }`
3. **Routing:** The API verifies the Agent's permissions (`NANO_INTERNAL_TOKEN`), finds which Plugin owns `create_calendar_event`, and forwards the request to the correct Plugin container.
4. **Execution & Response:** The Plugin executes the logic (e.g., calling the Google API) and returns the result to the API, which forwards it back to the Agent.

## 4. Server-Driven UI (SDUI) & Multi-Platform Rendering

Plugins often need to display information to the human user (e.g., showing the actual Calendar grid on the Dashboard). Since NanoFleet has a React Web App and a React Native Mobile App, Plugins cannot inject raw HTML/DOM elements or React components.

Instead, NanoFleet uses **Server-Driven UI (SDUI)** via MCP.

### 4.1 The SDUI Payload
When the user navigates to a Plugin's view on the Dashboard, the Frontend requests the UI from the API. The API asks the Plugin via MCP, and the Plugin returns a standardized JSON structure:
```json
{
  "type": "View",
  "children": },
      "actions": { "onClick": "open_event_modal" }
    }
  ]
}
```

### 4.2 Frontend Interpretation
* The **Web App (React)** reads `"type": "CalendarGrid"` and renders its pre-built `<CalendarGrid />` DOM component.
* The **Mobile App (React Native)** reads the exact same JSON and renders its native `<NativeCalendarGrid />` view.
* This guarantees a 100% native, fluid experience on both platforms from a single Plugin codebase.

## 5. Internationalization (i18n) in Plugins

Because NanoFleet is designed for a global audience, Plugins must respect the user's language preferences.

1. **Context Injection:** When the Frontend requests an SDUI payload from the API, it includes the user's current locale (e.g., `fr-FR` or `ja-JP`).
2. **MCP Forwarding:** The API forwards this locale to the Plugin container in the MCP request context.
3. **Plugin Responsibility:** The Plugin reads the locale and translates its SDUI JSON response accordingly (e.g., returning `"title": "Calendrier"` instead of `"Calendar"`). 
4. **Fallback:** If the Plugin does not support the requested language, it MUST fallback to English to prevent UI breakage.
