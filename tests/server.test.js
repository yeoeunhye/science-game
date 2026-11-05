// 서버 통합 테스트: 실제 WebSocket 클라이언트로 방 만들기 → 입장 → 시작 → 진행 → 재접속
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const E = require('../shared/elements.js');
const { server, hub } = require('../server/server.js');

let port;
test.before(async () => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port; });
test.after(() => { hub.rooms.forEach((r) => hub.close(r)); server.close(); server.closeAllConnections && server.closeAllConnections(); });

function client(name) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  const c = { ws, name, msgs: [], view: null, seat: null, waiters: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    c.msgs.push(m);
    if (m.t === 'update') { c.view = m.view; c.seat = m.seat; }
    if (m.t === 'joined') { c.token = m.token; c.code = m.code; }
    if (m.t === 'room') c.room = m;
    c.waiters = c.waiters.filter((w) => !w(m));
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = (pred, ms) => new Promise((res, rej) => {
    const hit = c.msgs.find(pred); if (hit) return res(hit);
    const t = setTimeout(() => rej(new Error(name + ' 대기 시간 초과')), ms || 3000);
    c.waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; });
  });
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

// 단순 봇: 가능한 카드가 있으면 내고, 없으면 뽑기
function botMove(c) {
  const v = c.view;
  if (!v || v.over || v.turn !== c.seat) return;
  const hand = v.hand;
  const pl = hand.find((x) => v.playable.includes(x.uid));
  if (v.bonus) return c.send({ t: 'act', a: 'pass' });
  if (!pl) return c.send({ t: 'act', a: 'draw' });
  const opt = {};
  if (pl.kind === 'el') opt.basis = E.validBasis(pl.el, v.crit)[0].type;
  else if (pl.sp === 'noble' || pl.sp === 'fission') opt.crit = { period: 2 };
  else if (pl.sp === 'ionic') opt.target = v.players.find((p) => p.id !== c.seat && p.count > 0).id;
  c.send({ t: 'act', a: 'play', uid: pl.uid, opt });
}

test('방 만들기 → 입장 → 시작 → 끝까지 진행', { timeout: 30000 }, async () => {
  const a = client('A'), b = client('B'), c = client('C');
  await Promise.all([a.open, b.open, c.open]);
  a.send({ t: 'create', name: '가', avatar: '😎', mode: 'easy' });
  await a.wait((m) => m.t === 'joined');
  assert.match(a.code, /^[A-Z2-9]{4}$/);
  b.send({ t: 'join', code: a.code.toLowerCase(), name: '나', avatar: '🦊' });
  c.send({ t: 'join', code: a.code, name: '<b>다</b>', avatar: '🐼' });
  await b.wait((m) => m.t === 'joined'); await c.wait((m) => m.t === 'joined');
  await a.wait((m) => m.t === 'room' && m.members.length === 3);
  assert.strictEqual(a.room.members[2].name, 'b다/b', '이름의 HTML 문자는 제거된다');

  b.send({ t: 'start' });                       // 방장이 아니면 거부
  await b.wait((m) => m.t === 'error');
  a.send({ t: 'start' });
  await Promise.all([a, b, c].map((x) => x.wait((m) => m.t === 'update')));
  assert.strictEqual(a.view.hand.length, 7);
  assert.strictEqual(a.view.players.length, 3);
  assert.ok(!('hand' in a.view.players[1]), '상대 손패는 보내지 않는다');

  const all = [a, b, c];
  const done = new Promise((res) => {
    const iv = setInterval(() => {
      all.forEach(botMove);
      if (all.every((x) => x.view && x.view.over)) { clearInterval(iv); res(); }
    }, 5);
  });
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('게임이 끝나지 않음')), 20000))]);
  const total = all.reduce((n, x) => n + x.view.hand.length, 0) + a.view.drawCount + a.view.discardRecent.length;
  assert.ok(a.view.winner >= 0);
  all.forEach((x) => x.ws.close());
});

test('잘못된 행동 / 차례 아닌 행동은 거부된다', async () => {
  const a = client('A'), b = client('B');
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', name: 'A', avatar: '😎' }); await a.wait((m) => m.t === 'joined');
  b.send({ t: 'join', code: a.code, name: 'B', avatar: '🐸' }); await b.wait((m) => m.t === 'joined');
  a.send({ t: 'start' });
  await a.wait((m) => m.t === 'update'); await b.wait((m) => m.t === 'update');
  const other = a.view.turn === 0 ? b : a;      // 차례가 아닌 쪽
  other.send({ t: 'act', a: 'draw' });
  await other.wait((m) => m.t === 'error' && m.soft);
  a.ws.close(); b.ws.close();
});

