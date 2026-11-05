const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../shared/elements.js');
const R = require('../shared/rules.js');

const el = (n) => E.byNum[n];
let uid = 9000;
const C = (n) => ({ uid: uid++, kind: 'el', el: el(n) });
const SP = (sp) => ({ uid: uid++, kind: 'sp', sp });

function game(n = 3, mode = 'easy') {
  const S = R.createGame({ mode, players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i, avatar: 'x', ai: i > 0 })) });
  return S;
}
// 상태를 직접 세팅하는 헬퍼
function setup(S, { center, hands, turn = 0, crit }) {
  S.discard = [C(center)];
  S.crit = crit || R.critOfCard(el(center));
  hands.forEach((h, i) => { S.players[i].hand = h; });
  S.turn = turn; S.pending = 0; S.bonus = false; S.octet = null; S.over = false;
  S.deck = Array.from({ length: 30 }, () => C(1));
}

test('덱 구성: 이지 74장 / 하드 86장', () => {
  for (const [mode, total] of [['easy', 74], ['hard', 86]]) {
    const S = game(4, mode);
    const all = S.deck.length + S.discard.length + S.players.reduce((a, p) => a + p.hand.length, 0);
    assert.equal(all, total);
    S.players.forEach((p) => assert.equal(p.hand.length, 7));
    assert.equal(S.discard[0].kind, 'el');
  }
});

test('특수카드 장수: 핵분열 2, 나머지 3', () => {
  const S = game(2);
  const cnt = {};
  [...S.deck, ...S.discard, ...S.players.flatMap((p) => p.hand)].filter((c) => c.kind === 'sp').forEach((c) => { cnt[c.sp] = (cnt[c.sp] || 0) + 1; });
  assert.deepEqual(cnt, { noble: 3, covalent: 3, ionic: 3, beta: 3, fission: 2 });
});

test('같은 주기 / 같은 족으로 낼 수 있고, 아니면 못 낸다', () => {
  const S = game(2);
  const k = C(19), mg = C(12), o = C(8); // 중앙 Na(3주기 1족): K=1족 O/없음 Mg=3주기
  setup(S, { center: 11, hands: [[k, mg, o], [C(1)]] });
  assert.deepEqual(R.playable(S, 0).sort(), [k.uid, mg.uid].sort());
  assert.equal(R.play(S, 0, o.uid, { basis: 'group' }).ok, false);
  assert.equal(R.play(S, 0, k.uid, { basis: 'period' }).ok, false); // K는 4주기 → period 근거 없음
  const r = R.play(S, 0, k.uid, { basis: 'group' });
  assert.equal(r.ok, true);
  assert.equal(S.turn, 1);
});

test('같은 원소는 근거가 둘 다 유효', () => {
  const S = game(2);
  const na = C(11);
  setup(S, { center: 11, hands: [[na, C(2)], [C(1)]] });
  assert.deepEqual(R.basisFor(S, na).map((b) => b.type).sort(), ['group', 'period']);
});

test('사용자 규칙: 지정 기준은 다음 사람에게만, 낸 카드의 주기·족이 새 기준이 된다', () => {
  const S = game(3);
  const noble = SP('noble'), ge = C(32), hh = C(6), o = C(8); // Ge = 4주기 14족, C = 2주기 14족
  setup(S, { center: 11, hands: [[noble, C(1)], [C(20), ge, C(3)], [hh, o, C(1)]] });
  assert.equal(R.play(S, 0, noble.uid, { crit: { period: 4 } }).ok, true);
  assert.equal(S.crit.period, 4); assert.equal(S.crit.designated, true);
  // 다음 사람(1번)은 4주기 카드만: Ca(4주기) / Ge(4주기) 가능, Li(2주기) 불가
  assert.equal(R.playable(S, 1).length, 2);
  assert.equal(R.play(S, 1, ge.uid, { basis: 'period' }).ok, true);
  // 그 카드 Ge(4주기 14족) → 이제 14족도 가능: C(14족) 가능
  assert.equal(S.crit.group, 14); assert.equal(S.crit.designated, false);
  assert.ok(R.playable(S, 2).includes(hh.uid));
  assert.ok(!R.playable(S, 2).includes(o.uid)); // O = 2주기 16족 → 4주기도 14족도 아님
});

test('지정 기준을 못 맞춰 뽑아도 다음 사람까지 지정 기준 유지', () => {
  const S = game(3);
  const noble = SP('noble');
  setup(S, { center: 11, hands: [[noble, C(1)], [C(3)], [C(20)]] });
  R.play(S, 0, noble.uid, { crit: { group: 2 } });
  assert.deepEqual(R.playable(S, 1), []);
  R.draw(S, 1);
  assert.equal(S.crit.designated, true);
  assert.equal(S.turn, 2);
  assert.equal(R.playable(S, 2).length, 1); // Ca(2족)
});

