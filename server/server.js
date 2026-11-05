// 원소카드 서버: 정적 파일 + WebSocket(방/게임)을 한 포트에서 제공한다.
//   실행: node server/server.js   (포트: PORT 환경변수, 기본 8000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const { Hub, clean } = require('./rooms.js');

const PORT = Number(process.env.PORT) || 8000;
const ROOT = path.resolve(__dirname, '..');
const MAX_CONN = Number(process.env.MAX_CONN) || 3000;
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 2000;   // 학교 공용 IP(NAT) 뒤에 많은 학생이 있을 수 있어 넉넉하게
const MAX_MSG_BYTES = 2048;
const MAX_MSG_PER_SEC = 25;

const hub = new Hub({ maxRooms: Number(process.env.MAX_ROOMS) || 800 });

/* ---------- 정적 파일 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const cache = new Map();           // 경로 → { mtime, raw, gz }

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('찾을 수 없어요'); }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = '"' + st.size + '-' + Math.floor(st.mtimeMs) + '"';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    const accept = String(req.headers['accept-encoding'] || '');
    const textual = /^(text\/|application\/(javascript|json))|svg/.test(type);
    const send = (e) => {
      if (textual && accept.includes('gzip') && e.gz) {
        res.writeHead(200, Object.assign({ 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': e.gz.length }, headers));
        return res.end(req.method === 'HEAD' ? undefined : e.gz);
      }
      res.writeHead(200, Object.assign({ 'Content-Length': e.raw.length }, headers));
      res.end(req.method === 'HEAD' ? undefined : e.raw);
    };
    const hit = cache.get(file);
    if (hit && hit.etag === etag) return send(hit);
    fs.readFile(file, (e2, raw) => {
      if (e2) { res.writeHead(500); return res.end(); }
      const entry = { etag, raw, gz: textual ? zlib.gzipSync(raw) : null };
      cache.set(file, entry);
      send(entry);
    });
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }

  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(Object.assign({ ok: true }, hub.stats())));
  }
  // 배포 환경(science26)은 /students/{이름}/ 접두사를 떼고 전달한다. 그래서 화면은 '/' 에서, 상대경로로 동작해야 한다.
  // 로컬 개발용 /client/ 주소도 그대로 쓸 수 있다.
  if (pathname === '/client') { res.writeHead(302, { Location: '/client/' + (new URL(req.url, 'http://x').search || '') }); return res.end(); }
  if (pathname.startsWith('/client/')) pathname = pathname.slice('/client'.length);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p.startsWith('.') || p === '..')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('찾을 수 없어요');
  }
  const base = parts[0] === 'shared' ? ROOT : path.join(ROOT, 'client');
  const file = path.join(base, ...parts);
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(req, res, file);
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES });
const perIp = new Map();
let connCount = 0;
let nextId = 1;

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws' && url.pathname !== '/client/ws') { socket.destroy(); return; }
  const ip = req.socket.remoteAddress || '?';
  if (connCount >= MAX_CONN || (perIp.get(ip) || 0) >= MAX_PER_IP) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
});

function makeConn(ws) {
  const conn = {
    id: nextId++, ws, member: null, room: null,
    send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    kick(msg) { conn.send({ t: 'kicked', msg }); ws.close(4001, 'replaced'); },
  };
  return conn;
}

wss.on('connection', (ws, req, ip) => {
  connCount++; perIp.set(ip, (perIp.get(ip) || 0) + 1);
  const conn = makeConn(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let bucket = MAX_MSG_PER_SEC, last = Date.now();

  conn.send({ t: 'hello', ok: true });

  ws.on('message', (data) => {
    const now = Date.now();
    bucket = Math.min(MAX_MSG_PER_SEC, bucket + ((now - last) / 1000) * MAX_MSG_PER_SEC); last = now;
    if (--bucket < 0) return;                       // 과도한 전송은 무시
    let msg;
    try { msg = JSON.parse(String(data)); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(conn, msg); } catch (e) { console.error('핸들러 오류', e); conn.send({ t: 'error', msg: '서버 오류가 났어요' }); }
  });

  ws.on('close', () => {
    connCount--; const n = (perIp.get(ip) || 1) - 1; if (n <= 0) perIp.delete(ip); else perIp.set(ip, n);
    if (conn.room) conn.room.disconnect(conn);
  });
  ws.on('error', () => { /* close 에서 처리 */ });
});

function enter(conn, r) {
  if (r.error) return conn.send({ t: 'error', msg: r.error, fatal: true });
  conn.send({ t: 'joined', code: r.room.code, token: r.member.token });
  r.room.sendRoom();
  r.room.resync(r.member);
}

function handle(conn, msg) {
  switch (msg.t) {
    case 'create':
      if (conn.room) return;
      return enter(conn, hub.create(conn, msg.name, msg.avatar, msg.mode));
    case 'join':
      if (conn.room) return;
      return enter(conn, hub.join(conn, msg.code, msg.name, msg.avatar));
    case 'rejoin': {
      if (conn.room) return;
      const r = hub.rejoin(conn, msg.code, msg.token);
      if (r.error) return conn.send({ t: 'gone' });
      conn.send({ t: 'joined', code: r.room.code, token: r.member.token, rejoined: true });
      r.room.sendRoom();
      r.room.resync(r.member);
      return;
    }
    case 'mode': if (conn.room) conn.room.setMode(conn, msg.mode); return;
    case 'start': if (conn.room) conn.room.start(conn); return;
    case 'again': if (conn.room) conn.room.again(conn); return;
    case 'act': if (conn.room) conn.room.act(conn, msg); return;
    case 'leave': if (conn.room) { const rm = conn.room; rm.leave(conn); conn.send({ t: 'left' }); hub.maybeClose(rm); } return;
    case 'ping': conn.send({ t: 'pong' }); return;
    default: return;
  }
}

// 끊어진 연결 감지 (와이파이에서 조용히 사라지는 경우)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 20000).unref();
setInterval(() => hub.sweep(), 30000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log('원소카드 서버 시작: http://0.0.0.0:' + PORT + '/client/'));
  const stop = () => { console.log('서버를 종료해요'); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

module.exports = { server, hub, clean };
