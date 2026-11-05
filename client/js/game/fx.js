// 효과음(WebAudio 합성, 파일 없음) · 진동 · 특수카드 연출. 소리는 기본 켜짐, 버튼으로 끄고 켤 수 있고 브라우저에 저장.
(function () {
  const KEY = 'wonso.mute';
  let muted = false, ctx = null, master = null;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* 저장소 불가 */ }

  function ac() {
    if (ctx) return ctx;
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    try { ctx = new A(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); } catch (e) { ctx = null; }
    return ctx;
  }
  // 첫 사용자 입력에서 오디오를 깨운다(브라우저 자동재생 정책)
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { const c = ac(); if (c && c.state === 'suspended') c.resume(); }, { passive: true }));

  // 음 하나: 주파수, 시작 지연(초), 길이(초), 음량, 파형
  function tone(f, at, dur, vol, type, slideTo) {
    const c = ac(); if (!c || muted) return;
    const t0 = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G4: 392, E4: 329.63, C4: 261.63 };

  const SOUNDS = {
    play:   () => { tone(520, 0, 0.09, 0.16, 'triangle', 340); },
    draw:   () => { tone(300, 0, 0.07, 0.12, 'triangle', 420); },
    turn:   () => { tone(N.E5, 0, 0.12, 0.13, 'sine'); tone(N.A5, 0.09, 0.16, 0.13, 'sine'); },
    warn:   () => { tone(220, 0, 0.18, 0.15, 'sawtooth', 150); },
    good:   () => { tone(N.G5, 0, 0.1, 0.13, 'sine'); tone(N.C6, 0.08, 0.16, 0.13, 'sine'); },
    err:    () => { tone(180, 0, 0.12, 0.14, 'square', 130); },
    tick:   () => { tone(900, 0, 0.04, 0.08, 'square'); },
    noble:  () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.06, 0.2, 0.12, 'sine')); },
    covalent: () => { tone(N.E5, 0, 0.14, 0.14, 'triangle'); tone(N.E5 * 1.5, 0.02, 0.14, 0.1, 'triangle'); },
    ionic:  () => { tone(700, 0, 0.12, 0.13, 'triangle', 1100); tone(1100, 0.1, 0.14, 0.11, 'triangle', 600); },
    beta:   () => { tone(520, 0, 0.3, 0.15, 'sawtooth', 120); },
    fission:() => { tone(90, 0, 0.5, 0.25, 'sawtooth', 40); tone(1200, 0, 0.35, 0.08, 'square', 200); },
    win:    () => { [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, i * 0.11, 0.3, 0.15, 'triangle')); },
    lose:   () => { [N.G4, N.E4, N.C4].forEach((f, i) => tone(f, i * 0.18, 0.4, 0.14, 'sine')); },
  };
  function snd(name) { if (muted) return; const f = SOUNDS[name]; if (f) { try { f(); } catch (e) { /* 소리 실패는 무시 */ } } }
  function vib(p) { if (!muted && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* 무시 */ } } }

  function syncBtn() {
    const b = document.getElementById('snd-btn'); if (!b) return;
    b.classList.toggle('off', muted);
    b.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
    b.title = muted ? '소리 켜기' : '소리 끄기';
  }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* 무시 */ }
    syncBtn();
    if (!muted) { const c = ac(); if (c && c.state === 'suspended') c.resume(); snd('good'); }
  }

  /* ---------- 특수카드 연출: 화면 중앙에 이름이 커졌다 사라진다 (깜빡임 없음) ---------- */
  const SP_FX = {
    noble:    { title: '비활성기체', sub: '새 기준을 정해요', cls: 'fx-noble' },
    covalent: { title: '공유결합',   sub: '한 장 더 낼 수 있어요', cls: 'fx-covalent' },
    ionic:    { title: '이온결합',   sub: '상대 카드를 뺏어요', cls: 'fx-ionic' },
    beta:     { title: '베타붕괴',   sub: '공격 +2장', cls: 'fx-beta' },
    fission:  { title: '핵분열',     sub: '공격 +3장', cls: 'fx-fission' },
  };
  function special(key, who) {
    const d = SP_FX[key]; if (!d) return;
    snd(key); if (key === 'beta' || key === 'fission') vib([30, 40, 60]);
    const host = document.getElementById('screen-game'); if (!host) return;
    host.querySelectorAll('.sp-banner').forEach((n) => n.remove());
    const n = document.createElement('div');
    n.className = 'sp-banner ' + d.cls;
    n.innerHTML = '<b>' + d.title + '</b><span>' + (who ? who + ' · ' : '') + d.sub + '</span>';
    host.appendChild(n);
    setTimeout(() => n.remove(), 1500);
  }

  function init() {
    syncBtn();
    const b = document.getElementById('snd-btn');
    if (b) b.addEventListener('click', () => setMuted(!muted));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Fx = { snd, vib, special, isMuted: () => muted, setMuted };
})();
