# 02 - API & Authentication Architecture

## 1. Security Philosophy
Because NanoFleet orchestrates AI agents capable of Remote Code Execution (RCE) and autonomous web navigation, **security is the absolute priority**. If a malicious actor gains access to the Dashboard, they gain access to the host machine.
Therefore, NanoFleet enforces **Mandatory Two-Factor Authentication (2FA/TOTP)** for all human users by default, and uses strictly scoped internal tokens for Agent/Plugin-to-API communication.

## 2. First-Boot Setup (The Bootstrap Phase)

When the NanoFleet backend (Hono server) starts, it checks the database for an existing `Admin` user. If none exists, it enters the **Bootstrap Mode**:

1. **Password & Secret Generation:** The server generates a strong, random temporary password and a unique TOTP (Time-Based One-Time Password) secret using a library like `otplib`.
2. **Terminal Output:** The server prints a setup block directly in the terminal (stdout), including a **QR Code** (using a terminal QR code generator).
3. **User Action:** The user MUST scan this QR Code with an authenticator app (e.g., Google Authenticator, Authy, Apple Passwords).
4. **Initial Login:** The user logs into the Web Dashboard using the temporary password and their first 6-digit TOTP code. The credentials are saved directly to the database and persist across server restarts.

## 3. Client Authentication (Web App)

Human interaction with the API relies on a dual-token JWT (JSON Web Token) architecture.

### 3.1 The Login Flow
* **Endpoint:** `POST /api/auth/login`
* **Payload:** `{ password: "user_password", totp: "123456" }`
* **Validation:** The server hashes the password (using Bun's native password hashing) and verifies the TOTP code.

### 3.2 JWT Issuance
Upon success, the API issues two tokens:
1. **Access Token:**
   * Short-lived (e.g., 15 minutes).
   * Used to authorize requests (`Authorization: Bearer <token>`).
   * Contains the user ID and role (`admin`).
2. **Refresh Token:**
   * Long-lived (e.g., 7 days).
   * Used solely to request a new Access Token when the old one expires.
   * **Storage:** Stored in a secure, `HttpOnly`, `SameSite=Strict` cookie to prevent XSS attacks.

## 4. Internal Token Authentication (Agents & Plugins)

AI Agents and Plugins running in Docker containers use a token-based mechanism to communicate with the API.

### 4.1 Token Generation & Injection
1. When the user deploys an Agent, the API generates a cryptographic `token` (UUID) and stores it in the `agents` table.
2. When a Plugin is installed, the API generates a `token` and stores it in the `plugins` table.
3. The token is **not** injected into agent containers as an env var — agents identify themselves via the `NANO_INTERNAL_TOKEN` (injected for plugin containers as `NANO_INTERNAL_TOKEN`).

### 4.2 Internal Routes
The API exposes `/internal/*` routes authenticated by internal token. Both agent tokens and plugin tokens are accepted. The token is looked up first in `agents`, then in `plugins`:

```
GET  /internal/agents              — list all agents (used by plugins)
POST /internal/agents/:id/messages — send a message to an agent container
```

### 4.3 Revoking Access
If an agent or plugin is compromised, the admin can delete it from the Dashboard, which stops and removes its container and deletes its token from the database.

## 5. Emergency Recovery (CLI)

Since NanoFleet is a self-hosted tool, losing the 2FA device would permanently lock the user out of their own dashboard.

To prevent this, NanoFleet includes an emergency recovery script that can ONLY be executed by someone with physical or SSH access to the host machine.

**Usage:**
```bash
bun apps/api/scripts/reset-2fa.ts [path/to/nanofleet.db]
```

The DB path defaults to `apps/api/nanofleet.db` if not provided.

**Action:** The script connects directly to the SQLite database, wipes the admin's TOTP secret, and exits. On next server restart, the backend enters Bootstrap Mode and prints a new QR code in the terminal to re-enroll 2FA.
