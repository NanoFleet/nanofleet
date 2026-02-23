# 02 - API & Authentication Architecture

## 1. Security Philosophy
Because NanoFleet orchestrates AI agents capable of Remote Code Execution (RCE) and autonomous web navigation, **security is the absolute priority**. If a malicious actor gains access to the Dashboard, they gain access to the host machine. 
Therefore, NanoFleet enforces **Mandatory Two-Factor Authentication (2FA/TOTP)** for all human users by default, and uses strictly scoped internal tokens for Agent-to-API communication.

## 2. First-Boot Setup (The Bootstrap Phase)

When the NanoFleet backend (Hono server) starts, it checks the database for an existing `Admin` user. If none exists, it enters the **Bootstrap Mode**:

1. **Password & Secret Generation:** The server generates a strong, random temporary password and a unique TOTP (Time-Based One-Time Password) secret using a library like `otplib`.
2. **Terminal Output:** The server prints a setup block directly in the terminal (stdout), including a **QR Code** (using a terminal QR code generator).
3. **User Action:** The user MUST scan this QR Code with an authenticator app (e.g., Google Authenticator, Authy, Apple Passwords).
4. **Initial Login:** The user logs into the Web Dashboard using the temporary password and their first 6-digit TOTP code. The credentials are saved directly to the database and persist across server restarts.

## 3. Client Authentication (Web & Mobile Apps)

Human interaction with the API relies on a dual-token JWT (JSON Web Token) architecture.

### 3.1 The Login Flow
* **Endpoint:** `POST /api/auth/login`
* **Payload:** `{ password: "user_password", totp: "123456" }`
* **Validation:** The server hashes the password (e.g., using Bun's native password hashing or `bcrypt`/`argon2`) and verifies the TOTP code.

### 3.2 JWT Issuance
Upon success, the API issues two tokens:
1. **Access Token:** 
   * Short-lived (e.g., 15 minutes).
   * Used to authorize requests (`Authorization: Bearer <token>`).
   * Contains the user ID and role (`admin`).
2. **Refresh Token:**
   * Long-lived (e.g., 7 days).
   * Used solely to request a new Access Token when the old one expires.
   * **Storage:** 
     * *Web:* Stored in a secure, `HttpOnly`, `SameSite=Strict` cookie to prevent XSS attacks.
     * *Mobile:* Stored in the device's native `SecureStorage` (via Expo SecureStore).

## 4. Agent Authentication (Internal Network)

AI Agents (Nanobots) running in Docker containers cannot scan QR codes or solve 2FA prompts. They require a seamless but highly secure authentication mechanism to talk to the Dashboard API.

### 4.1 Internal Token Injection
1. When the user clicks "Deploy Agent", the Orchestrator (Backend) creates a new record in the Database for this specific agent.
2. It generates a cryptographic, ultra-long string: `NANO_INTERNAL_TOKEN`.
3. When the Docker daemon spins up the Agent's container, the Orchestrator injects this token as an Environment Variable (`process.env.DASHBOARD_API_TOKEN`).

### 4.2 Agent-to-API Communication
* The Agent lives on a private Docker network (`nanofleet-net`) and communicates with the API via an internal host URL (e.g., `http://api:3000`).
* Every REST, WebSocket, or MCP request made by the Agent includes the `Authorization: Bearer <NANO_INTERNAL_TOKEN>` header.
* The API validates this token. If an agent goes rogue or its container is compromised, the admin can revoke the token instantly from the Dashboard, cutting off the agent's access to the API.

## 5. Emergency Recovery (CLI)

Since NanoFleet is a self-hosted tool, losing the 2FA device (e.g., losing a smartphone) would permanently lock the user out of their own dashboard.

To prevent this, NanoFleet includes an emergency recovery script that can ONLY be executed by someone with physical or SSH access to the host machine.

**Usage:**
```bash
bun apps/api/scripts/reset-2fa.ts [path/to/nanofleet.db]
```

The DB path defaults to `apps/api/nanofleet.db` if not provided.

**Action:** The script connects directly to the SQLite database, wipes the admin's TOTP secret, and exits. On next server restart, the backend enters Bootstrap Mode and prints a new QR code in the terminal to re-enroll 2FA.
