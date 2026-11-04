// AI 상대. 난이도: easy(쉬움) / normal(보통) / hard(어려움). 규칙 엔진(Rules)만 사용.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./elements.js'), require('./rules.js'));
  else root.AI = factory(root.Elements, root.Rules);
})(this, function (E, R) {
  // think: 생각하는 시간(ms) / callOctet: 옥텟을 잊지 않을 확률 / catchProb: 상대의 옥텟 누락을 지적할 확률
  const PROFILE = {
    easy:   { think: [1900, 3300], callOctet: 0.65, catchProb: 0.2,  label: '쉬움' },
    normal: { think: [1200, 2300], callOctet: 0.9,  catchProb: 0.6,  label: '보통' },
    hard:   { think: [800, 1700],  callOctet: 1,    catchProb: 0.95, label: '어려움' },
  };

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  const handEls = (me, exceptUid) => me.hand.filter((c) => c.kind === 'el' && c.uid !== exceptUid);

  // 내 손패(제외 카드 빼고)에서 해당 기준에 맞는 원소 카드 수
  function matches(me, exceptUid, crit) {
    return handEls(me, exceptUid).filter((c) => E.validBasis(c.el, crit).length > 0).length;
  }

  // 비활성기체/핵분열의 새 기준 선택
  function chooseCrit(S, pid, level, exceptUid, rng) {
    const me = S.players[pid];
    const cands = [];
    S.available.periods.forEach((p) => cands.push({ period: p }));
    S.available.groups.forEach((g) => cands.push({ group: g }));
    if (level !== 'hard') return pick(cands, rng);
    let best = [], bestScore = -1;
    cands.forEach((c) => {
      const s = matches(me, exceptUid, c);
      if (s > bestScore) { bestScore = s; best = [c]; } else if (s === bestScore) best.push(c);
    });
    return pick(best, rng);
  }

  function chooseTarget(S, pid, level, rng) {
    const ts = R.targets(S, pid);
    if (level !== 'hard') return pick(ts, rng);
    // 이온결합은 내 손패 수는 그대로, 상대만 1장 줄어듦 → 가장 카드가 많은 상대에게
    return ts.reduce((a, b) => (S.players[b].hand.length > S.players[a].hand.length ? b : a), ts[0]);
  }

  function optionFor(S, pid, card, level, rng) {
    if (card.kind === 'el') {
      const bs = R.basisFor(S, card);
      return { basis: pick(bs, rng).type };
    }
    if (card.sp === 'noble' || card.sp === 'fission') return { crit: chooseCrit(S, pid, level, card.uid, rng) };
    if (card.sp === 'ionic') return { target: chooseTarget(S, pid, level, rng) };
    return {};
  }

  // 어려움: 카드별 점수
  function score(S, pid, card, rng) {
    const me = S.players[pid];
    const others = S.players.filter((p) => p.id !== pid);
    const minOpp = Math.min(...others.map((p) => p.hand.length));
    const nextCount = S.players[(pid + 1) % S.players.length].hand.length;
    const playableOthers = R.playable(S, pid).filter((u) => u !== card.uid);
    let s = 0;
    if (card.kind === 'el') {
      const nc = R.critOfCard(card.el);
      s = 10 + matches(me, card.uid, nc) * 2.5;      // 내려놓은 뒤에도 이어서 낼 카드가 많을수록 좋음
    } else switch (card.sp) {
      case 'covalent':
        s = me.hand.length === 2 && playableOthers.length ? 100 : (playableOthers.length ? 9 : 2);
        break;
      case 'beta':
        s = (S.pending > 0 ? 18 : 4) + (minOpp <= 2 ? 10 : 0) + (nextCount <= 3 ? 6 : 0);
        break;
      case 'fission':
        s = (S.pending > 0 ? 22 : 5) + (minOpp <= 2 ? 12 : 0) + (nextCount <= 3 ? 7 : 0);
        break;
      case 'noble': {
        const hasEl = R.playable(S, pid).some((u) => me.hand.find((c) => c.uid === u).kind === 'el');
        s = hasEl ? 3 : 12;
        break;
      }
      case 'ionic':
        s = -2;
        break;
    }
    return s + rng() * 0.5;
  }

  function decide(S, pid, level, rng) {
    rng = rng || Math.random;
    level = PROFILE[level] ? level : 'normal';
    const me = S.players[pid];
    const ids = R.playable(S, pid);
    const cards = ids.map((u) => me.hand.find((c) => c.uid === u));

    if (!cards.length) return S.bonus ? { type: 'pass' } : { type: 'draw' };

    // 공격받는 중: 맞받아칠지 받을지
    if (S.pending > 0) {
      const chance = { easy: 0.5, normal: 0.75, hard: 1 }[level];
      if (rng() > chance) return { type: 'draw' };
    }
    // 공유결합 보너스 중: 쉬움은 가끔 그냥 넘김
    if (S.bonus && level === 'easy' && rng() < 0.4) return { type: 'pass' };
    // 쉬움: 낼 수 있어도 가끔 그냥 뽑아버림
    if (level === 'easy' && !S.bonus && S.pending === 0 && rng() < 0.2) return { type: 'draw' };

    let chosen;
    if (level === 'easy') {
      chosen = pick(cards, rng);
    } else if (level === 'normal') {
      const els = cards.filter((c) => c.kind === 'el');
      chosen = els.length && rng() < 0.7 ? pick(els, rng) : pick(cards, rng);
    } else {
      let best = -Infinity;
      cards.forEach((c) => { const sc = score(S, pid, c, rng); if (sc > best) { best = sc; chosen = c; } });
    }
    return { type: 'play', uid: chosen.uid, opt: optionFor(S, pid, chosen, level, rng) };
  }

  const thinkMs = (level, rng) => {
    const t = (PROFILE[level] || PROFILE.normal).think;
    return t[0] + (rng || Math.random)() * (t[1] - t[0]);
  };

  return { PROFILE, decide, thinkMs };
});
