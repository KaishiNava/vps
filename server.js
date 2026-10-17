import express from "express";
import next from "next";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import pty from "node-pty";
import { WebSocketServer } from "ws";
import cookie from "cookie";
import config from "./config.js";

const dev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev, hostname: config.server.host, port: config.server.port });
const handle = nextApp.getRequestHandler();
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

const COOKIE_NAME = "franx_session";
const sessions = new Map();
const terminals = new Map();
const auditLog = [];
const startedAt = Date.now();
const workspace = path.resolve(config.terminal.workspace);
fs.mkdirSync(workspace, { recursive: true });

if (!config.auth.password || !config.auth.sessionSecret || config.auth.sessionSecret.length < 32) {
  console.warn("[FRANX HOST] Configure ADMIN_PASSWORD and SESSION_SECRET (32+ chars) in Railway Variables.");
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function tokenFromReq(req) {
  const parsed = cookie.parse(req.headers.cookie || "");
  return parsed[COOKIE_NAME] || "";
}
function sessionForToken(token) {
  if (!token || !config.auth.sessionSecret) return null;
  const record = sessions.get(token);
  if (!record || record.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return record;
}
function isAuthed(req) {
  return Boolean(sessionForToken(tokenFromReq(req)));
}
function requireAuth(req, res, nextFn) {
  if (!isAuthed(req)) return res.status(401).json({ error: "Authentication required" });
  nextFn();
}
function audit(action, detail = "") {
  auditLog.unshift({ time: new Date().toISOString(), action, detail: String(detail).slice(0, 160) });
  if (auditLog.length > 100) auditLog.length = 100;
}
function safeProjectPath(relative = ".") {
  if (typeof relative !== "string" || relative.includes("\0")) throw new Error("Invalid path");
  const resolved = path.resolve(workspace, relative);
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) throw new Error("Path outside workspace");
  return resolved;
}
function relativeToWorkspace(absolute) {
  return path.relative(workspace, absolute).split(path.sep).join("/") || ".";
}

app.get("/api/health", (_req, res) => res.json({ ok: true, host: config.brand.name }));
app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  if (!config.auth.password || !config.auth.sessionSecret || config.auth.sessionSecret.length < 32) {
    return res.status(503).json({ error: "Admin auth is not configured. Set ADMIN_PASSWORD and SESSION_SECRET in Railway Variables." });
  }
  if (!safeEqual(username, config.auth.username) || !safeEqual(password, config.auth.password)) {
    audit("login_failed", username);
    return res.status(401).json({ error: "Username or password is incorrect." });
  }
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { username, createdAt: Date.now(), expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
  res.setHeader("Set-Cookie", cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/", maxAge: 12 * 60 * 60
  }));
  audit("login", username);
  res.json({ ok: true, username });
});
app.post("/api/auth/logout", requireAuth, (req, res) => {
  const token = tokenFromReq(req);
  sessions.delete(token);
  const wsToken = token;
  for (const [id, term] of terminals) {
    if (term.token === wsToken) {
      try { term.proc.kill(); } catch {}
      terminals.delete(id);
    }
  }
  res.setHeader("Set-Cookie", cookie.serialize(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 }));
  audit("logout");
  res.json({ ok: true });
});
app.get("/api/auth/me", requireAuth, (req, res) => {
  const session = sessionForToken(tokenFromReq(req));
  res.json({ ok: true, username: session.username, host: config.brand.name });
});
app.get("/api/system", requireAuth, (_req, res) => {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const load = os.loadavg();
  const uptime = Math.floor((Date.now() - startedAt) / 1000);
  const cpuCount = os.cpus().length || 1;
  const cpu = Math.min(100, Math.round((load[0] / cpuCount) * 100));
  let disk = { available: false };
  try {
    const stats = fs.statfsSync(workspace);
    disk = { available: true, total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
  } catch {}
  res.json({
    host: config.brand.name, owner: config.brand.owner, platform: "Railway container",
    os: `${os.type()} ${os.release()}`, arch: os.arch(), node: process.version,
    uptime, memory: { total: memTotal, free: memFree, used: memTotal - memFree, percent: Math.round(((memTotal - memFree) / memTotal) * 100) },
    cpu: { cores: cpuCount, load1: Number(load[0].toFixed(2)), estimatedPercent: cpu },
    disk, workspace: config.terminal.workspace, processUptime: Math.floor(process.uptime())
  });
});
app.get("/api/files", requireAuth, (req, res) => {
  try {
    const dir = safeProjectPath(String(req.query.path || "."));
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return res.status(400).json({ error: "Path is not a directory" });
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map(ent => {
      const full = path.join(dir, ent.name);
      let size = 0, modified = null;
      try { const s = fs.statSync(full); size = s.size; modified = s.mtime.toISOString(); } catch {}
      return { name: ent.name, type: ent.isDirectory() ? "directory" : "file", size, modified };
    }).sort((a,b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
    res.json({ path: relativeToWorkspace(dir), entries });
  } catch (e) { res.status(400).json({ error: e.message || "Unable to read directory" }); }
});
app.get("/api/files/read", requireAuth, (req, res) => {
  try {
    const file = safeProjectPath(String(req.query.path || ""));
    if (!fs.statSync(file).isFile()) return res.status(400).json({ error: "Not a file" });
    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) return res.status(413).json({ error: "File is larger than 1 MB. Use the terminal for large files." });
    res.json({ path: relativeToWorkspace(file), content: fs.readFileSync(file, "utf8") });
  } catch (e) { res.status(400).json({ error: e.message || "Unable to read file" }); }
});
app.post("/api/files/write", requireAuth, (req, res) => {
  try {
    const relative = String(req.body?.path || "");
    const content = req.body?.content;
    if (typeof content !== "string") return res.status(400).json({ error: "Content must be text" });
    if (Buffer.byteLength(content) > 1024 * 1024) return res.status(413).json({ error: "File content exceeds 1 MB" });
    const file = safeProjectPath(relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { encoding: "utf8", mode: 0o600 });
    audit("file_write", relative);
    res.json({ ok: true, path: relativeToWorkspace(file) });
  } catch (e) { res.status(400).json({ error: e.message || "Unable to write file" }); }
});
app.post("/api/files/mkdir", requireAuth, (req, res) => {
  try {
    const dir = safeProjectPath(String(req.body?.path || ""));
    fs.mkdirSync(dir, { recursive: false });
    audit("mkdir", req.body.path);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message || "Unable to create directory" }); }
});
app.delete("/api/files", requireAuth, (req, res) => {
  try {
    const target = safeProjectPath(String(req.query.path || ""));
    if (target === workspace) return res.status(400).json({ error: "Cannot delete workspace root" });
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) return res.status(400).json({ error: "Symbolic links cannot be deleted here" });
    fs.rmSync(target, { recursive: true, force: false });
    audit("file_delete", req.query.path);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message || "Unable to delete path" }); }
});
app.get("/api/activity", requireAuth, (_req, res) => res.json({ entries: auditLog }));

