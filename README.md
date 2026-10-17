# FRANX HOST

Franx Host is a Next.js + Node.js Railway dashboard with an authenticated browser terminal, workspace file manager, system metrics, and activity log.

## Important deployment notes

This app exposes a real interactive shell inside its own Railway container. Only deploy it to an account and environment you control. The shell can execute commands as the container's actual OS user; the `root@franx-host` prompt is cosmetic and does not grant root privileges.

### 1. Create a repository and deploy with Dockerfile

Push this folder to a private GitHub repository. Create a Railway service from that repository. Railway should detect the `Dockerfile`.

### 2. Set Railway Variables

Set these variables in the Railway service settings:

- `ADMIN_USERNAME` — recommended `kyZX`
- `ADMIN_PASSWORD` — a strong, unique password
- `SESSION_SECRET` — at least 32 random characters
- `WORKSPACE_DIR` — `/data/projects` (recommended)
- `SHELL_PATH` — `/bin/bash`
- `NODE_ENV` — `production`

Do not put production secrets in `config.js`, source control, screenshots, or chat messages. There is no default admin password; login fails closed until `ADMIN_PASSWORD` and `SESSION_SECRET` are configured.

### 3. Attach a Railway Volume

Attach a Railway Volume and mount it at `/data`. This makes `/data/projects` persistent across container redeployments/restarts. Without a mounted Volume, data written to the container filesystem may be lost.

### 4. Networking

Expose the service's HTTP port through Railway. The app uses `process.env.PORT` and listens on `0.0.0.0`.

### 5. Shell behavior

The browser terminal uses `node-pty` and WebSocket. Nano key combinations work in the terminal. Use Ctrl+O, Enter, Ctrl+X to save and exit. The container includes Bash, Nano, Node.js, Python 3, and common utilities.

### 6. API processes

The API Manager is guidance/inspection, not a general process supervisor. Starting a server with `node index.js` in an interactive terminal ties it to that shell session. It may stop if the process exits, the shell is closed, or the container restarts. A single Railway service has one public HTTP routing configuration; extra ports do not automatically receive public domains. For reliable long-running public APIs, use separate Railway services or add a carefully designed reverse proxy and process supervisor.

### Security limitations and recommendations

- The terminal is a powerful admin feature. Use a strong password and keep the panel private.
- The terminal process runs with the container's actual OS permissions; prompt text does not change those permissions.
- Keep the service updated and review access logs.
- Use Railway Variables for secrets.
- The file manager is limited to the configured workspace and is not intended as a complete replacement for OS-level file operations.
- This project is a starter implementation, not a hardened multi-tenant hosting platform. Do not offer it to untrusted users without additional isolation, rate limits, CSRF review, process quotas, and security testing.

## Local development

Requires Node.js 20+ and a POSIX environment with Bash and build tools for `node-pty`.

```bash
npm install
ADMIN_USERNAME=kyZX ADMIN_PASSWORD='use-a-strong-local-password' SESSION_SECRET='replace-with-32-or-more-random-characters' npm run dev
```

Open http://localhost:3000.
