// 부하 테스트: 가짜 플레이어를 많이 붙여 서버가 버티는지 본다.
//   사용: node tools/loadtest.js [방 수=100] [측정 초=40] [행동 간격 ms=1500] [서버 PID]
//   서버는 따로 띄워 두고(예: PORT=8123 node server/server.js) URL 은 환경변수 URL 로 준다.
const fs = require('fs');
const WebSocket = require('ws');
const E = require('../shared/elements.js');

const ROOMS = Number(process.argv[2]) || 100;
const SECS = Number(process.argv[3]) || 40;
const GAP = Number(process.argv[4]) || 1500;
const PID = Number(process.argv[5]) || 0;
const URL = process.env.URL || 'ws://127.0.0.1:8123/ws';

function cpuTicks(pid) { const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8').split(') ')[1].split(' '); return Number(s[11]) + Number(s[12]); }
function rssMB(pid) { return Number(fs.readFileSync('/proc/' + pid + '/status', 'utf8').match(/VmRSS:\s+(\d+)/)[1]) / 1024; }

let acts = 0, updates = 0, errors = 0, games = 0, latSum = 0, latN = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bot(name) {
  const ws = new WebSocket(URL);
  const c = { ws, view: null, seat: null, code: null, sentAt: 0 };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.t === 'joined') c.code = m.code;
    if (m.t === 'update') {
      updates++; c.view = m.view; c.seat = m.seat;
      if (c.sentAt) { latSum += Date.now() - c.sentAt; latN++; c.sentAt = 0; }
      if (m.view.over) games++;
      if (m.view.turn === c.seat && !m.view.over) setTimeout(() => move(c), GAP * (0.5 + Math.random()));
    }
    if (m.t === 'error' && !m.soft) errors++;
  });
  ws.on('error', () => { errors++; });
  c.opened = new Promise((r) => ws.on('open', r));
  c.send = (o) => ws.send(JSON.stringify(o));
  return c;
}

function move(c) {
  const v = c.view;
  if (!v || v.over || v.turn !== c.seat || c.ws.readyState !== 1) return;
  acts++; c.sentAt = Date.now();
  if (v.bonus) return c.send({ t: 'act', a: 'pass' });
  const pl = v.hand.find((x) => v.playable.includes(x.uid));
  if (!pl) return c.send({ t: 'act', a: 'draw' });
  const opt = {};
  if (pl.kind === 'el') opt.basis = E.validBasis(pl.el, v.crit)[0].type;
  else if (pl.sp === 'noble' || pl.sp === 'fission') opt.crit = { period: 2 };
  else if (pl.sp === 'ionic') opt.target = v.players.find((p) => p.id !== c.seat && p.count > 0).id;
  c.send({ t: 'act', a: 'play', uid: pl.uid, opt });
}

(async () => {
  const all = [];
  for (let r = 0; r < ROOMS; r++) {
    const n = 2 + (r % 3);
    const host = bot('h'); all.push(host); await host.opened;
    host.send({ t: 'create', name: 'H' + r, avatar: '😎', mode: r % 2 ? 'hard' : 'easy' });
    while (!host.code) await sleep(5);
    const others = [];
    for (let i = 1; i < n; i++) { const b = bot('b'); all.push(b); others.push(b); await b.opened; b.send({ t: 'join', code: host.code, name: 'B' + i, avatar: '🐸' }); }
    await sleep(30);
    host.send({ t: 'start' });
  }
  console.log('방 ' + ROOMS + '개, 접속자 ' + all.length + '명 시작. ' + SECS + '초 측정…');
  const t0 = PID ? cpuTicks(PID) : 0, w0 = Date.now();
  let peak = 0;
  for (let s = 0; s < SECS; s += 5) { await sleep(5000); if (PID) peak = Math.max(peak, rssMB(PID)); }
  const wall = (Date.now() - w0) / 1000;
  const cpu = PID ? ((cpuTicks(PID) - t0) / 100) / wall * 100 : NaN;
  const st = await (await fetch(URL.replace('ws', 'http').replace('/ws', '/api/status'))).json();
  console.log(JSON.stringify({
    서버집계: st, 행동수: acts, 업데이트수: updates, 끝난게임: games, 오류: errors,
    평균응답ms: latN ? Math.round(latSum / latN) : null,
    서버CPU퍼센트_한코어기준: PID ? Math.round(cpu * 10) / 10 : null, 서버메모리MB최대: PID ? Math.round(peak) : null,
  }, null, 1));
  all.forEach((c) => c.ws.close());
  process.exit(0);
})();