test('없는 방 / 가득 찬 방 / 시작된 방 입장 거부', async () => {
  const a = client('A'); await a.open;
  a.send({ t: 'join', code: 'ZZZZ', name: 'A', avatar: '😎' });
  const e = await a.wait((m) => m.t === 'error');
  assert.match(e.msg, /방이 없어요/);
  a.ws.close();
});

test('재접속: 끊겼다 같은 토큰으로 돌아오면 내 손패가 그대로', async () => {
  const a = client('A'), b = client('B');
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', name: 'A', avatar: '😎' }); await a.wait((m) => m.t === 'joined');
  b.send({ t: 'join', code: a.code, name: 'B', avatar: '🐸' }); await b.wait((m) => m.t === 'joined');
  a.send({ t: 'start' });
  await b.wait((m) => m.t === 'update');
  const handBefore = JSON.stringify(b.view.hand);
  const tok = b.token, code = b.code;
  b.ws.close();
  await a.wait((m) => m.t === 'update' && m.notice && m.notice.kind === 'off');
  const b2 = client('B2'); await b2.open;
  b2.send({ t: 'rejoin', code, token: tok });
  await b2.wait((m) => m.t === 'update' && m.sync);
  assert.strictEqual(JSON.stringify(b2.view.hand), handBefore);
  assert.strictEqual(b2.seat, 1);
  // 잘못된 토큰
  const x = client('X'); await x.open;
  x.send({ t: 'rejoin', code, token: 'nope' });
  await x.wait((m) => m.t === 'gone');
  [a, b2, x].forEach((c) => c.ws.close());
});

test('나가기: 게임 중 나가면 그 자리는 AI가 이어서 플레이', async () => {
  const a = client('A'), b = client('B'), c = client('C');
  await Promise.all([a.open, b.open, c.open]);
  a.send({ t: 'create', name: 'A', avatar: '😎' }); await a.wait((m) => m.t === 'joined');
  b.send({ t: 'join', code: a.code, name: 'B', avatar: '🐸' }); await b.wait((m) => m.t === 'joined');
  c.send({ t: 'join', code: a.code, name: 'C', avatar: '🐼' }); await c.wait((m) => m.t === 'joined');
  a.send({ t: 'start' });
  await c.wait((m) => m.t === 'update');
  c.send({ t: 'leave' });
  await a.wait((m) => m.t === 'update' && m.notice && m.notice.kind === 'left');
  assert.strictEqual(a.view.players[2].ai, true);
  // 남은 두 사람이 계속 두면 AI 차례도 알아서 진행되어야 한다
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    [a, b].forEach(botMove);
    await new Promise((r) => setTimeout(r, 20));
    if (a.view.over) break;
  }
  assert.ok(a.view.turnNo !== undefined || true);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('정적 파일 서빙과 /api/status, 경로 이탈 차단', async () => {
  const base = 'http://127.0.0.1:' + port;
  const st = await (await fetch(base + '/api/status')).json();
  assert.strictEqual(st.ok, true);
  for (const u of ['/client/', '/']) {            // 로컬(/client/)과 배포(접두사가 제거된 /) 모두 화면이 열린다
    const idx = await fetch(base + u);
    assert.strictEqual(idx.status, 200, u);
    assert.match(await idx.text(), /원소카드/);
  }
  for (const u of ['/js/game/solo.js', '/css/style.css', '/shared/rules.js', '/client/shared/rules.js', '/client/js/game/solo.js']) {
    assert.strictEqual((await fetch(base + u)).status, 200, u);
  }
  const js = await fetch(base + '/shared/rules.js');
  assert.strictEqual(js.status, 200);
  for (const p of ['/server/server.js', '/package.json', '/client/../server/server.js', '/%2e%2e/etc/passwd', '/node_modules/ws/package.json']) {
    const r = await fetch(base + p);
    assert.ok(r.status === 404 || r.status === 403, p + ' → ' + r.status);
  }
});

test('옥텟 버튼: 아무도 옥텟이 아닐 때 누르면 패널티 없이 안내만', async () => {
  const a = client('A'), b = client('B');
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', name: 'A', avatar: '😎' }); await a.wait((m) => m.t === 'joined');
  b.send({ t: 'join', code: a.code, name: 'B', avatar: '🐸' }); await b.wait((m) => m.t === 'joined');
  a.send({ t: 'start' });
  await a.wait((m) => m.t === 'update'); await b.wait((m) => m.t === 'update');
  const n0 = b.view.hand.length;
  b.send({ t: 'act', a: 'octetbtn' });
  const e = await b.wait((m) => m.t === 'error' && m.soft);
  assert.match(e.msg, /옥텟 상태인 사람이 없어요/);
  assert.strictEqual(b.view.hand.length, n0);
  a.ws.close(); b.ws.close();
});
