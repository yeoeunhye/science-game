// 친구와 하기: 서버 연결 / 대기실 / 온라인 게임 컨트롤러.
// 규칙 판정은 전부 서버가 한다. 여기서는 서버가 준 상태를 그리고, 내 행동을 서버에 보내기만 한다.
// Board 는 "나 = 0번 자리" 로 그리므로, 서버의 자리 번호를 내 기준으로 돌려서(relative) 넘긴다.
(function () {
  const B = window.Board, C = window.Cards, Net = window.Net, P = window.Profile;
  const MAIL = '26_32@bssm.hs.kr';
  const SKEY = 'wonso.session';
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let ui = 'closed';                 // closed | connecting | offline | menu | room
  let session = null;                // { code, token } — 새로고침/재접속용
  let room = null;                   // 서버가 준 대기실 정보
  let inGame = false, latest = null, curGameId = null, me = 0, n = 0;
  let queue = [], pumping = false, busy = false, busyT = null, lastRect = null;
  let seen = new Map();
  let timerI = null, retrying = false, noRetry = false, wasDropped = false;

  try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { session = null; }
  function saveSession(s) {
    session = s;
    try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) { /* ignore */ }
  }

  /* ---------- 작은 UI 도구 ---------- */
  function ask(title, text, okLabel) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.style.zIndex = 120;
      ov.innerHTML = '<div class="panel setup"><header class="tut-head"><h2>' + esc(title) + '</h2></header>' +
        '<div class="tut-body"><p class="note">' + esc(text) + '</p>' +
        '<div class="btn-row"><button class="btn btn-ghost" data-v="0">취소</button><button class="btn btn-yellow" data-v="1">' + esc(okLabel || '확인') + '</button></div></div></div>';
      ov.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-v]');
        if (!b) return;
        ov.remove(); resolve(b.dataset.v === '1');
      });
      document.body.appendChild(ov);
    });
  }
  function netbar(text) {
    const el = $('netbar');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('hidden', !text);
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => false);
    return new Promise((resolve) => {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      t.remove(); resolve(ok);
    });
  }

  /* ---------- 친구와 하기 창 ---------- */
  function setUi(next, extra) {
    ui = next;
    const body = $('fr-body');
    $('fr-title').textContent = next === 'room' ? '대기실' : '친구와 하기';
    if (next === 'connecting') {
      body.innerHTML = '<div class="srv-state"><div class="spin"></div><p>' + esc(extra || '서버에 연결하는 중…') + '</p></div>';
    } else if (next === 'offline') {
      body.innerHTML =
        '<div class="srv-state off"><h3>서버가 닫혀 있어요</h3>' +
        '<p>지금은 친구와 하기를 쓸 수 없어요.<br>서버가 켜지면 다시 시도해 주세요.</p>' +
        '<p class="contact">문의가 필요하시면 <a href="mailto:' + MAIL + '">' + MAIL + '</a> 로 메일을 보내주세요.</p>' +
        '<div class="btn-row"><button class="btn btn-ghost" data-fr="close">닫기</button><button class="btn btn-yellow" data-fr="retry">다시 시도</button></div></div>';
    } else if (next === 'menu') {
      const me0 = P.get();
      body.innerHTML =
        '<div class="who"><span class="av">' + me0.avatar + '</span><span><b>' + esc(me0.name) + '</b> 님으로 참가해요</span></div>' +
        '<button class="btn btn-yellow" data-fr="create">방 만들기</button>' +
        '<div class="or"><span>또는 초대 코드로 입장</span></div>' +
        '<div class="join-row"><input id="fr-code" maxlength="4" placeholder="코드 4글자" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
        '<button class="btn btn-yellow" data-fr="join">입장</button></div>' +
        '<p class="err" id="fr-err"></p>';
      const inp = $('fr-code');
      inp.value = extra || '';
      inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') doJoin(); });
      if (extra) inp.focus();
    } else if (next === 'room') {
      renderRoom();
    }
  }

  function renderRoom() {
    const r = room;
    if (!r) return;
    const host = r.you === r.host;
    const online = r.members.filter((m) => m.online).length;
    const slots = [];
    for (let i = 0; i < 4; i++) {
      const m = r.members[i];
      if (!m) { slots.push('<li class="empty"><span class="av">·</span><span class="nm">기다리는 중…</span></li>'); continue; }
      const tags = (i === r.host ? '<em class="host">방장</em>' : '') + (i === r.you ? '<em>나</em>' : '') + (m.online ? '' : '<em class="off">연결 끊김</em>');
      slots.push('<li><span class="av">' + m.avatar + '</span><span class="nm">' + esc(m.name) + '</span>' + tags + '</li>');
    }
    const modeSeg = host
      ? '<div><h4>카드 구성</h4><div class="seg" id="fr-mode">' +
          ['easy', 'hard'].map((k) => '<button data-fr="mode" data-v="' + k + '"' + (r.mode === k ? ' class="on"' : '') + '>' +
            (k === 'easy' ? '이지<small>1~20번 · 74장</small>' : '하드<small>1~36번 · 86장</small>') + '</button>').join('') + '</div></div>'
      : '<p class="note">카드 구성: <b>' + (r.mode === 'hard' ? '하드 (1~36번)' : '이지 (1~20번)') + '</b></p>';
    $('fr-body').innerHTML =
      '<div class="room-code"><small>초대 코드</small><b>' + esc(r.code) + '</b></div>' +
      '<div class="btn-row tight"><button class="btn btn-ghost btn-sm" data-fr="copy-code">코드 복사</button><button class="btn btn-ghost btn-sm" data-fr="copy-link">초대 링크 복사</button></div>' +
      '<div><h4>참가자 ' + r.members.length + ' / 4</h4><ul class="members">' + slots.join('') + '</ul></div>' +
      modeSeg +
      (host
        ? '<button class="btn btn-yellow" data-fr="start"' + (online < 2 ? ' disabled' : '') + '>' + (online < 2 ? '2명 이상 모이면 시작할 수 있어요' : '게임 시작') + '</button>'
        : '<p class="note center">방장이 시작하길 기다리는 중…</p>') +
      '<button class="btn btn-ghost" data-fr="leave">방 나가기</button>';
  }

  function showOverlay(on) { $('friends').classList.toggle('hidden', !on); }

  async function open(prefill) {
    showOverlay(true);
    if (room && ui === 'room') { renderRoom(); return; }
    setUi('connecting', session ? '이전 게임을 찾는 중…' : null);
    noRetry = false;
    try { if (!Net.isOpen()) await Net.connect(4500); } catch (e) { setUi('offline'); return; }
    if (session) { Net.send({ t: 'rejoin', code: session.code, token: session.token }); return; }
    setUi('menu', prefill);
  }
  function close() {
    if (ui === 'room') { leaveRoom(false); return; }   // 대기실의 ✕ 는 방 나가기
    showOverlay(false);
    ui = 'closed';
    if (!session) Net.close(true);
  }

  function doJoin() {
    const code = ($('fr-code').value || '').trim();
    if (code.length < 4) { $('fr-err').textContent = '초대 코드 4글자를 입력해 주세요'; return; }
    const me0 = P.get();
    Net.send({ t: 'join', code, name: me0.name, avatar: me0.avatar });
  }
  function doCreate() {
    const me0 = P.get();
    Net.send({ t: 'create', name: me0.name, avatar: me0.avatar, mode: 'easy' });
  }

  async function leaveRoom(confirmFirst) {
    if (confirmFirst && inGame && latest && !latest.over) {
      const ok = await ask('게임에서 나갈까요?', '나가면 내 자리는 AI가 이어받고, 다시 돌아올 수 없어요.', '나가기');
      if (!ok) return;
    }
    Net.send({ t: 'leave' });
    cleanupAfterLeave();
    setTimeout(() => { if (!session) Net.close(true); }, 300);
  }
  function cleanupAfterLeave() {
    saveSession(null); room = null;
    leaveGameUi();
    showOverlay(false); ui = 'closed';
    window.App.show('screen-main');
  }
  function leaveGameUi() {
    inGame = false; latest = null; curGameId = null; queue = []; busy = false;
    clearInterval(timerI);
    B.hideResult(); B.closePopups(); B.setOctet(false); B.setBonus(false);
  }

  /* ---------- 서버 메시지 ---------- */
  function onMessage(m) {
    switch (m.t) {
      case 'joined':
        saveSession({ code: m.code, token: m.token });
        if (m.rejoined) { netbar(null); if (wasDropped) { C.toast('다시 연결했어요'); wasDropped = false; } }
        break;
      case 'room': onRoom(m); break;
      case 'update': queue.push(m); pump(); break;
      case 'error':
        if (m.soft) { busy = false; C.toast(m.msg); }
        else if (ui === 'menu' && $('fr-err')) $('fr-err').textContent = m.msg;
        else C.toast(m.msg);
        break;
      case 'gone':
        saveSession(null); room = null; netbar(null);
        if (inGame || ui === 'room') { C.toast('게임이 끝났거나 방이 사라졌어요'); cleanupAfterLeave(); }
        else if (ui === 'connecting') setUi('menu');
        break;
      case 'kicked':
        noRetry = true; netbar(null);
        C.toast(m.msg || '다른 곳에서 접속했어요');
        saveSession(null); room = null; leaveGameUi(); showOverlay(false); ui = 'closed';
        window.App.show('screen-main');
        break;
      default: break;
    }
  }

  function onRoom(m) {
    room = m;
    if (m.phase === 'lobby') {
      if (inGame) leaveGameUi();
      window.App.show('screen-main');
      showOverlay(true);
      setUi('room');
    }
  }

  function onDrop() {
    if (noRetry) return;
    if (session) {
      wasDropped = true;
      netbar('연결이 끊겼어요. 다시 연결하는 중…');
      retry();
    } else if (ui === 'menu' || ui === 'connecting') {
      setUi('offline');
    }
  }
  async function retry() {
    if (retrying || !session) return;
    retrying = true;
    let delay = 700;
    while (session && !Net.isOpen() && !noRetry) {
      try {
        await Net.connect(4000);
        Net.send({ t: 'rejoin', code: session.code, token: session.token });
        break;
      } catch (e) { await sleep(delay); delay = Math.min(delay * 1.5, 4000); }
    }
    retrying = false;
  }
  function wake() { if (session && !Net.isOpen() && !noRetry) { wasDropped = true; netbar('연결이 끊겼어요. 다시 연결하는 중…'); retry(); } }
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  // 페이지를 새로고침/재방문했을 때 진행 중인 방으로 조용히 복귀
  function resume() {
    if (!session) return;
    Net.connect(3000).then(() => Net.send({ t: 'rejoin', code: session.code, token: session.token })).catch(() => { /* 서버가 닫혀 있으면 조용히 무시 */ });
  }

  /* ---------- 게임 화면 ---------- */
  const rel = (abs) => (abs - me + n) % n;
  const absOf = (r) => (r + me) % n;

  function toBoard(v) {
    const ps = [];
    for (let k = 0; k < n; k++) {
      const p = v.players[(me + k) % n];
      ps.push({
        id: k, name: p.name, avatar: p.avatar, ai: false,
        tag: !p.online ? '끊김' : (p.ai ? 'AI' : ''),
        count: p.count, exposed: !!(v.octet && v.octet.pid === p.id),
      });
    }
    return {
      gameId: v.gameId, turn: rel(v.turn), over: v.over, pending: v.pending, bonus: v.bonus,
      players: ps, hand: v.hand, playable: new Set(v.playable), discardRecent: v.discardRecent,
      drawCount: v.drawCount, crit: v.crit, available: v.available,
    };
  }
  const renderView = (v) => B.render(toBoard(v));

  function enterGame(v) {
    inGame = true; curGameId = v.gameId;
    showOverlay(false); ui = 'closed';
    seen = new Map();
    B.setHandlers(handlers);
    B.resetHandMemory(); B.hideResult(); B.setOctet(false); B.setBonus(false);
    window.App.show('screen-game');
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const msg = queue.shift();
      try { await handleUpdate(msg, queue.length > 2); }
      catch (e) { console.error(e); try { renderView(msg.view); } catch (e2) { /* ignore */ } }
    }
    pumping = false;
  }

  async function handleUpdate(msg, fast) {
    const v = msg.view;
    me = msg.seat; n = v.players.length;
    const nm = (abs) => '<b>' + esc(v.players[abs].name) + '</b>님';
    let full = false;
    if (!inGame || v.gameId !== curGameId) { enterGame(v); full = true; }
    latest = v;
    busy = false; clearTimeout(busyT);
    if (v.turn !== me && B.isPopupOpen()) B.closePopups();

    if (msg.notice) {
      const k = msg.notice.kind, who = nm(msg.notice.seat);
      if (k === 'off') B.notify(who + '의 연결이 끊겼어요. 60초 안에 돌아오지 않으면 AI가 대신해요', 'warn');
      else if (k === 'ai') B.notify(who + ' 대신 AI가 플레이해요', 'warn');
      else if (k === 'left') B.notify(who + '이 나갔어요. AI가 이어서 플레이해요', 'warn');
    }

    if (msg.sync || full) {
      renderView(v);
      if (v.over) { showEnd(v, v.winner); return; }
      afterRender(v, true);
      if (full && !msg.sync) B.notify('게임 시작!', 'accent');
      return;
    }

    let note = null;
    const flush = () => { if (note) { B.notify(note.html, note.kind); note = null; } };
    let myTurnNow = false;
    for (const e of msg.events) {
      switch (e.t) {
        case 'timeout': B.notify(nm(e.pid) + ' 시간 초과! 자동으로 처리해요', 'warn'); break;
        case 'play': {
          flush();
          if (e.card.kind === 'el') seen.set(e.card.el.num, e.card.el);
          if (!fast) await B.flyPlay(e.card, e.pid === me ? lastRect : B.seatRect(rel(e.pid)), e.pid === me ? e.card.uid : null);
          renderView(v);
          const name = e.card.kind === 'el' ? e.card.el.symbol + '(' + e.card.el.name + ')' : C.SPECIALS[e.card.sp].name;
          note = e.card.kind === 'el'
            ? { html: nm(e.pid) + ' <b>' + name + '</b> 제출! <b>' + e.basis + '</b>로 인정' }
            : { html: nm(e.pid) + ' <b>' + name + '</b>!' };
          break;
        }
        case 'crit': if (note) note.html += ' 새 기준 <b>' + window.Rules.critText(e.crit) + '</b>'; else B.notify('새 기준 <b>' + window.Rules.critText(e.crit) + '</b>'); break;
        case 'steal': if (note) { note.html += ' ' + nm(e.from) + '의 카드를 뺏었어요'; note.kind = 'warn'; } break;
        case 'attack': if (note) { note.html += ' ' + nm(e.to) + '에게 쌓인 공격 <b>+' + e.pending + '</b>'; note.kind = 'warn'; } break;
        case 'bonus': if (note) note.html += ' 한 장 더!'; break;
        case 'draw':
          flush();
          if (e.pid !== me && !fast) await B.flyDraw(rel(e.pid));
          B.notify(e.forced ? nm(e.pid) + ' 카드 <b>' + e.n + '장</b>을 받고 차례를 건너뛰어요'
            : (e.pid === me ? '카드를 한 장 뽑았어요' : nm(e.pid) + ' 카드를 뽑았어요'), e.forced ? 'warn' : '');
          renderView(v);
          break;
        case 'reshuffle': flush(); B.notify('드로우 더미가 떨어져서 버린 카드를 섞었어요'); break;
        case 'octetOpen': flush(); B.notify(e.pid === me ? '손패가 1장! <b>옥텟!</b> 버튼을 눌러요' : nm(e.pid) + ' 손패 1장! 옥텟 버튼을 누를 수 있어요', e.pid === me ? 'accent' : ''); break;
        case 'octet': flush(); B.notify(nm(e.pid) + ' <b>옥텟!</b> 을 외쳤어요', 'good'); break;
        case 'catch': flush(); B.notify(nm(e.by) + '이 ' + nm(e.target) + '의 옥텟을 외쳤습니다! ' + nm(e.target) + ' 카드 <b>' + e.n + '장</b> 패널티 적용', 'warn'); break;
        case 'turn': if (e.pid === me) myTurnNow = true; break;
        case 'win': flush(); renderView(v); showEnd(v, e.pid); return;
        default: break;
      }
    }
    flush();
    renderView(v);
    afterRender(v, myTurnNow);
  }

  function afterRender(v, announce) {
    B.setBonus(v.bonus && v.turn === me);
    startTimer(v);
    if (announce && v.turn === me) {
      if (v.pending > 0) B.notify('공격받는 중! 베타붕괴·핵분열로 맞받거나 더미를 눌러 <b>+' + v.pending + '장</b>을 받아요', 'accent');
      else if (v.bonus) B.notify('공유결합! 한 장 더 내거나 <b>턴 종료</b>를 눌러요', 'accent');
      else B.notify('내 차례!', 'accent');
    }
  }
  function startTimer(v) {
    clearInterval(timerI);
    const end = Date.now() + v.tleftMs, max = window.Rules.TURN_SEC;
    const tick = () => { B.setTimer(Math.max(0, (end - Date.now()) / 1000), max); };
    tick();
    timerI = setInterval(tick, 250);
  }
  function showEnd(v, winner) {
    clearInterval(timerI);
    B.setOctet(false); B.setBonus(false); B.setTimer(0, window.Rules.TURN_SEC);
    B.showResult({
      win: winner === me,
      text: winner === me ? '손패를 모두 비웠어요! 오늘도 원소 마스터' : v.players[winner].name + '님이 먼저 손패를 비웠어요',
      review: [...seen.values()].sort((a, b) => a.num - b.num),
      onAgain() { Net.send({ t: 'again' }); },
      onExit() { leaveRoom(false); },
    });
  }

  /* ---------- 내 입력 ---------- */
  function send(o) {
    if (!Net.send(o)) { C.toast('연결이 끊겨서 보낼 수 없어요. 다시 연결하는 중이에요'); busy = false; return false; }
    clearTimeout(busyT); busyT = setTimeout(() => { busy = false; }, 5000);
    return true;
  }
  const stale = (g) => !inGame || curGameId !== g;

  async function onCard(uid, rect) {
    const v = latest;
    if (!inGame || !v || v.over) return;
    if (v.turn !== me) { C.toast('지금은 상대 차례예요'); return; }
    if (busy || B.isPopupOpen()) return;
    const card = v.hand.find((c) => c.uid === uid);
    if (!card) return;
    if (!v.playable.includes(uid)) {
      B.shakeCard(uid);
      if (v.pending > 0) C.toast('공격받는 중! 베타붕괴·핵분열로만 맞받을 수 있어요');
      return;
    }
    busy = true;
    const g = curGameId, abort = () => { busy = false; };
    const opt = {};
    if (card.kind === 'el') {
      const b = await B.openBasis(card.el, v.crit);
      if (!b || stale(g)) return abort();
      opt.basis = b.type;
    } else if (card.sp === 'noble' || card.sp === 'fission') {
      const c = await B.pickCriterion(card.sp === 'noble' ? '비활성기체! 새 기준을 정해요' : '핵분열! 새 기준을 정해요');
      if (!c || stale(g)) return abort();
      opt.crit = c;
    } else if (card.sp === 'ionic') {
      const ts = latest.players.filter((p) => p.id !== me && p.count > 0);
      if (ts.length === 1) opt.target = ts[0].id;
      else {
        const t = await B.pickTarget(ts.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, count: p.count })));
        if (t == null || stale(g)) return abort();
        opt.target = t;
      }
    }
    if (stale(g) || !latest || latest.turn !== me) return abort();
    lastRect = rect;
    send({ t: 'act', a: 'play', uid, opt });
  }
  function onDraw() {
    const v = latest;
    if (!inGame || !v || v.over) return;
    if (v.turn !== me) { C.toast('지금은 상대 차례예요'); return; }
    if (busy || B.isPopupOpen()) return;
    if (v.bonus) { C.toast('공유결합 중에는 뽑을 수 없어요. 한 장 더 내거나 턴 종료를 눌러요'); return; }
    busy = true; send({ t: 'act', a: 'draw' });
  }
  function onPass() {
    if (!inGame || !latest || latest.turn !== me || busy) return;
    busy = true; send({ t: 'act', a: 'pass' });
  }
  function onOctetBtn() { if (inGame && latest && !latest.over) Net.send({ t: 'act', a: 'octetbtn' }); }
  function onOctet() { onOctetBtn(); }
  function onCatch(r) { if (inGame && latest && !latest.over) Net.send({ t: 'act', a: 'catch', target: absOf(r) }); }

  const handlers = { onCard, onDraw, onPass, onOctet, onCatch, onOctetBtn, onExit() { leaveRoom(true); } };

  /* ---------- 창 안의 버튼 ---------- */
  function init() {
    Net.onMessage(onMessage);
    Net.onClose(onDrop);
    $('friends').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-fr]');
      if (!b) return;
      switch (b.dataset.fr) {
        case 'close': close(); break;
        case 'retry': open(); break;
        case 'create': doCreate(); break;
        case 'join': doJoin(); break;
        case 'mode': Net.send({ t: 'mode', mode: b.dataset.v }); break;
        case 'start': Net.send({ t: 'start' }); break;
        case 'leave': leaveRoom(false); break;
        case 'copy-code': copyText(room.code).then((ok) => C.toast(ok ? '코드를 복사했어요' : '복사할 수 없어요. 코드를 직접 알려주세요')); break;
        case 'copy-link': copyText(location.origin + location.pathname.replace(/index\.html$/, '') + '?room=' + room.code).then((ok) => C.toast(ok ? '초대 링크를 복사했어요' : '복사할 수 없어요. 코드를 직접 알려주세요')); break;
        default: break;
      }
    });
    resume();
  }

  window.Mp = { inGame: () => inGame, away: () => (inGame || ui === 'room') ? leaveRoom(false).then(() => true) : Promise.resolve(false), init, open, close, leave: () => leaveRoom(false), inRoom: () => ui === 'room', MAIL };
})();