test('베타붕괴: 다음 사람 +2장 받고 건너뜀', () => {
  const S = game(3);
  const b = SP('beta');
  setup(S, { center: 11, hands: [[b, C(1)], [C(3)], [C(20)]] });
  R.play(S, 0, b.uid);
  assert.equal(S.pending, 2); assert.equal(S.turn, 1);
  // 공격받는 중에는 원소카드를 못 냄
  assert.deepEqual(R.playable(S, 1), []);
  const r = R.draw(S, 1);
  assert.equal(S.players[1].hand.length, 3);
  assert.equal(S.pending, 0);
  assert.equal(S.turn, 2);           // 1번은 건너뜀
});

test('스택: 베타(+2) → 핵분열(+3) = +5, 3번이 받는다', () => {
  const S = game(4);
  const b = SP('beta'), f = SP('fission');
  setup(S, { center: 11, hands: [[b, C(1)], [f, C(3)], [C(20)], [C(2)]] });
  R.play(S, 0, b.uid);
  assert.deepEqual(R.playable(S, 1), [f.uid]);
  assert.equal(R.play(S, 1, f.uid, { crit: { period: 2 } }).ok, true);
  assert.equal(S.pending, 5);
  assert.equal(S.crit.period, 2);
  R.draw(S, 2);
  assert.equal(S.players[2].hand.length, 6);
  assert.equal(S.turn, 3);
});

test('핵분열 스택은 새 기준 지정 필수', () => {
  const S = game(2);
  const f = SP('fission');
  setup(S, { center: 11, hands: [[f, C(1)], [C(3)]] });
  assert.equal(R.play(S, 0, f.uid, {}).ok, false);
  assert.equal(R.play(S, 0, f.uid, { crit: { period: 1, group: 1 } }).ok, false);
  assert.equal(R.play(S, 0, f.uid, { crit: { group: 99 } }).ok, false);
  assert.equal(R.play(S, 0, f.uid, { crit: { group: 2 } }).ok, true);
  assert.equal(S.pending, 3);
});

test('공유결합: 한 장 더, 패스하면 턴 종료', () => {
  const S = game(3);
  const cv = SP('covalent'), k = C(19);
  setup(S, { center: 11, hands: [[cv, k, C(1)], [C(3)], [C(20)]] });
  R.play(S, 0, cv.uid);
  assert.equal(S.turn, 0); assert.equal(S.bonus, true);
  assert.equal(R.draw(S, 0).ok, false);               // 보너스 중 뽑기 불가
  assert.equal(R.play(S, 0, k.uid, { basis: 'group' }).ok, true);
  assert.equal(S.turn, 1);
  // 패스
  const S2 = game(3); const cv2 = SP('covalent');
  setup(S2, { center: 11, hands: [[cv2, C(1)], [C(3)], [C(20)]] });
  R.play(S2, 0, cv2.uid);
  assert.equal(R.pass(S2, 0).ok, true); assert.equal(S2.turn, 1);
});

test('이온결합: 대상 손패에서 1장을 가져온다', () => {
  const S = game(3);
  const io = SP('ionic');
  setup(S, { center: 11, hands: [[io, C(1)], [C(3), C(4)], [C(20)]] });
  assert.equal(R.play(S, 0, io.uid, { target: 0 }).ok, false);
  assert.equal(R.play(S, 0, io.uid, { target: 1 }).ok, true);
  assert.equal(S.players[1].hand.length, 1);
  assert.equal(S.players[0].hand.length, 2);
});

test('비활성기체는 언제든 낼 수 있다', () => {
  const S = game(2);
  const n = SP('noble');
  setup(S, { center: 11, hands: [[n, C(8)], [C(3)]] });
  assert.ok(R.playable(S, 0).includes(n.uid));
  assert.equal(R.play(S, 0, n.uid, { crit: { group: 16 } }).ok, true);
});

test('옥텟: 외치면 안전 / 지적당하면 +2장', () => {
  const S = game(3);
  const a = C(19), b = C(19);
  setup(S, { center: 11, hands: [[a, b], [C(3)], [C(20)]] });
  R.play(S, 0, a.uid, { basis: 'group' });
  assert.deepEqual(S.octet, { pid: 0 });
  assert.equal(R.catchOctet(S, 0, 0).ok, false);       // 자기 자신 지적 불가
  const r = R.catchOctet(S, 1, 0);
  assert.equal(r.ok, true); assert.equal(S.players[0].hand.length, 3);
  assert.equal(S.octet, null);
  // 외친 경우
  const S2 = game(3); const c = C(19), d = C(19);
  setup(S2, { center: 11, hands: [[c, d], [C(3)], [C(20)]] });
  R.play(S2, 0, c.uid, { basis: 'group' });
  assert.equal(R.octet(S2, 0).ok, true);
  assert.equal(R.catchOctet(S2, 1, 0).ok, false);
});

