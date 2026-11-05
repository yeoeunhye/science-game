// 방 / 게임 진행 로직. 네트워크(ws)와 분리해서 테스트할 수 있게 만든다.
// 서버가 규칙 판정의 유일한 기준(server-authoritative)이다. 클라이언트는 "무엇을 하고 싶은지"만 보낸다.
const R = require('../shared/rules.js');
const AI = require('../shared/ai.js');
const crypto = require('crypto');

const LEVEL = 'normal';
const OCTET_MS = 4500;
const TURN_GRACE_MS = 1500;        // 클라이언트 연출 시간만큼 서버 타이머에 더해주는 여유
const GRACE_MS = 60000;            // 접속이 끊긴 사람을 기다려주는 시간 (지나면 AI가 대신 둠)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const clean = (s, max) => String(s == null ? '' : s).replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

class Room {
  constructor(code, mode, hub) {
    this.code = code;
    this.hub = hub;
    this.mode = mode === 'hard' ? 'hard' : 'easy';
    this.members = [];            // 자리 순서 = 게임 시작 시 플레이어 번호
    this.phase = 'lobby';         // lobby | playing | over
    this.S = null;
    this.gameId = 0;
    this.tok = 0;                 // 턴 타이머 무효화용
    this.turnEnds = 0;
    this.timers = {};
    this.octetEnds = 0;
    this.touched = Date.now();
    this.createdAt = Date.now();
  }

  /* ---------- 멤버 ---------- */
  addMember(conn, name, avatar) {
    const m = {
      token: crypto.randomBytes(12).toString('hex'),
      name: clean(name, 8) || '플레이어', avatar: clean(avatar, 8) || '😎',
      conn: null, offlineAt: null, left: false, ai: false, graceT: null,
    };
    this.members.push(m);
    this.attach(m, conn);
    return m;
  }
  attach(m, conn) {
    if (m.conn && m.conn !== conn) {
      const old = m.conn;
      old.room = null; old.member = null;
      try { old.kick('다른 곳에서 접속했어요'); } catch (e) { /* ignore */ }
    }
    m.conn = conn; m.offlineAt = null;
    clearTimeout(m.graceT); m.graceT = null;
    conn.member = m; conn.room = this;
    if (this.S) { const i = this.members.indexOf(m); if (m.ai) { m.ai = false; this.S.players[i].ai = false; } }
  }
  memberByToken(tok) { return this.members.find((m) => m.token === tok && !m.left) || null; }
  seatOf(m) { return this.members.indexOf(m); }
  humans() { return this.members.filter((m) => !m.left); }
  connected() { return this.members.filter((m) => m.conn); }
  isIdle(now) {
    if (this.connected().length) return false;
    const limit = this.phase === 'lobby' ? 60000 : 150000;
    return now - this.touched > limit;
  }

  disconnect(conn) {
    const m = conn.member;
    if (!m || m.conn !== conn) return;
    m.conn = null; m.offlineAt = Date.now(); this.touched = Date.now();
    conn.member = null; conn.room = null;
    if (this.phase === 'lobby') {
      m.graceT = setTimeout(() => this.removeMember(m), GRACE_MS);
      this.sendRoom();
    } else {
      m.graceT = setTimeout(() => this.takeover(m), GRACE_MS);
      this.publish([], { notice: { kind: 'off', seat: this.seatOf(m) } });
      this.scheduleTurn(true);    // 차례였다면 타이머는 그대로 유지
    }
    this.hub.maybeClose(this);
  }

  // 로비에서 나감 / 자리 비움
  removeMember(m) {
    const i = this.members.indexOf(m);
    if (i < 0) return;
    clearTimeout(m.graceT);
    if (m.conn) { m.conn.room = null; m.conn.member = null; }
    this.members.splice(i, 1);
    if (!this.members.length) { this.hub.close(this); return; }
    this.sendRoom();
  }

