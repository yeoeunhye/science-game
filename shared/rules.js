// 원소카드 규칙 엔진. UI/네트워크와 무관한 순수 로직 (브라우저 · Node 공용).
// 상태(state)는 JSON 직렬화 가능. 모든 액션은 { ok, error?, events[] } 를 돌려준다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./elements.js'));
  else root.Rules = factory(root.Elements);
})(this, function (E) {
  const HAND_SIZE = 7;
  const TURN_SEC = 30;
  const OCTET_PENALTY = 2;

  /* ---------- 유틸 ---------- */
  function shuffle(a, rng) {
    rng = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const next = (S, i) => (i + 1) % S.players.length;
  const fail = (error) => ({ ok: false, error, events: [] });
  const isAttack = (c) => c.kind === 'sp' && (c.sp === 'beta' || c.sp === 'fission');

  function critOfCard(el) { return { period: el.period, group: el.group, designated: false }; }
  function critText(c) {
    if (c.period != null && c.group != null) return c.period + '주기 · ' + c.group + '족';
    return c.period != null ? c.period + '주기' : c.group + '족';
  }

  /* ---------- 게임 생성 ---------- */
  function buildDeck(S, rng) {
    const m = E.MODES[S.mode], deck = [];
    E.ELEMENTS.forEach((el) => {
      if (el.num <= m.max) for (let i = 0; i < m.copies; i++) deck.push({ uid: S.uid++, kind: 'el', el });
    });
    Object.keys(E.SPECIAL_COUNTS).forEach((k) => {
      for (let i = 0; i < E.SPECIAL_COUNTS[k]; i++) deck.push({ uid: S.uid++, kind: 'sp', sp: k });
    });
    return shuffle(deck, rng);
  }

  function availableCriteria(mode) {
    const els = E.ELEMENTS.filter((e) => e.num <= E.MODES[mode].max);
    const uniq = (k) => [...new Set(els.map((e) => e[k]))].sort((a, b) => a - b);
    return { periods: uniq('period'), groups: uniq('group') };
  }

  // players: [{ id?, name, avatar, ai }]  (2~4명)
  function createGame(opts) {
    const rng = opts.rng || Math.random;
    const S = {
      mode: opts.mode === 'hard' ? 'hard' : 'easy',
      players: opts.players.map((p, i) => ({ id: i, name: p.name, avatar: p.avatar, ai: !!p.ai, hand: [] })),
      deck: [], discard: [], crit: null, turn: 0, bonus: false, pending: 0,
      octet: null, over: false, winner: null, uid: 1, turnNo: 0,
    };
    S.available = availableCriteria(S.mode);
    S.deck = buildDeck(S, rng);
    S.players.forEach((p) => { p.hand = S.deck.splice(0, HAND_SIZE); });
    // 첫 카드는 원소카드가 나올 때까지
    let first = null;
    while (!first) {
      const c = S.deck.pop();
      if (c.kind === 'el') first = c; else { S.deck.unshift(c); shuffle(S.deck, rng); }
    }
    S.discard.push(first);
    S.crit = critOfCard(first.el);
    return S;
  }

  /* ---------- 조회 ---------- */
  const top = (S) => S.discard[S.discard.length - 1];
  const handOf = (S, pid) => S.players[pid].hand;

  function findCard(S, pid, uid) { return handOf(S, pid).find((c) => c.uid === uid) || null; }

  // 지금 이 카드를 낼 수 있는가 (pid 의 차례일 때만 의미 있음)
  function canPlay(S, pid, card) {
    if (S.over || S.turn !== pid) return false;
    if (S.pending > 0) return isAttack(card);               // 공격받는 중: 맞받아치기만 가능
    if (card.kind === 'el') return E.validBasis(card.el, S.crit).length > 0;
    if (card.sp === 'ionic') return S.players.some((p) => p.id !== pid && p.hand.length > 0);
    return true;                                            // 특수카드는 기준과 무관
  }
  function playable(S, pid) { return handOf(S, pid).filter((c) => canPlay(S, pid, c)).map((c) => c.uid); }
  function basisFor(S, card) { return card.kind === 'el' ? E.validBasis(card.el, S.crit) : []; }
  function targets(S, pid) { return S.players.filter((p) => p.id !== pid && p.hand.length > 0).map((p) => p.id); }

  /* ---------- 내부: 카드 뽑기 ---------- */
  function drawCards(S, pid, n, events, rng) {
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!S.deck.length) {
        if (S.discard.length > 1) {
          const t = S.discard.pop();
          S.deck = shuffle(S.discard, rng); S.discard = [t];
          events.push({ t: 'reshuffle', count: S.deck.length });
        } else break;
      }
      S.players[pid].hand.push(S.deck.pop()); got++;
    }
    return got;
  }

  function advance(S, events, steps) {
    S.turn = (S.turn + (steps || 1)) % S.players.length;
    S.bonus = false; S.turnNo++;
    events.push({ t: 'turn', pid: S.turn });
  }

  /* ---------- 액션: 카드 내기 ---------- */
  // opt: { basis:'period'|'group' (원소), crit:{period}|{group} (비활성기체/핵분열), target:pid (이온결합) }
  function play(S, pid, uid, opt, rng) {
    opt = opt || {};
    if (S.over) return fail('게임이 끝났어요');
    if (S.turn !== pid) return fail('내 차례가 아니에요');
    const card = findCard(S, pid, uid);
    if (!card) return fail('없는 카드예요');
    if (!canPlay(S, pid, card)) return fail('지금은 낼 수 없는 카드예요');

    const events = [];
    let basis = null, critNew = null, target = null;

    if (card.kind === 'el') {
      const valid = basisFor(S, card);
      basis = valid.find((b) => b.type === opt.basis);
      if (!basis) return fail('유효하지 않은 근거예요');
    } else if (card.sp === 'noble' || card.sp === 'fission') {
      const c = opt.crit || {};
      const okP = c.period != null && S.available.periods.includes(c.period);
      const okG = c.group != null && S.available.groups.includes(c.group);
      if (okP === okG) return fail('새 기준(주기 또는 족)을 하나 정해야 해요');
      critNew = okP ? { period: c.period, designated: true } : { group: c.group, designated: true };
    } else if (card.sp === 'ionic') {
      if (!targets(S, pid).includes(opt.target)) return fail('대상을 골라야 해요');
      target = opt.target;
    }

    // --- 적용 ---
    const p = S.players[pid];
    p.hand = p.hand.filter((c) => c.uid !== uid);
    S.discard.push(card);
    events.push({ t: 'play', pid, card, basis: basis ? basis.label : null });

    let counter = 0, again = false;
    if (card.kind === 'el') {
      S.crit = critOfCard(card.el);
    } else {
      switch (card.sp) {
        case 'noble':
          S.crit = critNew; events.push({ t: 'crit', crit: S.crit, by: pid });
          break;
        case 'covalent':
          again = true;
          break;
        case 'ionic': {
          const tp = S.players[target];
          const s = tp.hand.splice(Math.floor((rng || Math.random)() * tp.hand.length), 1)[0];
          p.hand.push(s);
          events.push({ t: 'steal', from: target, to: pid });
          break;
        }
        case 'beta':
          S.pending += 2; counter = 2;
          break;
        case 'fission':
          S.pending += 3; counter = 3; S.crit = critNew;
          events.push({ t: 'crit', crit: S.crit, by: pid });
          break;
      }
    }
    if (counter) events.push({ t: 'attack', from: pid, to: next(S, pid), add: counter, pending: S.pending });

    // 옥텟 창: 이번 내기로 손패가 정확히 1장이 되면 열림. 다른 사람이 내도 유지되고, 본인이 다시 내면 닫힘.
    if (S.octet && S.octet.pid === pid) S.octet = null;
    if (p.hand.length === 1) { S.octet = { pid }; events.push({ t: 'octetOpen', pid }); }

    if (p.hand.length === 0) {
      S.over = true; S.winner = pid; events.push({ t: 'win', pid });
      return { ok: true, events };
    }
    if (again) { S.bonus = true; events.push({ t: 'bonus', pid }); return { ok: true, events }; }
    advance(S, events, 1);
    return { ok: true, events };
  }

  /* ---------- 액션: 드로우 / 패스 / 시간초과 ---------- */
  function draw(S, pid, rng) {
    if (S.over) return fail('게임이 끝났어요');
    if (S.turn !== pid) return fail('내 차례가 아니에요');
    if (S.bonus) return fail('공유결합 중에는 뽑을 수 없어요');
    const events = [];
    if (S.octet && S.octet.pid === pid) S.octet = null;
    if (S.pending > 0) {
      const n = S.pending; S.pending = 0;
      const got = drawCards(S, pid, n, events, rng);
      events.push({ t: 'draw', pid, n: got, forced: true });
      events.push({ t: 'skip', pid });
      advance(S, events, 1);                     // 받은 사람은 차례를 건너뜀
    } else {
      const got = drawCards(S, pid, 1, events, rng);
      events.push({ t: 'draw', pid, n: got });
      advance(S, events, 1);
    }
    return { ok: true, events };
  }

  function pass(S, pid) {
    if (S.over || S.turn !== pid || !S.bonus) return fail('지금은 넘길 수 없어요');
    const events = [];
    if (S.octet && S.octet.pid === pid) S.octet = null;
    advance(S, events, 1);
    return { ok: true, events };
  }

  function timeout(S, pid, rng) {
    if (S.over || S.turn !== pid) return fail('내 차례가 아니에요');
    const r = S.bonus ? pass(S, pid) : draw(S, pid, rng);
    if (r.ok) r.events.unshift({ t: 'timeout', pid });
    return r;
  }

  /* ---------- 액션: 옥텟 / 지적 ---------- */
  function octet(S, pid) {
    if (!S.octet || S.octet.pid !== pid || S.players[pid].hand.length !== 1) return fail('지금은 옥텟을 외칠 수 없어요');
    S.octet = null;
    return { ok: true, events: [{ t: 'octet', pid }] };
  }
  function catchOctet(S, by, target, rng) {
    if (!S.octet || S.octet.pid !== target || by === target || S.players[target].hand.length !== 1) return fail('지적할 수 없어요');
    const events = [];
    S.octet = null;
    const got = drawCards(S, target, OCTET_PENALTY, events, rng);
    events.push({ t: 'catch', by, target, n: got });
    return { ok: true, events };
  }
  function closeOctet(S) { S.octet = null; }

  return {
    HAND_SIZE, TURN_SEC, OCTET_PENALTY,
    createGame, play, draw, pass, timeout, octet, catchOctet, closeOctet,
    canPlay, playable, basisFor, targets, top, critText, critOfCard, isAttack, shuffle,
  };
});
