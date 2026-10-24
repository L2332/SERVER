// Minecraft Web Panel - no packages to install
// Run: node server.js  (or double-click run-panel.bat)

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ===== CHANGE THESE =====
const CONFIG = {
  port: 3000,
  mcDir: "C:/MinecraftServer", // folder containing your server.jar
  jar: "server.jar",
  ram: "4G",
  password: "friends123",   // friends' password (can Start)
  adminPassword: "admin123", // your password (can Stop)
  idleMinutes: 10,          // auto-stop when no players are online
};
// ==========================

let mc = null;
let state = "offline"; // offline | starting | online | stopping
let players = new Set();
let logs = [];
let idleTimer = null;

function addLog(line) {
  logs.push(line);
  if (logs.length > 80) logs.shift();
}

function checkIdle() {
  clearTimeout(idleTimer);
  if (mc && state !== "stopping" && players.size === 0) {
    idleTimer = setTimeout(stopServer, CONFIG.idleMinutes * 60000);
  }
}

function startServer() {
  if (mc) return;
  state = "starting";
  players.clear();
  logs = [];
  mc = spawn("java", [`-Xmx${CONFIG.ram}`, "-jar", CONFIG.jar, "nogui"], {
    cwd: CONFIG.mcDir,
  });
  const onData = (d) =>
    d.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
      addLog(line);
      if (/Done \(.*\)! For help/.test(line)) { state = "online"; checkIdle(); }
      let m = line.match(/: (\S+) joined the game/);
      if (m) { players.add(m[1]); checkIdle(); }
      m = line.match(/: (\S+) left the game/);
      if (m) { players.delete(m[1]); checkIdle(); }
    });
  mc.stdout.on("data", onData);
  mc.stderr.on("data", onData);
  mc.on("error", () => { addLog("Could not start Java. Is it installed?"); mc = null; state = "offline"; });
  mc.on("exit", () => { mc = null; state = "offline"; players.clear(); clearTimeout(idleTimer); });
  checkIdle();
}

function stopServer() {
  if (!mc || state === "stopping") return;
  state = "stopping";
  mc.stdin.write("stop\n");
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 1e4) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

let fails = {}; // simple protection against password guessing
function tooMany(ip) {
  const f = fails[ip] || { n: 0, t: 0 };
  return f.n >= 5 && Date.now() - f.t < 60000;
}
function fail(ip) {
  const f = fails[ip] || { n: 0, t: 0 };
  fails[ip] = { n: f.n + 1, t: Date.now() };
}

http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress;

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  }

  if (req.method === "GET" && req.url === "/api/status") {
    return json(res, 200, { state, players: [...players], logs: logs.slice(-15) });
  }

  if (req.method === "POST" && (req.url === "/api/start" || req.url === "/api/stop")) {
    if (tooMany(ip)) return json(res, 429, { error: "Too many wrong attempts. Wait 1 minute." });
    const { password } = await readBody(req);
    const isStart = req.url === "/api/start";
    const ok = isStart
      ? password === CONFIG.password || password === CONFIG.adminPassword
      : password === CONFIG.adminPassword;
    if (!ok) { fail(ip); return json(res, 403, { error: "Wrong password." }); }
    if (isStart) startServer(); else stopServer();
    return json(res, 200, { ok: true });
  }

  res.writeHead(404); res.end("Not found");
}).listen(CONFIG.port, () => console.log(`Panel ready: http://localhost:${CONFIG.port}`));

process.on("SIGINT", () => { if (mc) mc.stdin.write("stop\n"); setTimeout(() => process.exit(), 3000); });