  // 게임 중 자리를 AI가 넘겨받음 (leave=true면 영구)
  takeover(m, leave) {
    if (!this.S || this.phase !== 'playing') { if (leave) this.removeMember(m); return; }
    const i = this.members.indexOf(m);
    clearTimeout(m.graceT); m.graceT = null;
    if (leave) { m.left = true; if (m.conn) { m.conn.room = null; m.conn.member = null; m.conn = null; } }
    m.ai = true; this.S.players[i].ai = true;
    this.touched = Date.now();
    this.publish([], { notice: { kind: leave ? 'left' : 'ai', seat: i } });
    if (this.S.turn === i) this.scheduleTurn(true);
    this.maybeOctetAI();
    this.hub.maybeClose(this);
  }

  leave(conn) {
    const m = conn.member;
    if (!m) return;
    if (this.phase === 'playing') this.takeover(m, true);
    else this.removeMember(m);
  }

  /* ---------- 로비 ---------- */
  roomInfoFor(m) {
    return {
      t: 'room', code: this.code, mode: this.mode, phase: this.phase,
      you: this.seatOf(m), host: this.hostSeat(),
      members: this.members.map((x) => ({ name: x.name, avatar: x.avatar, online: !!x.conn })),
    };
  }
  hostSeat() { return this.members.findIndex((m) => !m.left); }
  sendRoom() { this.members.forEach((m) => m.conn && m.conn.send(this.roomInfoFor(m))); }

  setMode(conn, mode) {
    if (this.phase !== 'lobby' || this.hostSeat() !== this.seatOf(conn.member)) return;
    this.mode = mode === 'hard' ? 'hard' : 'easy';
    this.sendRoom();
  }

  start(conn) {
    if (this.phase === 'playing') return;
    if (this.hostSeat() !== this.seatOf(conn.member)) return conn.send({ t: 'error', msg: '방장만 시작할 수 있어요' });
    const ready = this.members.filter((m) => m.conn);
    if (ready.length < 2) return conn.send({ t: 'error', msg: '2명 이상 모여야 시작할 수 있어요' });
    this.members = ready;                         // 접속이 끊긴 사람은 자리 정리
    this.S = R.createGame({ mode: this.mode, players: this.members.map((m) => ({ name: m.name, avatar: m.avatar, ai: false })) });
    this.members.forEach((m) => { m.ai = false; m.left = false; });
    this.phase = 'playing'; this.gameId = Date.now();
    this.touched = Date.now();
    this.publish([{ t: 'start' }]);
    this.scheduleTurn(true);
  }

  again(conn) {
    if (this.phase !== 'over') return;
    this.clearTimers();
    this.members = this.members.filter((m) => !m.left && m.conn);
    this.phase = 'lobby'; this.S = null;
    this.sendRoom();
  }

  /* ---------- 게임 진행 ---------- */
  clearTimers() {
    this.tok++;
    Object.keys(this.timers).forEach((k) => { clearTimeout(this.timers[k]); delete this.timers[k]; });
  }

  // 현재 차례의 타이머/AI를 (재)설정한다. keep=true면 이미 돌고 있는 마감시간을 유지.
  scheduleTurn(keep) {
    const S = this.S;
    if (!S || S.over || this.phase !== 'playing') return;
    clearTimeout(this.timers.turn); clearTimeout(this.timers.ai);
    if (!keep || !this.turnEnds) this.turnEnds = Date.now() + R.TURN_SEC * 1000;
    const tok = ++this.tok;
    const pid = S.turn, turnNo = S.turnNo, bonus = S.bonus;
    const wait = Math.max(0, this.turnEnds - Date.now()) + TURN_GRACE_MS;
    this.timers.turn = setTimeout(() => {
      if (this.tok !== tok) return;
      this.run(R.timeout(S, pid), pid);
    }, wait);
    if (this.members[pid].ai) {
      this.timers.ai = setTimeout(() => {
        if (this.tok !== tok || S.over || S.turn !== pid || S.turnNo !== turnNo || S.bonus !== bonus) return;
        const a = AI.decide(S, pid, LEVEL);
        let r;
        if (a.type === 'play') r = R.play(S, pid, a.uid, a.opt);
        else if (a.type === 'pass') r = R.pass(S, pid);
        else r = R.draw(S, pid);
        if (!r.ok) r = S.bonus ? R.pass(S, pid) : R.draw(S, pid);
        this.run(r, pid);
      }, AI.thinkMs(LEVEL) + 400);
    }
  }

