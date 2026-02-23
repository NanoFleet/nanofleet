# 06 - UI & Design System Guidelines

## 1. Visual Identity: "Technical Minimalism"
NanoFleet steps away from the generic "Dark Mode AI" cliché. Instead, it adopts a **Technical Minimalist** aesthetic. The interface feels like a modern, high-end engineer's drafting table: flat, clean, highly readable, and structured, relying on refined typography and subtle dividing lines.

## 2. Global Layout: The Sidebar Paradigm
To maximize vertical space and provide a professional SaaS experience, the application uses a **Persistent Left Sidebar** layout.

* **The Sidebar (Left):** 
  * Background: A subtle off-white (`#F4F4F0` or `bg-neutral-100`).
  * Active State: The currently selected menu item gets a soft gray background with bolder, black text.
  * Status Indicators: Uses small colored dots (e.g., Green for connected/running, Orange for connecting/paused) next to system statuses and active agents.
* **The Workspace (Right):**
  * Features a very subtle **graph-paper grid pattern** in the background to reinforce the "Blueprint" feel.

## 3. Color Palette
The interface relies on extreme, crisp contrast between the background and text, using soft pastel colors for statuses to maintain a calm, technical vibe.

* **Background (Paper/Ivory):** `#F9F9F6` or `bg-neutral-50`. Reduces eye strain while keeping the interface bright.
* **Text & Borders (Ink Black):** `#111111`. Used for all primary text, icons, and sharp 1px dividing lines.
* **Primary Actions (Solid Black):** Buttons like "Deploy New Agent" are solid black (`bg-black text-white`) to heavily anchor the design.
* **Status Colors (Pastels):** 
  * *Success/Running:* A soft Mint/Pastel Green background with darker green text.
  * *Warning/Connecting:* A soft Amber/Orange.
  * *Disabled/Paused:* A soft Gray.

## 4. Typography
Typography drives the entire design. It must be geometric and perfectly legible.

* **UI Labels & Headings:** `Inter`, `Geist`, or `SF Pro`. Clean, neutral, and professional.
* **Terminal Logs & Configuration:** `JetBrains Mono` or `Geist Mono`. Smaller text size (e.g., `text-xs` or `12px`), slightly grayed out (`text-neutral-600`), essential for the Agent's live standard output.

## 5. Core UI Components

### 5.1 Cards (The Agents)
* **Borders:** Crisp 1px solid neutral borders (`border-neutral-200` or `border-neutral-300`).
* **Radius:** Very slight rounding (`rounded-md` or `6px`), keeping it sharp but friendly.
* **Padding:** Generous internal padding (e.g., `p-6`) to let the content breathe.

### 5.2 The Terminal / Log Snippet
Inside the Agent Cards, the live feed is visually separated to represent the "Container's brain":
* **Background:** A very subtle light gray (`bg-neutral-100`).
* **Border:** A fine **dashed border** (`border-dashed border-neutral-300`).
* **Content:** Monospace typography, acting as a real-time window into the Docker container's `stdout`.

### 5.3 Buttons
* **Primary:** Solid black (`bg-neutral-900 text-white`). Flat, no heavy shadows. Hover effect is a slight opacity change.
* **Secondary/Ghost:** Transparent background, text color shifting on hover.

## 6. Core Screens (Views to Implement)

### View 1: The Fleet Dashboard (Home)
* **Layout:** A clean grid of active "Agent Cards" over the graph-paper background.
* **Content:** Each card shows the Agent's name, a pastel pill badge for status (Running/Paused), session token cost, and the dashed Monospace log snippet.
* **Action:** A prominent "Deploy New Agent" solid black button at the top right of the workspace.

### View 2: The Agent Workspace (Detail View)
* **Left Panel:** The SDUI Plugin view (Kanban, Calendar, or File Explorer for `/shared_workspace`).
* **Right Panel:** The communication hub, featuring a chat input and a streaming Terminal/Live Feed block showing the agent's background actions.

### View 3: The Configuration Editor
* **Layout:** A clean, distraction-free text editor reminiscent of Notion.
* **Content:** For live-editing `SOUL.md` and `TOOLS.md` using Markdown syntax highlighting.

### View 4: The Forge (Marketplace)
* **Layout:** A catalog grid listing downloadable Agent Packs.
* **Content:** Features the Pack's title, author, and the **"GDPval Verified"** badge.
