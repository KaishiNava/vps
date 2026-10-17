"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const fmtBytes = n => {
  if (!Number.isFinite(n)) return "—";
  const units = ["B","KB","MB","GB","TB"]; let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
};
const fmtUptime = s => {
  s = Math.max(0, Number(s) || 0);
  const d = Math.floor(s/86400), h = Math.floor(s%86400/3600), m = Math.floor(s%3600/60), sec = Math.floor(s%60);
  return `${d ? d+"d " : ""}${h}h ${m}m ${sec}s`;
};
const human = x => String(x || "").replaceAll("\\","/");

export default function HostApp() {
  const [logged, setLogged] = useState(false);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState("Dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [username, setUsername] = useState("kyZX");
  const [system, setSystem] = useState(null);
  const [loginName, setLoginName] = useState("kyZX");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [termConnected, setTermConnected] = useState(false);
  const [filesPath, setFilesPath] = useState(".");
  const [entries, setEntries] = useState([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [editorContent, setEditorContent] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileMessage, setFileMessage] = useState("");
  const [activities, setActivities] = useState([]);
  const terminalEl = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const termInitRef = useRef(false);

  const request = useCallback(async (url, options = {}) => {
    const res = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { setLogged(false); throw new Error("Session expired. Please sign in again."); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, []);

  const refreshSystem = useCallback(async () => {
    try { setSystem(await request("/api/system")); } catch {}
  }, [request]);

  const loadFiles = useCallback(async (p = ".") => {
    try {
      const data = await request(`/api/files?path=${encodeURIComponent(p)}`);
      setFilesPath(data.path); setEntries(data.entries); setFileMessage("");
    } catch (e) { setFileMessage(e.message); }
  }, [request]);

  const loadActivity = useCallback(async () => {
    try { const d = await request("/api/activity"); setActivities(d.entries || []); } catch {}
  }, [request]);

  useEffect(() => {
    request("/api/auth/me").then(d => { setLogged(true); setUsername(d.username); }).catch(() => {}).finally(() => setChecking(false));
  }, [request]);
  useEffect(() => {
    if (!logged) return;
    refreshSystem(); loadActivity();
    const timer = setInterval(() => { refreshSystem(); if (page === "Activity") loadActivity(); }, 5000);
    return () => clearInterval(timer);
  }, [logged, page, refreshSystem, loadActivity]);
  useEffect(() => {
    if (logged && page === "Files") loadFiles(filesPath);
  }, [logged, page, loadFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async e => {
    e.preventDefault(); setLoading(true); setLoginError("");
    try {
      const data = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: loginName, password }) });
      setLogged(true); setUsername(data.username); setPassword("");
    } catch (e) { setLoginError(e.message); }
    finally { setLoading(false); }
  };
  const logout = async () => {
    try { await request("/api/auth/logout", { method: "POST" }); } catch {}
    disconnectTerminal(); setLogged(false); setPage("Dashboard");
  };

  const disconnectTerminal = () => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null; setTermConnected(false);
    if (terminalRef.current) { terminalRef.current.dispose(); terminalRef.current = null; }
    fitRef.current = null; termInitRef.current = false;
  };
  const connectTerminal = useCallback(() => {
    if (!terminalEl.current || termInitRef.current) return;
    termInitRef.current = true;
    const term = new XTerm({
      cursorBlink: true, convertEol: true, fontFamily: '"DM Mono", monospace', fontSize: 12,
      theme: { background: "#06090d", foreground: "#dce8e0", cursor: "#62f6a6", green: "#62f6a6", selectionBackground: "#254333" },
      scrollback: 5000
    });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(terminalEl.current);
    terminalRef.current = term; fitRef.current = fit;
    setTimeout(() => { try { fit.fit(); } catch {} }, 80);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal`);
    wsRef.current = ws;
    ws.onopen = () => {
      setTermConnected(true);
      try { fit.fit(); ws.send(JSON.stringify({type:"resize", cols:term.cols, rows:term.rows})); } catch {}
      term.focus();
    };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "output") term.write(msg.data);
        if (msg.type === "error") term.writeln(`\r\n\x1b[31m${msg.data}\x1b[0m`);
        if (msg.type === "exit") { setTermConnected(false); term.writeln("\r\n\x1b[33m[Shell exited]\x1b[0m"); }
      } catch {}
    };
    ws.onerror = () => term.writeln("\r\n\x1b[31m[WebSocket error. Check deployment logs and shell setup.]\x1b[0m");
    ws.onclose = () => setTermConnected(false);
    term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:"input", data})); });
    term.onResize(({cols, rows}) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:"resize", cols, rows})); });
    const resize = () => { try { fit.fit(); } catch {} };
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); };
  }, []);
  useEffect(() => {
    if (logged && page === "Terminal") {
      const cleanup = connectTerminal();
      return () => { if (typeof cleanup === "function") cleanup(); };
    }
    if (page !== "Terminal") disconnectTerminal();
  }, [logged, page, connectTerminal]);

  const openFile = async p => {
    try {
      const d = await request(`/api/files/read?path=${encodeURIComponent(p)}`);
      setSelectedFile(d.path); setEditorContent(d.content); setFileMessage("");
    } catch (e) { setFileMessage(e.message); }
  };
  const saveFile = async () => {
    if (!selectedFile) return;
    setFileBusy(true);
    try { await request("/api/files/write", {method:"POST", body:JSON.stringify({path:selectedFile, content:editorContent})}); setFileMessage("File saved."); await loadFiles(filesPath); }
    catch(e) { setFileMessage(e.message); } finally { setFileBusy(false); }
  };
  const createFile = async () => {
    const name = window.prompt("New file name (relative to current folder):");
    if (!name) return;
    const p = `${filesPath === "." ? "" : filesPath + "/"}${name}`;
    try { await request("/api/files/write", {method:"POST", body:JSON.stringify({path:p,content:""})}); setFileMessage("File created."); await loadFiles(filesPath); await openFile(p); }
    catch(e) { setFileMessage(e.message); }
  };
  const createFolder = async () => {
    const name = window.prompt("New folder name:");
    if (!name) return;
    const p = `${filesPath === "." ? "" : filesPath + "/"}${name}`;
    try { await request("/api/files/mkdir", {method:"POST", body:JSON.stringify({path:p})}); setFileMessage("Folder created."); await loadFiles(filesPath); }
    catch(e) { setFileMessage(e.message); }
  };
  const deletePath = async entry => {
    if (!window.confirm(`Delete ${entry.name}? This cannot be undone.`)) return;
    const p = `${filesPath === "." ? "" : filesPath + "/"}${entry.name}`;
    try { await request(`/api/files?path=${encodeURIComponent(p)}`, {method:"DELETE"}); if (selectedFile === p) {setSelectedFile("");setEditorContent("");} setFileMessage("Deleted."); await loadFiles(filesPath); }
    catch(e) { setFileMessage(e.message); }
  };
  const navItems = [
    ["Dashboard","▦"],["Terminal","⌘"],["Files","▤"],["API Manager","↗"],["Activity","≋"],["Settings","⚙"]
  ];
  const navigate = p => { setPage(p); setMobileOpen(false); };

  if (checking) return <div className="login-wrap"><div className="tiny">Initializing FRANX HOST…</div></div>;
  if (!logged) return <div className="login-wrap"><div className="login-card">
    <div className="brand" style={{padding:0}}><div className="brand-mark">F</div><div><div className="brand-title">FRANX HOST</div><div className="brand-sub">SERVER MANAGEMENT PANEL</div></div></div>
    <h1>Welcome back.</h1><p>Sign in to access your server workspace and terminal.</p>
    <form className="login-form" onSubmit={login}>
      <div><label className="label">ADMIN USERNAME</label><input className="field" value={loginName} onChange={e=>setLoginName(e.target.value)} autoComplete="username" required /></div>
      <div><label className="label">PASSWORD</label><input className="field" type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required /></div>
      {loginError && <div className="error">{loginError}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading ? "Signing in…" : "SIGN IN →"}</button>
    </form><div className="footer-note">Restricted administrator access · Franx Host</div>
  </div></div>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="brand"><div className="brand-mark">F</div><div><div className="brand-title">FRANX HOST</div><div className="brand-sub">SERVER MANAGEMENT</div></div></div>
      <div><div className="nav-label">WORKSPACE</div><div className="nav-list">{navItems.map(([name,icon])=><button key={name} className={`nav-item ${page===name?"active":""}`} onClick={()=>navigate(name)}><span className="nav-icon">{icon}</span>{name}{name==="Terminal"&&<span style={{marginLeft:"auto",fontSize:9,color:"var(--green)"}}>LIVE</span>}</button>)}</div></div>
      <div className="sidebar-bottom"><div className="host-mini"><div style={{fontSize:12,fontWeight:800,marginBottom:8}}> <span className="status-dot"/>Franx Host</div><div className="tiny">Railway container</div><div className="tiny mono" style={{marginTop:10}}>root@franx-host</div></div><button className="nav-item" style={{width:"100%",marginTop:10}} onClick={logout}><span className="nav-icon">↪</span>Sign out</button></div>
    </aside>
    {mobileOpen && <div onClick={()=>setMobileOpen(false)} style={{position:"fixed",inset:0,background:"#0008",zIndex:10}}/>}
    <main className="main">
      <header className="topbar">
        <div><button className="btn mobile-menu" onClick={()=>setMobileOpen(!mobileOpen)} style={{marginBottom:12}}>☰ Menu</button><div className="eyebrow">FRANX HOST / CONTROL PANEL</div><h1 className="page-title">{page}</h1></div>
        <div className="top-right"><div className="pill"><span className="status-dot"/>SYSTEM ONLINE</div><div className="avatar">{username.slice(0,2).toUpperCase()}</div></div>
      </header>

      {page==="Dashboard" && <Dashboard system={system} navigate={navigate} />}
      {page==="Terminal" && <section className="card terminal-card">
        <div className="terminal-top"><div className="traffic"><i/><i/><i/></div><div className="terminal-title">root@franx-host: ~ / bash</div><div className="terminal-state">{termConnected?"● CONNECTED":"○ DISCONNECTED"}</div></div>
        <div className="terminal-body"><div ref={terminalEl} style={{height:"100%",width:"100%"}} /></div>
        <div className="terminal-note">Interactive shell · Use <span className="mono">nano filename</span> to edit files. Shell permissions are limited to this container.</div>
      </section>}
      {page==="Files" && <section>
        <div className="notice">File Manager is limited to the configured workspace (<span className="mono">{system?.workspace || "/data/projects"}</span>). For terminal editing, Nano is available in the shell if installed.</div>
        <div className="card"><div className="card-head"><div><h2 className="section-title">Project files</h2><div className="section-sub mono">/{human(filesPath)}</div></div><div className="toolbar"><button className="btn" onClick={()=>loadFiles(filesPath)}>Refresh</button><button className="btn" onClick={createFolder}>+ Folder</button><button className="btn btn-primary" onClick={createFile}>+ File</button></div></div>
          {fileMessage && <p className="tiny" style={{marginTop:12}}>{fileMessage}</p>}
          <div className="file-list">
            {filesPath!=="." && <button className="file-row" onClick={()=>loadFiles(filesPath.includes("/")?filesPath.split("/").slice(0,-1).join("/")||".":" .".trim())}><span>↰</span><span className="file-name">..</span><span className="file-meta">Parent</span></button>}
            {entries.map(entry=><div key={entry.name} className="file-row"><span>{entry.type==="directory"?"📁":"▤"}</span><button className="file-name" style={{border:0,background:"none",color:"inherit",textAlign:"left"}} onClick={()=>entry.type==="directory"?loadFiles(`${filesPath==="."?"":filesPath+"/"}${entry.name}`):openFile(`${filesPath==="."?"":filesPath+"/"}${entry.name}`)}>{entry.name}</button><span className="file-meta">{entry.type==="directory"?"Folder":fmtBytes(entry.size)}</span><button className="btn btn-danger" onClick={()=>deletePath(entry)}>Delete</button></div>)}
            {!entries.length && <div className="empty">This folder is empty.</div>}
          </div>
        </div>
        <div className="card" style={{marginTop:16}}><div className="card-head"><div><h2 className="section-title">{selectedFile || "Editor"}</h2><div className="section-sub">Plain text editor · Max 1 MB per file</div></div><button className="btn btn-primary" disabled={!selectedFile||fileBusy} onClick={saveFile}>{fileBusy?"Saving…":"Save file"}</button></div><textarea className="editor" value={editorContent} onChange={e=>setEditorContent(e.target.value)} placeholder="Select a file from the list, or create a new file." spellCheck={false} style={{marginTop:14}} /></div>
      </section>}
      {page==="API Manager" && <ApiManager request={request} />}
      {page==="Activity" && <section className="card"><div className="card-head"><div><h2 className="section-title">Recent activity</h2><div className="section-sub">Recent events recorded by this panel process.</div></div><button className="btn" onClick={loadActivity}>Refresh</button></div><div style={{overflowX:"auto",marginTop:14}}><table className="table"><thead><tr><th>Time</th><th>Action</th><th>Detail</th></tr></thead><tbody>{activities.map((a,i)=><tr key={i}><td className="mono">{new Date(a.time).toLocaleString()}</td><td>{a.action}</td><td>{a.detail}</td></tr>)}</tbody></table>{!activities.length&&<div className="empty">No activity yet.</div>}</div></section>}
      {page==="Settings" && <section className="card"><h2 className="section-title">Panel settings</h2><div className="section-sub">Deployment configuration and runtime details.</div><div className="info-list">
        <InfoRow label="Panel name" value="Franx Host"/><InfoRow label="Owner label" value="kyZX"/><InfoRow label="Platform" value="Railway container"/><InfoRow label="Workspace" value={system?.workspace||"/data/projects"}/><InfoRow label="Runtime" value={system?.node||"Node.js"}/><InfoRow label="Architecture" value={system?.arch||"—"}/>
      </div><div className="notice" style={{marginTop:16}}>Configure ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET in Railway Variables. Attach a Railway Volume at /data for persistent workspace files. Never expose this panel publicly without a strong password.</div></section>}
      <div className="footer-note">FRANX HOST · Railway container panel · Keep administrator credentials private.</div>
    </main>
  </div>;
}

function Dashboard({system,navigate}) {
  const mem = system?.memory;
  const usedPct = mem?.percent || 0;
  const diskPct = system?.disk?.available ? Math.round((system.disk.total-system.disk.free)/system.disk.total*100) : null;
  return <>
    <div className="grid stats">
      <Stat label="Memory usage" value={mem?fmtBytes(mem.used):"—"} foot={mem?`${usedPct}% of container-visible memory`:"Waiting for metrics"} icon="▥" />
      <Stat label="CPU load estimate" value={system?`${system.cpu.estimatedPercent}%`:"—"} foot={system?`${system.cpu.cores} visible CPU core(s) · load average`:"Waiting for metrics"} icon="⌁" />
      <Stat label="Panel uptime" value={system?fmtUptime(system.processUptime):"—"} foot="Since this process started" icon="◷" />
      <Stat label="Host status" value="Online" foot="Panel process responding" icon="◉" green />
    </div>
    <div className="grid dashboard-grid">
      <section className="card"><div className="card-head"><div><h2 className="section-title">Resource monitor</h2><div className="section-sub">Metrics visible to this container; not physical host metrics.</div></div><span className="pill">LIVE · 5S</span></div>
        <div className="resource"><div className="resource-line"><span>Memory</span><strong>{mem?`${usedPct}%`:"—"}</strong></div><div className="bar"><span style={{width:`${usedPct}%`}}/></div><div className="tiny" style={{marginTop:6}}>{mem?`${fmtBytes(mem.used)} used / ${fmtBytes(mem.total)} visible`:"Loading memory metrics…"}</div></div>
        <div className="resource"><div className="resource-line"><span>CPU load estimate</span><strong>{system?`${system.cpu.estimatedPercent}%`:"—"}</strong></div><div className="bar"><span style={{width:`${system?.cpu.estimatedPercent||0}%`}}/></div><div className="tiny" style={{marginTop:6}}>Estimated from 1-minute load average; not exact CPU utilization.</div></div>
        <div className="resource"><div className="resource-line"><span>Workspace disk</span><strong>{diskPct===null?"Unavailable":`${diskPct}%`}</strong></div><div className="bar"><span style={{width:`${diskPct||0}%`}}/></div><div className="tiny" style={{marginTop:6}}>{system?.disk?.available?`${fmtBytes(system.disk.total-system.disk.free)} used / ${fmtBytes(system.disk.total)} filesystem`:"Filesystem metrics unavailable"}</div></div>
      </section>
      <section className="card"><div className="card-head"><div><h2 className="section-title">System information</h2><div className="section-sub">Runtime environment details</div></div><div className="card-icon">⌘</div></div>
        <div className="info-list"><InfoRow label="Host" value="Franx Host"/><InfoRow label="Owner" value="kyZX"/><InfoRow label="Platform" value="Railway container"/><InfoRow label="Operating system" value={system?.os||"Loading…"}/><InfoRow label="Architecture" value={system?.arch||"—"}/><InfoRow label="Node.js" value={system?.node||"—"}/><InfoRow label="Uptime" value={system?fmtUptime(system.uptime):"—"}/></div>
      </section>
    </div>
    <div className="grid quick-grid">
      <button className="quick" onClick={()=>navigate("Terminal")}><div className="quick-icon">⌘</div><div className="quick-title">Open Terminal</div><div className="quick-desc">Launch an interactive Linux shell and use Nano.</div></button>
      <button className="quick" onClick={()=>navigate("Files")}><div className="quick-icon">▤</div><div className="quick-title">Manage Files</div><div className="quick-desc">Browse workspace files and edit text documents.</div></button>
      <button className="quick" onClick={()=>navigate("API Manager")}><div className="quick-icon">↗</div><div className="quick-title">API Manager</div><div className="quick-desc">Inspect the runtime and get setup guidance for API processes.</div></button>
    </div>
  </>;
}
function Stat({label,value,foot,icon,green}) { return <div className="card"><div className="card-head"><span className="card-label">{label}</span><span className="card-icon">{icon}</span></div><div className={`stat-value ${green?"accent":""}`}>{value}</div><div className="stat-foot">{foot}</div></div>; }
function InfoRow({label,value}) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>; }

function ApiManager({request}) {
  const [checks,setChecks] = useState(null);
  const [message,setMessage] = useState("");
  const [loading,setLoading] = useState(false);
  const inspect = async () => {
    setLoading(true); setMessage("");
    try {
      const r = await request("/api/system");
      setChecks({node:r.node, platform:r.platform, workspace:r.workspace, uptime:r.processUptime});
      setMessage("Runtime information loaded.");
    } catch(e) { setMessage(e.message); }
    finally { setLoading(false); }
  };
  return <div className="grid" style={{gap:16}}>
    <section className="card"><div className="card-head"><div><h2 className="section-title">API runtime</h2><div className="section-sub">Manage API projects from the terminal in this single Railway container.</div></div><span className="pill">SINGLE CONTAINER</span></div>
      <div className="notice" style={{marginTop:16}}>The panel does not automatically publish arbitrary ports. For public APIs, use the panel's main HTTP port with a reverse proxy/router you explicitly configure, or deploy each API as a separate Railway service. Processes started in a terminal may stop after restart or redeploy. Keep long-running services under a deliberate process manager.</div>
      <div className="toolbar"><button className="btn btn-primary" onClick={inspect} disabled={loading}>{loading?"Checking…":"Inspect runtime"}</button><button className="btn" onClick={()=>{setMessage("Open Terminal and use: cd /data/projects && mkdir my-api && cd my-api && npm init -y");}}>Show quick-start</button></div>
      {message&&<p className="tiny" style={{marginTop:14}}>{message}</p>}
      {checks&&<div className="info-list"><InfoRow label="Runtime" value={checks.node}/><InfoRow label="Platform" value={checks.platform}/><InfoRow label="Workspace" value={checks.workspace}/><InfoRow label="Process uptime" value={fmtUptime(checks.uptime)}/></div>}
    </section>
    <section className="card"><h2 className="section-title">Create an API project</h2><div className="section-sub">Run these commands in the Terminal. The example is a local service and needs routing configuration before public access.</div>
      <pre className="mono" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:11,lineHeight:1.8,color:"#bfe8cf",background:"#080c11",border:"1px solid #263341",padding:16,borderRadius:10,marginTop:16}}>{`cd /data/projects\nmkdir my-api && cd my-api\nnpm init -y\nnpm install express\nnpm pkg set type=module\nnano index.js`}</pre>
      <div className="section-sub" style={{marginTop:12}}>Use Nano to create your API source file, then run it with Node.js. Configure the listening port and public routing deliberately.</div>
    </section>
  </div>;
}