test('승리: 손패가 0장', () => {
  const S = game(2);
  const k = C(19);
  setup(S, { center: 11, hands: [[k], [C(3)]] });
  const r = R.play(S, 0, k.uid, { basis: 'group' });
  assert.equal(S.over, true); assert.equal(S.winner, 0);
  assert.ok(r.events.some((e) => e.t === 'win'));
});

test('드로우 더미 소진 시 버린 카드를 (맨 위 제외) 섞어 재사용', () => {
  const S = game(2);
  setup(S, { center: 11, hands: [[C(1)], [C(3)]] });
  S.deck = [];
  S.discard = [C(1), C(2), C(3), C(4), C(11)];
  const topCard = S.discard[4];
  const r = R.draw(S, 0);
  assert.ok(r.events.some((e) => e.t === 'reshuffle'));
  assert.equal(S.discard.length, 1); assert.equal(S.discard[0].uid, topCard.uid);
  assert.equal(S.players[0].hand.length, 2);
  assert.equal(S.deck.length, 3);
});

test('시간초과: 자동 드로우, 보너스 중이면 패스', () => {
  const S = game(2);
  setup(S, { center: 11, hands: [[C(1)], [C(3)]] });
  R.timeout(S, 0);
  assert.equal(S.players[0].hand.length, 2); assert.equal(S.turn, 1);
});

test('내 차례가 아니면 거부', () => {
  const S = game(2);
  const k = C(19);
  setup(S, { center: 11, hands: [[C(1)], [k]] });
  assert.equal(R.play(S, 1, k.uid, { basis: 'group' }).ok, false);
  assert.equal(R.draw(S, 1).ok, false);
});

test('무작위 시뮬레이션: 규칙 위반 없이 끝까지 진행 (카드 총량 보존)', () => {
  const AI = require('../shared/ai.js');
  for (let g = 0; g < 200; g++) {
    const n = 2 + (g % 3), mode = g % 2 ? 'hard' : 'easy';
    const S = game(n, mode);
    const total = S.deck.length + S.discard.length + S.players.reduce((a, p) => a + p.hand.length, 0);
    let steps = 0;
    while (!S.over && steps++ < 4000) {
      const level = ['easy', 'normal', 'hard'][(S.turn + g) % 3];
      const a = AI.decide(S, S.turn, level);
      let r;
      if (a.type === 'play') r = R.play(S, S.turn, a.uid, a.opt);
      else if (a.type === 'pass') r = R.pass(S, S.turn);
      else r = R.draw(S, S.turn);
      assert.equal(r.ok, true, 'AI 행동이 규칙 위반: ' + JSON.stringify(a) + ' ' + r.error);
      R.closeOctet(S);
      const now = S.deck.length + S.discard.length + S.players.reduce((x, p) => x + p.hand.length, 0);
      assert.equal(now, total);
    }
    assert.ok(S.over, '게임이 끝나지 않음 (g=' + g + ', n=' + n + ', ' + mode + ')');
  }
});

test('옥텟 창은 다른 사람이 카드를 내도 유지된다', () => {
  const S = game(3);
  const a = C(19), b = C(19), x = C(12);
  setup(S, { center: 11, hands: [[a, b], [x, C(3)], [C(20)]] });
  R.play(S, 0, a.uid, { basis: 'group' });
  assert.deepEqual(S.octet, { pid: 0 });
  R.play(S, 1, x.uid, { basis: 'group' });          // 1번이 Mg(3주기)를 냄 → 창은 그대로
  assert.deepEqual(S.octet, { pid: 0 });
  assert.equal(R.octet(S, 0).ok, true);
});

test('옥텟 창: 시간 제한 없이 유지, 남이 대신 외치면 본인 +2장, 본인이 뽑으면 닫힘', () => {
  const S = game(3);
  const a = C(19), b = C(19), x = C(12);
  setup(S, { center: 11, hands: [[a, b], [x, C(3)], [C(20), C(4)]] });
  R.play(S, 0, a.uid, { basis: 'group' });
  const r = R.catchOctet(S, 2, 0);                  // 3번이 0번의 옥텟을 대신 외침
  assert.equal(r.ok, true);
  assert.equal(S.players[0].hand.length, 3);
  assert.equal(S.octet, null);

  const S2 = game(3);
  const a2 = C(19), b2 = C(19);
  setup(S2, { center: 11, hands: [[a2, b2], [C(12), C(3)], [C(20), C(4)]] });
  R.play(S2, 0, a2.uid, { basis: 'group' });
  R.draw(S2, 1); R.draw(S2, 2);                     // 남들이 행동해도 창은 유지
  assert.deepEqual(S2.octet, { pid: 0 });
  R.draw(S2, 0);                                     // 본인이 뽑으면 닫힘
  assert.equal(S2.octet, null);
});
