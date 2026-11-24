// Pencil → Claude relay. Runs on the Mac, serves the iPad drawing app over the LAN,
// and drops each received drawing into the Claude desktop app's message box (unsent).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
// DEMO=1: dry run for demos and recordings. Drawings are received and saved to a temp
// folder, but nothing touches the clipboard, opens Claude, or sends keystrokes.
const DEMO = process.env.DEMO === '1';
const DATA = DEMO ? fs.mkdtempSync(path.join(os.tmpdir(), 'pencil-demo-')) : path.join(ROOT, 'data');
const DRAWINGS = path.join(DATA, 'drawings');
const PORT = Number(process.env.PORT || 8787);
fs.mkdirSync(DRAWINGS, { recursive: true });

// ---- pairing token: only devices that opened the printed link can send ----
const cfgPath = path.join(DATA, 'config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
if (DEMO) cfg.token = process.env.DEMO_TOKEN || 'demo';
else if (!cfg.token) {
  cfg.token = crypto.randomBytes(12).toString('base64url');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
const TOKEN = cfg.token;
const TOKEN_BUF = Buffer.from(TOKEN);
const tokenOk = (t) => {
  if (typeof t !== 'string') return false;
  const b = Buffer.from(t);
  return b.length === TOKEN_BUF.length && crypto.timingSafeEqual(b, TOKEN_BUF);
};

// ---- macOS helpers ----
const run = (cmd, args, timeout = 15000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim()));
});
const osa = (script) => run('osascript', ['-e', script]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claudeState() {
  if (DEMO) return { running: true, windows: 1, demo: true };
  const out = await osa(`
    if application "Claude" is not running then return "off"
    tell application "System Events"
      if not (exists process "Claude") then return "off"
      return (count of windows of process "Claude") as text
    end tell`);
  if (out === 'off') return { running: false, windows: 0 };
  return { running: true, windows: Number(out) || 0 };
}

async function putImageOnClipboard(file) {
  const esc = file.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await osa(`set the clipboard to (read (POSIX file "${esc}") as «class PNGf»)`);
}

async function waitForWindow(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await claudeState()).windows > 0) return true; } catch {}
    await sleep(250);
  }
  return false;
}

const NEW_URL = {
  chat: 'claude://claude.ai/new?surface=chat&source=desktop_action',
  code: 'claude://code/new?source=desktop_action',
};

// Serialize deliveries so two quick sends can't interleave clipboard/keystrokes.
let queue = Promise.resolve();
function deliver(file, target, fallback) {
  const job = queue.then(() => doDeliver(file, target, fallback));
  queue = job.catch(() => {});
  return job;
}

async function doDeliver(file, target, fallback) {
  if (DEMO) {
    const kb = (fs.statSync(file).size / 1024).toFixed(1);
    return `demo: received ${kb} KB, not pasted`;
  }
  const state = await claudeState();
  let mode = target; // 'active' | 'chat' | 'code'
  if (mode === 'active' && (!state.running || state.windows === 0)) mode = fallback;

  await putImageOnClipboard(file);

  if (mode === 'active') {
    await osa('tell application "Claude" to reopen\ntell application "Claude" to activate');
    await sleep(300);
  } else {
    const cold = !state.running;
    await run('open', [NEW_URL[mode]]);
    if (!(await waitForWindow(cold ? 25000 : 6000))) throw new Error('Claude didn’t open a window in time — try again.');
    await osa('tell application "Claude" to reopen\ntell application "Claude" to activate');
    await sleep(cold ? 3500 : 1500); // let the new session's composer mount and focus
  }
  // Paste only if Claude is really frontmost, so the image never lands in another app.
  // key code 9 = the V key, independent of keyboard layout.
  await osa(`tell application "System Events"
    repeat 30 times
      if frontmost of process "Claude" then exit repeat
      delay 0.1
    end repeat
    if not (frontmost of process "Claude") then error "Claude didn’t come to the front, so nothing was pasted."
    key code 9 using command down
  end tell`);
  return mode === 'active' ? 'active session' : `new ${mode} session`;
}

// ---- HTTP ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/manifest.webmanifest') {
      // start_url carries the token: home-screen apps on iPad don't share Safari's storage.
      return send(res, 200, {
        name: 'Pencil → Claude', short_name: 'Sketch', display: 'standalone',
        background_color: '#f4f1ea', theme_color: '#f4f1ea', orientation: 'any',
        start_url: `/?t=${encodeURIComponent(url.searchParams.get('t') || '')}`,
        icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png' }],
      }, TYPES['.webmanifest']);
    }
    if (req.method === 'GET') {
      const rel = p === '/' ? 'index.html' : p.slice(1);
      const f = path.join(PUBLIC, path.normalize(rel));
      if (!f.startsWith(PUBLIC + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
    }

    if (!tokenOk(req.headers['x-token'])) return send(res, 401, { error: 'Not paired. Open the link printed by the Mac server.' });

    if (req.method === 'POST' && p === '/api/status') {
      return send(res, 200, await claudeState());
    }
    if (req.method === 'POST' && p === '/api/send') {
      const target = ['active', 'chat', 'code'].includes(req.headers['x-target']) ? req.headers['x-target'] : 'active';
      const fallback = req.headers['x-fallback'] === 'code' ? 'code' : 'chat';
      const png = await readBody(req);
      if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return send(res, 400, { error: 'Expected a PNG body' });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(DRAWINGS, `sketch-${stamp}.png`);
      fs.writeFileSync(file, png);
      const where = await deliver(file, target, fallback);
      console.log(`[${new Date().toLocaleTimeString()}] ${path.basename(file)} → ${where}`);
      return send(res, 200, { ok: true, where, demo: DEMO });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('error:', e.message);
    let msg = e.message;
    if (/not allowed|assistive|1002|-25211/i.test(msg)) msg = 'Mac blocked the paste: allow this app in System Settings → Privacy & Security → Accessibility.';
    send(res, 500, { error: msg });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  // Bonjour name (what the iPad resolves), not os.hostname(), which can differ.
  if (DEMO) {
    console.log(`Pencil → Claude relay (DEMO, dry run) on :${PORT}\n  http://localhost:${PORT}/?t=${TOKEN}`);
    return;
  }
  const host = (await run('scutil', ['--get', 'LocalHostName']).catch(() => os.hostname().replace(/\.local$/, ''))) + '.local';
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Pencil → Claude relay listening on :${PORT}`);
  console.log(`Open on your iPad (same Wi-Fi):\n  http://${host}:${PORT}/?t=${TOKEN}`);
  for (const ip of ips) console.log(`  http://${ip}:${PORT}/?t=${TOKEN}`);
});
