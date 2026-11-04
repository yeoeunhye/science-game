// 컨트롤러(solo.js) 흐름 검증: 가짜 UI + 자동 사람 플레이어로 전체 게임을 시간 압축해서 돌려본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCALE = 0.004;                                   // 시간 압축 (30초 → 0.12초)
function runGame({ players, mode, humanSkill }) {
  return new Promise((resolve, reject) => {
    const timers = new Set();
    const st = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, Math.max(0, (ms || 0) * SCALE)); timers.add(t); return t; };
    const si = (fn, ms) => { const t = setInterval(fn, Math.max(1, (ms || 0) * SCALE)); timers.add(t); return t; };

    const log = { notifies: [], renders: 0, results: [] };
    let H = null, lastView = null, acting = false;
    const Elements = require('../shared/elements.js'), Rules = require('../shared/rules.js'), AI = require('../shared/ai.js');

    const Board = {
      mount(_, h) { H = h; }, setHandlers(h) { H = h; }, resetHandMemory() {}, hideResult() {}, setBonus() {}, setTimer() {}, closePopups() {},
      isPopupOpen: () => false, shakeCard() {}, splash() {}, seatRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
      flyPlay: () => Promise.resolve(), flyDraw: () => Promise.resolve(),
      notify(html, kind) { log.notifies.push({ html, kind }); },
      setOctet(on) { if (on && Math.random() < 0.7) st(() => H.onOctet(), 400); },
      openBasis: (el, crit) => Promise.resolve(Elements.validBasis(el, crit)[0] || null),
      pickCriterion: () => Promise.resolve({ period: 1 + Math.floor(Math.random() * 4) }),
      pickTarget: (list) => Promise.resolve(list[0].id),
      showResult(r) { log.results.push(r); clearAll(); clearTimeout(guard); resolve(log); },
      render(v) { lastView = v; log.renders++; schedule(); },
    };
    function clearAll() { timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers.clear(); }
    function schedule() {
      if (acting || !lastView || lastView.over || lastView.turn !== 0) return;
      acting = true;
      st(() => {
        acting = false;
        const v = lastView;
        if (!v || v.over || v.turn !== 0) return;
        const ok = v.hand.filter((c) => (v.playable ? v.playable.has(c.uid) : true));
        if (v.bonus) { if (ok.length && Math.random() < 0.5) H.onCard(ok[0].uid, {}); else H.onPass(); return; }
        const choice = v.playable ? ok[0] : v.hand.find((c) => c.kind === 'el' || true);
        if (choice && (humanSkill !== 'draw-only')) H.onCard(choice.uid, {}); else H.onDraw();
        // 낼 수 없으면 뽑기
        st(() => { if (lastView && lastView.turn === 0 && !lastView.over) { const pl = lastView.playable; if (!pl || pl.size === 0) H.onDraw(); } }, 600);
      }, 300);
    }

    const sandbox = {
      window: null, document: { getElementById: () => ({}) }, console, Math, Date, Set, Promise, JSON,
      setTimeout: st, setInterval: si, clearTimeout, clearInterval,
    };
    sandbox.window = sandbox;
    Object.assign(sandbox, { Elements, Rules, AI, Board, Cards: { SPECIALS: { noble: { name: '비활성기체' }, covalent: { name: '공유결합' }, ionic: { name: '이온결합' }, beta: { name: '베타붕괴' }, fission: { name: '핵분열' } }, toast() {} },
      Profile: { get: () => ({ name: '나', avatar: '😎' }) } });
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../client/js/solo.js'), 'utf8'), sandbox);
    sandbox.Solo.init(() => {});
    sandbox.Solo.start({ players, mode });
    const guard = setTimeout(() => { clearAll(); reject(new Error('시간 초과: 게임이 끝나지 않음 (' + [players, mode].join(',') + ')')); }, 20000);
  });
}

test('컨트롤러: 2/3/4인 · 이지/하드에서 게임이 끝까지 진행된다', async () => {
  const combos = [];
  for (const players of [2, 3, 4]) for (const mode of ['easy', 'hard']) combos.push({ players, mode });
  for (const c of combos) {
    const log = await runGame(c);
    assert.equal(log.results.length, 1);
    assert.ok(log.notifies.length > 5, '진행 알림이 있어야 함');
  }
});