await nextApp.prepare();
app.use((req, res) => handle(req, res));
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 16 });
server.on("upgrade", (req, socket, head) => {
  if (req.url?.split("?")[0] !== "/ws/terminal") {
    // Allow Next.js HMR upgrades only in development.
    if (dev) return nextApp.getUpgradeHandler()(req, socket, head);
    socket.destroy(); return;
  }
  const token = cookie.parse(req.headers.cookie || "")[COOKIE_NAME] || "";
  if (!sessionForToken(token)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req, token));
});
wss.on("connection", (ws, _req, token) => {
  const id = crypto.randomUUID();
  let proc;
  try {
    proc = pty.spawn(config.terminal.shell, ["--login"], {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd: workspace,
      env: { ...process.env, TERM: "xterm-256color", HOME: workspace, PS1: "\\[\\e[1;32m\\]root@franx-host\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]# " }
    });
  } catch {
    ws.send(JSON.stringify({ type: "error", data: "Could not start shell. Check SHELL_PATH and container image." }));
    ws.close();
    return;
  }
  terminals.set(id, { proc, token });
  audit("terminal_open");
  proc.onData(data => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "output", data })); });
  proc.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "exit", code: exitCode }));
    terminals.delete(id);
    try { ws.close(); } catch {}
  });
  ws.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && typeof msg.data === "string" && msg.data.length < 8192) proc.write(msg.data);
      else if (msg.type === "resize") {
        const cols = Math.max(20, Math.min(240, Number(msg.cols) || 100));
        const rows = Math.max(5, Math.min(100, Number(msg.rows) || 28));
        proc.resize(cols, rows);
      }
    } catch {}
  });
  ws.on("close", () => {
    // Do not kill the shell on a transient browser disconnect; clean it up after 10 minutes.
    const timer = setTimeout(() => {
      const term = terminals.get(id);
      if (term) { try { term.proc.kill(); } catch {} terminals.delete(id); }
    }, 10 * 60 * 1000);
    timer.unref();
  });
});
server.listen(config.server.port, config.server.host, () => {
  console.log(`[FRANX HOST] Listening on ${config.server.host}:${config.server.port}`);
  console.log(`[FRANX HOST] Workspace: ${workspace}`);
});
