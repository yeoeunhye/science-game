// 혼자하기 컨트롤러: 규칙 엔진(Rules) + AI + 보드 UI(Board) 연결
(function () {
  const E = window.Elements, R = window.Rules, AI = window.AI, B = window.Board, C = window.Cards;
  const LEVEL = 'normal';          // AI 난이도 고정: 보통
  const OCTET_MS = 4500;
  const BOT_NAMES = ['하루', '별이', '도담'];
  const BOT_AV = ['🦊', '🐼', '🐸', '🐙', '🦁', '🐧'];

  let S = null, cfg = null, exitCb = null, mounted = false;
  let ctl = null;   // 타이머/토큰 등 진행 상태

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const nm = (pid) => '<b>' + S.players[pid].name + '</b>님';
  const fxOct = (...a) => { if (window.Fx) window.Fx.octetEvent(...a); };
  const cardName = (c) => (c.kind === 'el' ? c.el.symbol + '(' + c.el.name + ')' : C.SPECIALS[c.sp].name);

  function view() {
    return {
      gameId: ctl.gameId, turn: S.turn, over: S.over, pending: S.pending, bonus: S.bonus,
      players: S.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, ai: p.ai, count: p.hand.length,
        exposed: !!(S.octet && S.octet.pid === p.id),
      })),
      hand: S.players[0].hand,
      playable: new Set(R.playable(S, 0)),      // 낼 수 있는 카드는 항상 표시
      discardRecent: S.discard.slice(-3),
      drawCount: S.deck.length,
      crit: S.crit, available: S.available,
    };
  }

  const handlers = {
    onCard, onDraw, onPass, onOctet, onCatch, onOctetBtn,
    onExit() { stop(); exitCb && exitCb(); },
  };

  function init(onExit) {
    exitCb = onExit;
    if (mounted) return;
    mounted = true;
    B.mount(document.getElementById('screen-game'), handlers);
  }

  function clearTimers() {
    if (!ctl) return;
    clearInterval(ctl.tick); clearTimeout(ctl.aiT); 
    (ctl.octT || []).forEach(clearTimeout); ctl.octT = [];
  }

  // config: { players: 2~4, mode: 'easy'|'hard' }
  function start(config) {
    stop();
    B.setHandlers(handlers);
    cfg = Object.assign({ players: 4, mode: 'easy' }, config);
    const me = window.Profile.get();
    const botAv = BOT_AV.filter((a) => a !== me.avatar);
    const players = [{ name: me.name, avatar: me.avatar, ai: false }];
    for (let i = 0; i < cfg.players - 1; i++) players.push({ name: BOT_NAMES[i], avatar: botAv[i], ai: true });
    S = R.createGame({ mode: cfg.mode, players });
    ctl = { gameId: Date.now(), tok: 0, busy: false, tleft: R.TURN_SEC, octTok: 0, octT: [] };
    ctl.seen = new Map();
    B.resetHandMemory(); B.hideResult(); B.setOctet(false); B.setBonus(false);
    B.render(view());
    beginTurn(true);
  }

  function stop() {
    clearTimers();
    if (ctl) ctl.tok++;
    if (B && B.closePopups) B.closePopups();
    S = null;
  }

  /* ---------- 턴 진행 ---------- */
  function beginTurn(first) {
    if (!S || S.over) return;
    ctl.tok++; ctl.busy = false; ctl.tleft = R.TURN_SEC;
    clearInterval(ctl.tick); clearTimeout(ctl.aiT);
    B.setBonus(S.bonus && S.turn === 0);
    B.setTimer(ctl.tleft, R.TURN_SEC);
    B.render(view());
    const tok = ctl.tok;
    ctl.tick = setInterval(() => {
      if (ctl.tok !== tok) return;
      ctl.tleft--; B.setTimer(ctl.tleft, R.TURN_SEC);
      if (ctl.tleft <= 0) { clearInterval(ctl.tick); onTimeout(tok); }
    }, 1000);

    if (S.turn === 0) {
      if (S.pending > 0) B.notify('공격받는 중! 베타붕괴·핵분열로 맞받거나 더미를 눌러 <b>+' + S.pending + '장</b>을 받아요', 'accent');
      else if (S.bonus) B.notify('공유결합! 한 장 더 내거나 <b>턴 종료</b>를 눌러요', 'accent');
      else B.notify(first ? '게임 시작! 내 차례예요' : '내 차례!', 'accent');
    } else {
      ctl.aiT = setTimeout(() => aiAct(tok), AI.thinkMs(LEVEL));
    }
  }

  function onTimeout(tok) {
    if (!S || ctl.tok !== tok || S.over || S.turn !== 0 || ctl.busy) return;
    B.closePopups();
    apply(R.timeout(S, 0));
  }

  function aiAct(tok) {
    if (!S || ctl.tok !== tok || S.over) return;
    const pid = S.turn;
    const a = AI.decide(S, pid, LEVEL);
    let r;
    if (a.type === 'play') r = R.play(S, pid, a.uid, a.opt);
    else if (a.type === 'pass') r = R.pass(S, pid);
    else r = R.draw(S, pid);
    if (!r.ok) r = S.bonus ? R.pass(S, pid) : R.draw(S, pid);   // 방어: 규칙 위반 시 안전한 행동
    apply(r);
  }

  /* ---------- 액션 결과 처리 (연출 + 알림) ---------- */
  async function apply(r, rect) {
    if (!r.ok) { C.toast(r.error || '할 수 없는 행동이에요'); return; }
    const tok = ctl.tok;
    ctl.busy = true;
    clearInterval(ctl.tick);
    let msg = null;
    const flush = () => { if (msg) { B.notify(msg.html, msg.kind); msg = null; } };

    for (const e of r.events) {
      if (!S || ctl.tok !== tok) return;
      switch (e.t) {
        case 'timeout':
          B.notify('시간 초과! 자동으로 처리해요', 'warn');
          break;
        case 'play': {
          flush();
          if (e.card.kind === 'el') ctl.seen.set(e.card.el.num, e.card.el);
          await B.flyPlay(e.card, e.pid === 0 ? rect : B.seatRect(e.pid), e.pid === 0 ? e.card.uid : null, nm(e.pid));
          if (!S || ctl.tok !== tok) return;
          B.render(view());
          msg = e.card.kind === 'el'
            ? { html: nm(e.pid) + ' <b>' + cardName(e.card) + '</b> 제출! <b>' + e.basis + '</b>로 인정' }
            : { html: nm(e.pid) + ' <b>' + cardName(e.card) + '</b>!' };
          break;
        }
        case 'crit':
          if (msg) msg.html += ' 새 기준 <b>' + R.critText(e.crit) + '</b>';
          else B.notify('새 기준 <b>' + R.critText(e.crit) + '</b>');
          break;
        case 'steal':
          if (msg) { msg.html += ' ' + nm(e.from) + '의 카드를 뺏었어요'; msg.kind = 'warn'; }
          break;
        case 'attack':
          if (msg) { msg.html += ' ' + nm(e.to) + '에게 쌓인 공격 <b>+' + e.pending + '</b>'; msg.kind = 'warn'; }
          break;
        case 'bonus':
          if (msg) msg.html += ' 한 장 더!';
          break;
        case 'draw':
          flush();
          if (e.pid !== 0) await B.flyDraw(e.pid);
          if (!S || ctl.tok !== tok) return;
          B.notify(e.forced
            ? nm(e.pid) + ' 카드 <b>' + e.n + '장</b>을 받고 차례를 건너뛰어요'
            : (e.pid === 0 ? '카드를 한 장 뽑았어요' : nm(e.pid) + ' 카드를 뽑았어요'), e.forced ? 'warn' : '');
          B.render(view());
          break;
        case 'reshuffle':
          flush(); B.notify('드로우 더미가 떨어져서 버린 카드를 섞었어요');
          break;
        case 'octetOpen':
          openOctet(e.pid);
          break;
        case 'win':
          flush();
          finish(e.pid);
          return;
        default: break;
      }
    }
    flush();
    if (!S || ctl.tok !== tok) return;
    await sleep(250);
    if (!S || ctl.tok !== tok) return;
    beginTurn();
  }

  function finish(pid) {
    clearTimers(); ctl.tok++;
    B.setOctet(false); B.setBonus(false); B.render(view());
    B.showResult({
      win: pid === 0,
      text: pid === 0 ? '손패를 모두 비웠어요! 오늘도 원소 마스터' : S.players[pid].name + '님이 먼저 손패를 비웠어요',
      review: [...ctl.seen.values()].sort((a, b) => a.num - b.num),
      onAgain() { start(cfg); },
      onExit() { stop(); exitCb && exitCb(); },
    });
  }

  /* ---------- 옥텟 / 지적 ---------- */
  function openOctet(pid) {
    // 시간 제한 없음. 본인이 누르거나, 남이 대신 외쳐주거나, 본인이 다시 행동하면 닫힌다.
    (ctl.octT || []).forEach(clearTimeout); ctl.octT = [];
    fxOct('octetOpen', pid === 0 ? '나' : nm(pid));
    const tok = ++ctl.octTok;
    const prof = AI.PROFILE[LEVEL];
    const at = (ms, fn) => ctl.octT.push(setTimeout(() => { if (S && ctl.octTok === tok && S.octet && S.octet.pid === pid) fn(); }, ms));

    if (pid === 0) {
      // 내가 못 외치면 AI 중 하나가 대신 외쳐줄 수도 있음
      const catchers = S.players.filter((p) => p.ai && Math.random() < prof.catchProb);
      if (catchers.length) at(2600 + Math.random() * 2000, () => quick(R.catchOctet(S, rnd(catchers).id, 0)));
    } else if (Math.random() < prof.callOctet) {
      at(700 + Math.random() * 1100, () => quick(R.octet(S, pid)));
    } else {
      // AI가 옥텟을 까먹음 → 다른 AI가 외쳐주거나, 내가 옥텟 버튼을 눌러야 함
      const catchers = S.players.filter((p) => p.ai && p.id !== pid && Math.random() < prof.catchProb);
      if (catchers.length) at(3000 + Math.random() * 2000, () => quick(R.catchOctet(S, rnd(catchers).id, pid)));
    }
  }

  // 턴 진행과 무관한 즉시 처리 (옥텟 외침 / 지적)
  function quick(r) {
    if (!r.ok || !S) { if (!r.ok && r.error) C.toast(r.error); return; }
    r.events.forEach((e) => {
      if (e.t === 'octet') {
        fxOct('octet', nm(e.pid));
        B.notify(nm(e.pid) + ' <b>옥텟!</b> 을 외쳤어요', 'good');
      } else if (e.t === 'catch') {
        fxOct('catch', nm(e.by), nm(e.target) + ' 카드 ' + e.n + '장!');
        B.notify(nm(e.by) + '이 ' + nm(e.target) + '의 옥텟을 외쳤습니다! ' + nm(e.target) + ' 카드 <b>' + e.n + '장</b> 패널티 적용', 'warn');
      } else if (e.t === 'reshuffle') {
        B.notify('드로우 더미가 떨어져서 버린 카드를 섞었어요');
      }
    });
    B.render(view());
  }

  /* ---------- 내 입력 ---------- */
  async function onCard(uid, rect) {
    if (!S || S.over) return;
    if (S.turn !== 0) { C.toast('지금은 상대 차례예요'); return; }
    if (ctl.busy || B.isPopupOpen()) return;
    const card = S.players[0].hand.find((c) => c.uid === uid);
    if (!card) return;
    const tok = ctl.tok;
    ctl.busy = true;

    const abort = () => { if (S && ctl.tok === tok) ctl.busy = false; };
    const stale = () => !S || ctl.tok !== tok;

    if (!R.canPlay(S, 0, card)) {
      // 낼 수 없는 카드는 어둡게 표시돼 있음 → 팝업 없이 살짝 흔들기만
      B.shakeCard(uid);
      if (S.pending > 0) C.toast('공격받는 중! 베타붕괴·핵분열로만 맞받을 수 있어요');
      abort(); return;
    }

    const opt = {};
    if (card.kind === 'el') {
      const b = await B.openBasis(card.el, S.crit);
      if (!b || stale()) { abort(); return; }
      opt.basis = b.type;
    } else if (card.sp === 'noble' || card.sp === 'fission') {
      const c = await B.pickCriterion(card.sp === 'noble' ? '비활성기체! 새 기준을 정해요' : '핵분열! 새 기준을 정해요');
      if (!c || stale()) { abort(); return; }
      opt.crit = c;
    } else if (card.sp === 'ionic') {
      const ts = R.targets(S, 0);
      if (ts.length === 1) opt.target = ts[0];
      else {
        const t = await B.pickTarget(ts.map((id) => ({ id, name: S.players[id].name, avatar: S.players[id].avatar, count: S.players[id].hand.length })));
        if (t == null || stale()) { abort(); return; }
        opt.target = t;
      }
    }
    if (stale()) return;
    const r = R.play(S, 0, uid, opt);
    if (!r.ok) { C.toast(r.error); abort(); return; }
    apply(r, rect);
  }

  function onDraw() {
    if (!S || S.over) return;
    if (S.turn !== 0) { C.toast('지금은 상대 차례예요'); return; }
    if (ctl.busy || B.isPopupOpen()) return;
    if (S.bonus) { C.toast('공유결합 중에는 뽑을 수 없어요. 한 장 더 내거나 턴 종료를 눌러요'); return; }
    apply(R.draw(S, 0));
  }
  function onPass() {
    if (!S || S.over || S.turn !== 0 || ctl.busy) return;
    apply(R.pass(S, 0));
  }
  function onOctet() {
    if (!S || S.over) return;
    const r = R.octet(S, 0);
    quick(r);
    if (r.ok && S) B.splash('옥텟!');
  }
  // 옥텟 버튼 하나: 내 옥텟이면 외치기 / 남의 옥텟이면 대신 외치기 / 아니면 안내만(패널티 없음)
  function onOctetBtn() {
    if (!S || S.over) return;
    const gd = R.octetGuard(ctl.octG || (ctl.octG = { t: [], until: 0 }), Date.now());
    if (gd.blocked) { B.setOctetLock(gd.ms); C.toast(gd.fresh ? '옥텟 버튼을 너무 많이 눌러서 10초 동안 쓸 수 없어요' : '옥텟 버튼이 잠겨 있어요'); return; }
    const o = S.octet && S.players[S.octet.pid].hand.length === 1 ? S.octet.pid : null;
    if (o === 0) onOctet();
    else if (o !== null) onCatch(o);
    else C.toast('지금은 옥텟 상태인 사람이 없어요');
  }
  function onCatch(id) {
    if (!S || S.over) return;
    quick(R.catchOctet(S, 0, id));
  }

  window.Solo = { init, start, stop };
})();