  // 액션 결과 처리: 이벤트 방송 + 다음 턴 설정
  run(r, pid) {
    if (!r.ok) return r;
    const S = this.S;
    this.touched = Date.now();
    const turnChanged = r.events.some((e) => e.t === 'turn');
    if (turnChanged) this.turnEnds = 0;
    if (S.over) {
      this.phase = 'over'; this.clearTimers();
      this.publish(r.events);
      return r;
    }
    this.syncOctet(r.events);
    this.publish(r.events);
    this.scheduleTurn(!turnChanged);   // 차례가 안 바뀐 행동(옥텟 등)은 마감 유지
    return r;
  }

  syncOctet(events) {
    // 옥텟 창은 시간 제한이 없다: 본인이 외치거나, 다른 사람이 외쳐주거나, 본인이 다시 행동하면 닫힌다.
    if (events.some((e) => e.t === 'octetOpen')) this.maybeOctetAI();
  }

  // 자리를 AI가 대신 둘 때의 옥텟 외침/지적
  maybeOctetAI() {
    const S = this.S;
    if (!S || !S.octet) return;
    const pid = S.octet.pid;
    const prof = AI.PROFILE[LEVEL];
    const act = (fn, ms) => setTimeout(() => { if (this.S && this.S.octet && this.S.octet.pid === pid) fn(); }, ms);
    if (S.players[pid].ai) {
      if (Math.random() < prof.callOctet) act(() => this.runQuick(R.octet(S, pid)), 700 + Math.random() * 1100);
    } else {
      const catchers = S.players.filter((p) => p.ai && p.id !== pid && Math.random() < prof.catchProb * 0.5);
      if (catchers.length) act(() => this.runQuick(R.catchOctet(S, rnd(catchers).id, pid)), 2600 + Math.random() * 1500);
    }
  }
  runQuick(r) {
    if (!r.ok) return;
    this.publish(r.events);
  }

  // 클라이언트가 보낸 행동
  act(conn, msg) {
    const m = conn.member, S = this.S;
    if (!m || !S || this.phase !== 'playing') return;
    const pid = this.seatOf(m);
    const fail = (e) => conn.send({ t: 'error', msg: e || '할 수 없는 행동이에요', soft: true });
    let r;
    switch (msg.a) {
      case 'play': {
        const o = msg.opt && typeof msg.opt === 'object' ? msg.opt : {};
        const opt = {};
        if (typeof o.basis === 'string') opt.basis = o.basis;
        if (o.target != null) opt.target = Number(o.target);
        if (o.crit && typeof o.crit === 'object') {
          opt.crit = {};
          if (o.crit.period != null) opt.crit.period = Number(o.crit.period);
          if (o.crit.group != null) opt.crit.group = Number(o.crit.group);
        }
        r = R.play(S, pid, Number(msg.uid), opt); break;
      }
      case 'octetbtn': {
        // 옥텟 버튼 하나로 처리: 내 옥텟이면 외치기 / 남의 옥텟이면 대신 외치기 / 아무도 아니면 안내만(패널티 없음)
        if (S.over) return;
        const g = m.octG || (m.octG = { t: [], until: 0 });
        const gd = R.octetGuard(g, Date.now());
        if (gd.blocked) {                       // 연타 → 10초 잠금
          conn.send({ t: 'octlock', ms: gd.ms });
          return fail(gd.fresh ? '옥텟 버튼을 너무 많이 눌러서 10초 동안 쓸 수 없어요' : '옥텟 버튼이 잠겨 있어요 (' + Math.ceil(gd.ms / 1000) + '초)');
        }
        const o = S.octet && S.players[S.octet.pid].hand.length === 1 ? S.octet.pid : null;
        if (o === pid) r = R.octet(S, pid);
        else if (o !== null) r = R.catchOctet(S, pid, o);
        else return fail('지금은 옥텟 상태인 사람이 없어요');
        if (r.ok) return this.runQuick(r);
        break;
      }
      case 'draw': r = R.draw(S, pid); break;
      case 'pass': r = R.pass(S, pid); break;
      case 'octet': r = R.octet(S, pid); if (r.ok) return this.runQuick(r); break;
      case 'catch': r = R.catchOctet(S, pid, Number(msg.target)); if (r.ok) return this.runQuick(r); break;
      default: return;
    }
    if (!r.ok) return fail(r.error);
    this.run(r, pid);
  }

