// 게임 보드 UI. 상태(state)를 받아 그리기만 하고 규칙 판단은 하지 않음.
// state = {
//   gameId, turn, over, pending, bonus,
//   players: [{ id, name, avatar, ai, count, exposed }],   // players[0] = 나
//   hand: [{ uid, kind:'el'|'sp', el?, sp? }],
//   playable: Set<uid> | null   (null 이면 낼 수 있는 카드 표시 안 함),
//   discardRecent: [카드...], drawCount,
//   crit: { period?, group?, designated }, available: { periods:[], groups:[] }
// }
(function () {
  const C = window.Cards, E = window.Elements, h = C.h;
  const POS = { 2: ['top'], 3: ['left', 'right'], 4: ['left', 'top', 'right'] };

  let root = null, H = {}, els = {}, S = null;
  let lastDraw = null, lastTurnShown = null, seenAt = new Map();
  let seats = {}, seatKey = null, seen = new Set(), lastTopUid = null, lastCritKey = '', popCancel = null;

  const spec = (card) => (card.kind === 'el' ? card.el : card.sp);

  function setHandlers(h) { H = h; }
  function mount(rootEl, handlers) {
    root = rootEl; H = handlers;
    root.innerHTML =
      '<div class="g-bg" id="g-bg" aria-hidden="true"></div>' +
      '<header class="g-head">' +
        '<button class="chip-btn sm" data-g="exit">← 나가기</button>' +
        '<div class="g-timer" id="g-timer"><div class="timer"><div class="bar" id="g-bar"></div></div><span id="g-sec">30</span></div>' +
        '<button class="chip-btn sm" data-g="table">주기율표</button>' +
        '<div class="g-turns" id="g-turns" aria-label="턴 현황"></div>' +
      '</header>' +
      '<div class="feed" id="g-feed"></div>' +
      '<div class="slot slot-top" id="g-top"></div>' +
      '<div class="slot slot-left" id="g-left"></div>' +
      '<div class="area-table" id="g-tcell">' +
        '<div class="piles" id="g-piles">' +
          '<button class="draw-pile" id="g-draw" data-g="draw" aria-label="카드 뽑기"></button>' +
          '<div class="discard" id="g-discard"></div>' +
          '<button class="oct-btn" id="g-octet" data-g="octet"><b>옥텟!</b><small id="g-octet-sec"></small></button>' +
        '</div>' +
        '<div class="crit" id="g-crit"></div>' +
      '</div>' +
      '<div class="slot slot-right" id="g-right"></div>' +
      '<div class="area-me" id="g-me">' +
        '<div class="me-bar"><div class="me-id" id="g-meid"></div>' +
        '<button class="pass-btn hidden" id="g-pass" data-g="pass">턴 종료</button>' +
        '<button class="sort-btn" id="g-sort" data-g="sort" title="손패 자동 정리"></button></div>' +
        '<div class="hand" id="g-hand"></div>' +
      '</div>' +
      '<div class="pop-layer" id="g-pops"></div>';
    ['timer', 'bar', 'sec', 'feed', 'top', 'left', 'right', 'tcell', 'piles', 'draw', 'discard', 'crit', 'meid', 'pass', 'hand', 'octet', 'octet-sec', 'pops', 'turns', 'sort']
      .forEach((k) => { els[k] = root.querySelector('#g-' + k); });

    buildBg(root.querySelector('#g-bg'));
    paintSort();
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-g]');
      if (!b) return;
      switch (b.dataset.g) {
        case 'exit': H.onExit && H.onExit(); break;
        case 'table': C.openTable(); break;
        case 'draw': H.onDraw && H.onDraw(); break;
        case 'pass': H.onPass && H.onPass(); break;
        case 'octet': H.onOctetBtn && H.onOctetBtn(els.octet.dataset.id === '' ? null : Number(els.octet.dataset.id)); break;
        case 'sort': cycleSort(); break;
        case 'catch': H.onCatch && H.onCatch(Number(b.dataset.id)); break;
      }
    });
    const refit = () => { if (S && root.offsetParent) { fit(); renderHand(S); } };
    window.addEventListener('resize', refit);
    if (window.ResizeObserver) new ResizeObserver(() => { if (S && root.offsetParent) fit(); }).observe(els.tcell);
  }

  // 배경: 흐릿한 주기율표(1~4주기). 주기(가로줄)·족(세로줄) 번호와 카드 색(금속/비금속/준금속)을 그대로 담았다.
  function buildBg(bg) {
    const t = h('div', 'g-table');
    t.appendChild(h('i', 'gt-corner'));
    for (let g = 1; g <= 18; g++) t.appendChild(h('i', 'gt-axis', String(g)));
    for (let p = 1; p <= 4; p++) {
      t.appendChild(h('i', 'gt-axis', String(p)));
      for (let g = 1; g <= 18; g++) {
        const e = E.ELEMENTS.find((x) => x.period === p && x.group === g);
        t.appendChild(e ? h('i', 'gt-cell ' + e.cat, e.symbol) : h('i', 'gt-gap'));
      }
    }
    bg.appendChild(t);
  }

  /* ---------- 크기 맞추기: 중앙 영역 안에 카드 더미가 항상 들어가도록 ---------- */
  function fit() {
    const r = els.tcell.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const row = getComputedStyle(els.tcell).flexDirection === 'row';       // 낮은 가로 화면: 기준 표시를 옆으로
    const reserveH = row ? 0 : 46 + 26 + 28, reserveW = row ? 150 : 0;
    const byH = (r.height - reserveH) / 1.5 - (row ? 14 : 0);
    const byW = (r.width - reserveW - 90) / 3.3;
    const pcw = Math.max(36, Math.min(120, byH, byW));
    els.piles.style.setProperty('--pcw', Math.round(pcw) + 'px');
  }

  /* ---------- 렌더 ---------- */
  function render(state) {
    S = state;
    renderSeats();
    renderTable();
    renderHand(S);
    renderMe();
    const mine = S.turn === 0 && !S.over;
    if (mine && !root.classList.contains('my-turn') && window.Fx) { Fx.snd('turn'); Fx.vib(40); }
    root.classList.toggle('my-turn', mine);
    const ex = S.over ? null : S.players.find((p) => p.exposed);
    els.octet.classList.toggle('on', !!ex);
    els.octet.dataset.id = ex ? ex.id : '';
    els['octet-sec'].textContent = ex && ex.id !== 0 ? ex.name + '님' : '';
    renderTurns();
    fit();
  }

  function renderSeats() {
    const key = S.gameId + ':' + S.players.length;
    if (key !== seatKey) {
      seatKey = key; seats = {};
      ['top', 'left', 'right'].forEach((k) => { els[k].innerHTML = ''; });
      const pos = POS[S.players.length] || POS[4];
      S.players.slice(1).forEach((p, i) => {
        const d = h('div', 'seat seat-' + pos[i]);
        d.innerHTML =
          '<div class="avatar"><span class="em"></span></div>' +
          '<div class="info"><div class="s-name"></div>' +
          '<div class="s-cards"><span class="s-count">0</span></div></div>';
        els[pos[i]].appendChild(d);
        seats[p.id] = { root: d, count: -1 };
      });
    }
    S.players.slice(1).forEach((p) => {
      const s = seats[p.id];
      if (!s) return;
      s.root.querySelector('.em').textContent = p.avatar;
      s.root.querySelector('.s-name').innerHTML = p.name + (p.tag ? '<em>' + p.tag + '</em>' : p.ai ? '<em>AI</em>' : '');
      s.root.classList.toggle('active', S.turn === p.id && !S.over);
      s.root.classList.toggle('exposed', !!p.exposed);
      const cnt = s.root.querySelector('.s-count');
      if (s.count !== p.count) {
        const box = s.root.querySelector('.s-cards');
        box.querySelectorAll('.card').forEach((n) => n.remove());
        for (let i = 0; i < Math.min(p.count, 6); i++) box.insertBefore(C.makeBack(), cnt);
        cnt.textContent = p.count;
        if (s.count !== -1) { cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); }
        s.count = p.count;
      }
    });
  }

  function critHtml(c) {
    const out = [];
    if (c && c.designated) out.push('<span class="tag d">지정</span>');
    if (c && c.period != null) out.push('<span class="tag p">' + c.period + '주기</span>');
    if (c && c.group != null) out.push('<span class="tag g">' + c.group + '족</span>');
    return out.join('');
  }

  function renderTable() {
    const d = els.draw, mine = S.turn === 0 && !S.over;
    d.innerHTML = '';
    d.classList.toggle('attacked', S.pending > 0 && mine);
    d.appendChild(C.makeBack()); d.appendChild(C.makeBack()); d.appendChild(C.makeBack());
    d.insertAdjacentHTML('beforeend',
      '<span class="cnt">' + S.drawCount + '</span>' +
      (S.pending > 0 ? '<span class="pend">+' + S.pending + '</span>' : '') +
      '<span class="lbl">' + (mine ? (S.pending > 0 ? '받기' : '뽑기') : '') + '</span>');

    if (lastDraw !== null && lastDraw !== S.drawCount) { const cn = d.querySelector('.cnt'); if (cn) cn.classList.add('bump'); }
    lastDraw = S.drawCount;
    const top = S.discardRecent[S.discardRecent.length - 1];
    if (top && top.uid !== lastTopUid) {
      els.discard.innerHTML = '';
      S.discardRecent.forEach((c, i) => {
        const n = C.makeCard(spec(c));
        n.style.setProperty('--r', (((c.uid * 37) % 31) - 15) + 'deg');
        n.style.setProperty('--tx', (((c.uid * 13) % 9) - 4) + 'px');
        n.style.setProperty('--ty', (((c.uid * 7) % 9) - 4) + 'px');
        if (i === S.discardRecent.length - 1) n.classList.add('land');
        els.discard.appendChild(n);
      });
      lastTopUid = top.uid;
    }
    const ck = JSON.stringify(S.crit);
    els.crit.innerHTML = '<span>기준</span>' + critHtml(S.crit);
    if (ck !== lastCritKey) {
      lastCritKey = ck;
      els.crit.classList.remove('flash'); void els.crit.offsetWidth; els.crit.classList.add('flash');
    }
  }

  /* ---------- 손패 자동 정리 (기본 / 주기별 / 족별) ---------- */
  const SORTS = [['none', '정렬: 기본'], ['period', '정렬: 주기별'], ['group', '정렬: 족별']];
  let sortMode = 'none';
  try { sortMode = localStorage.getItem('wonso.sort') || 'none'; } catch (e) { /* ignore */ }
  if (!SORTS.some((x) => x[0] === sortMode)) sortMode = 'none';
  function sorted(cards) {
    if (sortMode === 'none') return cards;
    const key = (c) => {
      if (c.kind !== 'el') return [99, 0, 0, c.sp];
      return sortMode === 'period' ? [c.el.period, c.el.group, c.el.num, ''] : [c.el.group, c.el.period, c.el.num, ''];
    };
    return cards.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || String(x[3]).localeCompare(String(y[3]));
    });
  }
  function paintSort() { els.sort.textContent = SORTS.find((x) => x[0] === sortMode)[1]; els.sort.classList.toggle('on', sortMode !== 'none'); }
  function cycleSort() {
    sortMode = SORTS[(SORTS.findIndex((x) => x[0] === sortMode) + 1) % SORTS.length][0];
    try { localStorage.setItem('wonso.sort', sortMode); } catch (e) { /* ignore */ }
    paintSort();
    if (S) renderHand(S);
  }

  /* ---------- 턴 현황 ---------- */
  function renderTurns() {
    const box = els.turns;
    box.innerHTML = '';
    S.players.forEach((p, i) => {
      if (i) box.appendChild(h('i', 'sep', '›'));
      const cur = S.turn === p.id && !S.over;
      const chip = h('span', 'tn' + (cur ? ' cur' : '') + (i === 0 ? ' me' : ''));
      chip.appendChild(h('span', 'av', p.avatar));
      const nm = h('span', 'nm'); nm.textContent = (i === 0 ? '나' : p.name) + (cur ? (i === 0 ? ' · 내 차례' : ' · 차례') : '');
      chip.appendChild(nm);
      box.appendChild(chip);
      if (cur && lastTurnShown !== null && lastTurnShown !== p.id) chip.classList.add('pop');
    });
    lastTurnShown = S.over ? null : S.turn;
  }

  /* ---------- 카드 끌어서 내기 ---------- */
  let justDragged = false;
  // 꾹 눌러 훑어보기(터치용): 카드를 잠깐 누르고 있으면 손가락이 커서가 되어, 옆으로 밀면 지나가는 카드가 앞으로 나와 보인다.
  // 손을 떼면 마지막으로 본 카드가 앞에 남아 있어서, 그 카드를 눌러 내거나 끌어서 낼 수 있다.
  const scrub = { on: false };
  function clearPeek() { els.hand.querySelectorAll('.peek').forEach((n) => n.classList.remove('peek')); }
  function startScrub(ev) {
    if (ev.pointerType === 'mouse') return;
    const sx = ev.clientX, sy = ev.clientY;
    let timer = null, last = null;
    const cards = () => [...els.hand.children];
    const pick = (x) => {
      const cs = cards(); if (cs.length < 2) return cs[0];
      const left0 = cs[0].offsetLeft, step = cs[1].offsetLeft - cs[0].offsetLeft;
      const rel = x - els.hand.getBoundingClientRect().left;
      const lastLeft = cs[cs.length - 1].offsetLeft;
      const i = rel >= lastLeft ? cs.length - 1 : Math.max(0, Math.floor((rel - left0) / (step || 1)));
      return cs[Math.min(cs.length - 1, i)];
    };
    const show = (x) => {
      const n = pick(x); if (!n || n === last) return;
      clearPeek(); n.classList.add('peek'); last = n;
      if (window.Fx) Fx.vib(6);
    };
    const move = (e) => {
      if (!scrub.on) { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 9) stop(); return; }   // 누르기 전에 움직이면 일반 끌기
      e.preventDefault(); show(e.clientX);
    };
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    };
    const up = () => {
      stop();
      if (scrub.on) { justDragged = true; setTimeout(() => { justDragged = false; }, 120); setTimeout(() => { scrub.on = false; }, 0); }
    };
    timer = setTimeout(() => { scrub.on = true; show(sx); if (window.Fx) Fx.vib(12); }, 230);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function startDrag(ev, node, c) {
    if (ev.button > 0 || (isPopupOpen && isPopupOpen())) return;
    if (node.classList.contains('dim') || els.hand.classList.contains('wait')) return;   // 못 내는 카드는 끌 수 없음
    if (scrub.on) return;
    const sx = ev.clientX, sy = ev.clientY, r0 = node.getBoundingClientRect();
    let dragging = false, x = sx, y = sy;
    const over = () => {
      const t = els.tcell.getBoundingClientRect();
      return x > t.left - 20 && x < t.right + 20 && y > t.top - 20 && y < t.bottom + 20 || y < r0.top - 110;
    };
    const move = (e) => {
      x = e.clientX; y = e.clientY;
      if (scrub.on) return;
      if (!dragging && Math.hypot(x - sx, y - sy) > 9) {
        dragging = true; node.classList.add('dragging');
      }
      if (!dragging) return;
      e.preventDefault();
      node.style.transform = 'translate(' + (x - sx) + 'px,' + (y - sy) + 'px) scale(1.1)';
      els.tcell.classList.toggle('drop-ready', over());
    };
    const end = (e) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      els.tcell.classList.remove('drop-ready');
      if (!dragging) return;
      const drop = e.type === 'pointerup' && over();
      node.classList.remove('dragging'); node.style.transform = '';
      justDragged = true; setTimeout(() => { justDragged = false; }, 60);
      if (drop && H.onCard) H.onCard(c.uid, { left: x - r0.width / 2, top: y - r0.height / 2, width: r0.width, height: r0.height });
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function renderHand(state) {
    const hand = els.hand, cards = sorted(state.hand), n = cards.length;
    const vw = root.clientWidth || window.innerWidth;
    const vh = root.clientHeight || window.innerHeight;
    const cw = Math.round(Math.max(50, Math.min(116, vw / 9.5, vh * 0.118)));
    const mine = state.turn === 0 && !state.over;
    const hint = mine && state.playable;
    hand.style.setProperty('--hcw', cw + 'px');
    hand.classList.toggle('hinting', !!hint);
    hand.classList.toggle('wait', !mine);
    hand.innerHTML = '';
    const avail = vw - 60;
    const step = n > 1 ? Math.min(cw * 0.82, (avail - cw) / (n - 1)) : 0;
    const mid = (n - 1) / 2;
    const rotStep = Math.min(4, 14 / Math.max(n, 1));            // 많을수록 완만하게(바깥 카드가 잘리지 않도록)
    const arcMax = Math.max(8, cw * 0.14);
    let newIdx = 0;
    const fresh = [];
    cards.forEach((c, i) => {
      const node = C.makeCard(spec(c));
      node.dataset.uid = c.uid;
      if (i > 0) node.style.marginLeft = (step - cw) + 'px';
      node.style.setProperty('--rot', ((i - mid) * rotStep) + 'deg');
      node.style.setProperty('--ty', Math.min(arcMax, Math.pow(Math.abs(i - mid), 2) * 1.4) + 'px');
      node.style.zIndex = i + 1;
      if (hint) node.classList.add(state.playable.has(c.uid) ? 'ok' : 'dim');
      if (!seen.has(c.uid)) { seen.add(c.uid); seenAt.set(c.uid, performance.now()); }
      if (performance.now() - (seenAt.get(c.uid) || 0) < 150) fresh.push([node, newIdx++ * 0.06]);   // 바로 다시 그려져도 연출은 이어서
      node.addEventListener('click', () => { if (!justDragged && H.onCard) H.onCard(c.uid, node.getBoundingClientRect()); });
      node.addEventListener('pointerdown', (ev) => { if (ev.pointerType !== 'mouse') { const pk = els.hand.querySelector('.peek'); if (pk && pk !== node) clearPeek(); } startScrub(ev); startDrag(ev, node, c); });
      hand.appendChild(node);
    });
    // 새로 들어온 카드: 자리를 먼저 잰 뒤(애니메이션 전), 뽑는 더미 위치에서 출발하도록 설정
    if (fresh.length) {
      const dr = els.draw.getBoundingClientRect();
      fresh.forEach(([node, delay]) => {
        const r = node.getBoundingClientRect();
        node.style.setProperty('--dx', (dr.left + dr.width / 2 - (r.left + r.width / 2)) + 'px');
        node.style.setProperty('--dy', (dr.top + dr.height / 2 - (r.top + r.height / 2)) + 'px');
        node.style.setProperty('--dd', delay + 's');
        node.classList.add('deal');
      });
    }
  }

  function renderMe() {
    const me = S.players[0];
    els.meid.innerHTML = '<span class="av">' + me.avatar + '</span>' + me.name + '<span class="n">' + S.hand.length + '장</span>';
  }

  function resetHandMemory() { seenAt = new Map(); lastDraw = null; lastTurnShown = null; seen = new Set(); lastTopUid = null; lastCritKey = ''; seatKey = null; }
  function shakeCard(uid) {
    const n = els.hand.querySelector('[data-uid="' + uid + '"]');
    if (!n) return;
    if (window.Fx) { Fx.snd('err'); Fx.vib(25); }
    n.classList.remove('shake'); void n.offsetWidth; n.classList.add('shake');
    setTimeout(() => n.classList.remove('shake'), 420);
  }

  /* ---------- 타이머 / 상태 ---------- */
  function setTimer(left, max) {
    els.bar.style.transform = 'scaleX(' + Math.max(0, left / max) + ')';
    els.sec.textContent = Math.max(0, Math.ceil(left));
    els.timer.classList.toggle('warn', left <= 10 && left > 5);
    els.timer.classList.toggle('danger', left <= 5);
  }
  function setBonus(on) { els.pass.classList.toggle('hidden', !on); }
  function setOctet() { /* 옥텟 버튼은 render 가 상태(exposed)로 그린다 */ }

  // 진행 알림: 상단 전용 영역(피드). 최신 2개까지. 중앙과 손패를 가리지 않음.
  function notify(html, kind) {
    if (window.Fx) { if (kind === 'warn') Fx.snd('warn'); else if (kind === 'good') Fx.snd('good'); }
    const a = h('div', 'msg' + (kind ? ' ' + kind : ''), html);
    els.feed.appendChild(a);
    while (els.feed.children.length > 2) els.feed.firstChild.remove();
    setTimeout(() => { a.classList.add('out'); setTimeout(() => a.remove(), 320); }, 6000);
  }
  function splash(text) { notify(text, 'accent'); }

  /* ---------- 날아가는 연출 ---------- */
  function fly(node, from, to, ms) {
    node.style.position = 'fixed';
    node.style.left = from.left + 'px'; node.style.top = from.top + 'px';
    node.style.margin = '0'; node.style.zIndex = '70'; node.style.pointerEvents = 'none';
    node.style.setProperty('--cw', from.width + 'px');
    document.body.appendChild(node);
    const s = to.width / from.width;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const anim = node.animate(
      [{ transform: 'translate(0,0) scale(1) rotate(0deg)' },
       { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ') rotate(' + (Math.random() * 24 - 12) + 'deg)' }],
      { duration: ms || 460, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards' });
    return anim.finished.catch(() => {}).then(() => node.remove());
  }
  const seatRect = (id) => {
    const s = seats[id]; if (!s) return meRect();
    const r = s.root.querySelector('.avatar').getBoundingClientRect();
    return { left: r.left + r.width / 2 - 24, top: r.top + r.height / 2 - 36, width: 48, height: 72 };
  };
  const meRect = () => {
    const r = els.hand.getBoundingClientRect();
    return { left: r.left + r.width / 2 - 30, top: r.top + 30, width: 60, height: 90 };
  };
  function flyPlay(card, from, hideUid) {
    if (hideUid != null) {
      const n = els.hand.querySelector('[data-uid="' + hideUid + '"]');
      if (n) n.style.visibility = 'hidden';
    }
    const f = from || meRect();
    return fly(C.makeCard(spec(card)), { left: f.left, top: f.top, width: f.width, height: f.height }, els.discard.getBoundingClientRect(), 440).then((r) => {
      if (window.Fx) { if (card.kind === 'sp') Fx.special(card.sp); else Fx.snd('play'); }
      return r;
    });
  }
  function flyDraw(playerId) {
    if (window.Fx) Fx.snd('draw');
    if (playerId === 0) return Promise.resolve();
    const dr = els.draw.getBoundingClientRect();
    return fly(C.makeBack(), { left: dr.left, top: dr.top, width: dr.width, height: dr.height }, seatRect(playerId), 380);
  }

  /* ---------- 팝업 ---------- */
  function makePop(resolve) {
    closePopups();
    const ov = h('div', 'pop-ov');
    const box = h('div', 'pop-box');
    ov.appendChild(box);
    els.pops.appendChild(ov);
    const done = (v) => { popCancel = null; ov.remove(); resolve(v); };
    ov.addEventListener('click', (e) => { if (e.target === ov) done(null); });
    popCancel = () => done(null);
    return { box, done };
  }
  function closePopups() { if (popCancel) popCancel(); }
  const isPopupOpen = () => !!popCancel;

  function tableBtn() {
    const b = h('button', 'btn btn-sm btn-ghost', '주기율표');
    b.addEventListener('click', C.openTable);
    return b;
  }

  // 유효 근거 선택 팝업: 실제로 유효한 근거만 선택지로 보여줌
  function openBasis(elm, crit) {
    return new Promise((resolve) => {
      const { box, done } = makePop(resolve);
      const valid = E.validBasis(elm, crit);
      box.innerHTML = '<div class="pop-title"><b>' + elm.symbol + '(' + elm.name + ')</b>을(를) 낼까요?</div>';

      const row = h('div', 'pop-cards');
      const topCard = S.discardRecent[S.discardRecent.length - 1];
      const c1 = h('div', 'col'); c1.appendChild(C.makeCard(spec(topCard), { width: 74 })); c1.appendChild(h('span', '', '가운데 카드'));
      const c2 = h('div', 'col'); c2.appendChild(C.makeCard(elm, { width: 74 })); c2.appendChild(h('span', '', '내 카드'));
      row.appendChild(c1); row.appendChild(h('span', 'arrow', '→')); row.appendChild(c2);
      box.appendChild(row);
      box.appendChild(h('div', 'pop-crit', '지금 기준 ' + critHtml(crit)));

      if (valid.length) {
        box.appendChild(h('div', 'pop-q', '이 카드를 낼 수 있는 <b>실제 근거</b>를 골라요'));
        const opts = h('div', 'pop-opts');
        valid.forEach((r, i) => {
          const b = h('button', 'btn ' + (r.type === 'period' ? 'btn-period' : 'btn-group'),
            r.label + '로 인정<small>' + elm.symbol + '도 ' + r.label + '이에요</small>');
          b.style.animationDelay = (i * 0.06) + 's';
          b.addEventListener('click', () => done(r));
          opts.appendChild(b);
        });
        box.appendChild(opts);
      } else {
        box.appendChild(h('div', 'pop-none',
          '<b>지금은 낼 수 없는 카드예요</b><br>' + elm.symbol + '(' + elm.name + ')은 <span class="tag p">' + elm.period + '주기</span> <span class="tag g">' + elm.group + '족</span>'));
      }
      const foot = h('div', 'pop-foot');
      foot.appendChild(tableBtn());
      const cancel = h('button', 'btn btn-sm btn-ghost', valid.length ? '취소' : '알겠어요');
      cancel.addEventListener('click', () => done(null));
      foot.appendChild(cancel);
      box.appendChild(foot);
    });
  }

  // 새 기준 정하기 (비활성기체 / 핵분열)
  function pickCriterion(title) {
    return new Promise((resolve) => {
      const { box, done } = makePop(resolve);
      box.innerHTML = '<div class="pop-title"><b>' + (title || '새 기준을 정해요') + '</b></div>' +
        '<div class="pop-q">다음 사람은 이 기준에 맞는 카드를 내야 해요</div>';
      box.appendChild(h('div', 'pop-sec', '주기로 정하기'));
      const gp = h('div', 'pop-grid pg');
      S.available.periods.forEach((p) => {
        const b = h('button', 'p', p + '주기');
        b.addEventListener('click', () => done({ period: p }));
        gp.appendChild(b);
      });
      box.appendChild(gp);
      box.appendChild(h('div', 'pop-sec', '족으로 정하기'));
      const gg = h('div', 'pop-grid');
      S.available.groups.forEach((g) => {
        const b = h('button', 'g', g + '족');
        b.addEventListener('click', () => done({ group: g }));
        gg.appendChild(b);
      });
      box.appendChild(gg);
      const foot = h('div', 'pop-foot');
      foot.appendChild(tableBtn());
      const cancel = h('button', 'btn btn-sm btn-ghost', '취소');
      cancel.addEventListener('click', () => done(null));
      foot.appendChild(cancel);
      box.appendChild(foot);
    });
  }

  // 대상 고르기 (이온결합)
  function pickTarget(players) {
    return new Promise((resolve) => {
      const { box, done } = makePop(resolve);
      box.innerHTML = '<div class="pop-title"><b>누구의 카드를 뺏을까요?</b></div><div class="pop-q">손패에서 무작위 1장을 가져와요</div>';
      const list = h('div', 'target-list');
      players.forEach((p) => {
        const b = h('button', 'target', '<span class="av">' + p.avatar + '</span>' + p.name + '<em>' + p.count + '장</em>');
        b.addEventListener('click', () => done(p.id));
        list.appendChild(b);
      });
      box.appendChild(list);
      const foot = h('div', 'pop-foot');
      const cancel = h('button', 'btn btn-sm btn-ghost', '취소');
      cancel.addEventListener('click', () => done(null));
      foot.appendChild(cancel);
      box.appendChild(foot);
    });
  }

  /* ---------- 결과 ---------- */
  function showResult(r) {
    hideResult();
    if (window.Fx) { Fx.snd(r.win ? 'win' : 'lose'); Fx.vib(r.win ? [60, 50, 60, 50, 120] : 120); }
    const ov = h('div', 'result');
    const cols = ['#d4574d', '#e8b730', '#2a9d8f', '#5b8bd6', '#8f7bd0', '#f8f4ea'];
    if (r.win) {
      for (let i = 0; i < 46; i++) {
        const c = h('i', 'confetti');
        c.style.left = Math.random() * 100 + '%';
        c.style.background = cols[i % cols.length];
        c.style.animationDuration = (2.4 + Math.random() * 2.4) + 's';
        c.style.animationDelay = (-Math.random() * 4) + 's';
        ov.appendChild(c);
      }
    }
    const box = h('div', 'result-box');
    box.innerHTML = '<div class="result-title' + (r.win ? '' : ' lose') + '">' + (r.win ? '승리!' : '아쉬워요') + '</div>' +
      '<div class="result-sub">' + r.text + '</div>';
    if (r.review && r.review.length) {
      const rv = h('div', 'review');
      rv.appendChild(h('div', 'rv-title', '이번 판에 나온 원소 복습 <small>' + r.review.length + '개</small>'));
      const grid = h('div', 'rv-grid');
      r.review.forEach((e, i) => {
        const c = h('div', 'rv ' + e.cat);
        c.style.animationDelay = (i * 0.03) + 's';
        c.innerHTML = '<b>' + e.symbol + '</b><span>' + e.name + '</span><em>' + e.period + '주기 · ' + e.group + '족</em>';
        grid.appendChild(c);
      });
      rv.appendChild(grid); box.appendChild(rv);
    }
    const btns = h('div', 'result-btns');
    const again = h('button', 'btn btn-yellow', '한 판 더');
    again.addEventListener('click', () => { hideResult(); r.onAgain && r.onAgain(); });
    const exit = h('button', 'btn btn-ghost', '메인으로');
    exit.addEventListener('click', () => { hideResult(); r.onExit && r.onExit(); });
    btns.appendChild(again); btns.appendChild(exit);
    box.appendChild(btns); ov.appendChild(box);
    root.appendChild(ov);
  }
  function hideResult() { const r = root && root.querySelector('.result'); if (r) r.remove(); }

  window.Board = {
    mount, setHandlers, render, resetHandMemory, setTimer, setBonus, setOctet, notify, splash, shakeCard,
    flyPlay, flyDraw, seatRect, openBasis, pickCriterion, pickTarget, closePopups, isPopupOpen, showResult, hideResult,
  };
})();