  /* ---------- 방송 ---------- */
  viewFor(i) {
    const S = this.S, now = Date.now();
    return {
      gameId: this.gameId, mode: S.mode, turn: S.turn, over: S.over, winner: S.winner,
      pending: S.pending, bonus: S.bonus, crit: S.crit, available: S.available,
      drawCount: S.deck.length, discardRecent: S.discard.slice(-3),
      hand: S.players[i].hand, playable: R.playable(S, i),
      tleftMs: this.turnEnds ? Math.max(0, this.turnEnds - now) : R.TURN_SEC * 1000,
      octet: S.octet ? { pid: S.octet.pid } : null,
      octLockMs: Math.max(0, ((this.members[i].octG || {}).until || 0) - now),
      players: S.players.map((p, k) => ({
        id: p.id, name: p.name, avatar: p.avatar, count: p.hand.length,
        ai: !!this.members[k].ai, online: !!this.members[k].conn || !!this.members[k].ai,
      })),
    };
  }
  publish(events, extra) {
    if (!this.S) return;
    this.members.forEach((m, i) => {
      if (!m.conn) return;
      m.conn.send(Object.assign({ t: 'update', seat: i, events, view: this.viewFor(i) }, extra || {}));
    });
  }
  // 재접속한 사람에게 현재 상태 한 번 보내기
  resync(m) {
    if (!m.conn) return;
    m.conn.send(this.roomInfoFor(m));
    if (this.S) m.conn.send({ t: 'update', seat: this.seatOf(m), events: [], view: this.viewFor(this.seatOf(m)), sync: true });
  }

  destroy() {
    this.clearTimers();
    clearTimeout(this.timers.octet);
    this.members.forEach((m) => { clearTimeout(m.graceT); if (m.conn) { m.conn.room = null; m.conn.member = null; } });
  }
}

class Hub {
  constructor(opts) {
    this.rooms = new Map();
    this.maxRooms = (opts && opts.maxRooms) || 800;
  }
  newCode() {
    for (let n = 0; n < 50; n++) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
    return null;
  }
  create(conn, name, avatar, mode) {
    if (this.rooms.size >= this.maxRooms) return { error: '지금 방이 너무 많아요. 잠시 뒤에 다시 시도해 주세요' };
    const code = this.newCode();
    if (!code) return { error: '방을 만들 수 없어요' };
    const room = new Room(code, mode, this);
    this.rooms.set(code, room);
    const m = room.addMember(conn, name, avatar);
    return { room, member: m };
  }
  join(conn, code, name, avatar) {
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { error: '그런 방이 없어요. 코드를 다시 확인해 주세요' };
    if (room.phase === 'playing') return { error: '이미 게임이 시작된 방이에요' };
    if (room.members.length >= 4) return { error: '방이 가득 찼어요 (최대 4명)' };
    if (room.phase === 'over') return { error: '게임이 막 끝난 방이에요. 잠시 뒤에 다시 들어와요' };
    const m = room.addMember(conn, name, avatar);
    room.touched = Date.now();
    return { room, member: m };
  }
  rejoin(conn, code, token) {
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) return { error: 'gone' };
    const m = room.memberByToken(String(token || ''));
    if (!m) return { error: 'gone' };
    room.attach(m, conn);
    room.touched = Date.now();
    return { room, member: m };
  }
  maybeClose(room) {
    if (!room.connected().length && room.phase !== 'lobby') {
      // 모두 나갔으면 일정 시간 뒤 정리(sweep)가 처리. 전원이 AI인 게임은 바로 닫는다.
      if (!room.members.some((m) => !m.left && !m.ai)) this.close(room);
    }
  }
  close(room) {
    room.destroy();
    this.rooms.delete(room.code);
  }
  sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.isIdle(now) || now - room.createdAt > 4 * 3600 * 1000) this.close(room);
    }
  }
  stats() {
    let players = 0;
    for (const r of this.rooms.values()) players += r.connected().length;
    return { rooms: this.rooms.size, players };
  }
}

module.exports = { Room, Hub, clean, GRACE_MS, OCTET_MS };
