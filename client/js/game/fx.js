// 효과음(WebAudio 합성, 파일 없음) · 진동 · 특수카드 연출. 소리는 기본 켜짐, 버튼으로 끄고 켤 수 있고 브라우저에 저장.
(function () {
  const KEY = 'wonso.mute';
  let muted = false, ctx = null, master = null;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* 저장소 불가 */ }

  function ac() {
    if (ctx) return ctx;
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    try { ctx = new A(); master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination); } catch (e) { ctx = null; }
    return ctx;
  }
  // 첫 사용자 입력에서 오디오를 깨운다(브라우저 자동재생 정책)
  // 오디오는 '사용자가 누른 순간'에 만들고 깨워야 소리가 난다(안 그러면 잠긴 채로 무음). 눌러진 직후 한 번 짧게 확인음도 낸다.
  let primed = false;
  function unlock() {
    const c = ac(); if (!c) return;
    const go = () => { if (!primed) { primed = true; tone(1, 0, 0.01, 0.0002, 'sine'); } };
    if (c.state === 'suspended') c.resume().then(go, () => {}); else go();
  }
  ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));

  // 음 하나: 주파수, 시작 지연(초), 길이(초), 음량, 파형
  function tone(f, at, dur, vol, type, slideTo) {
    const c = ac(); if (!c || muted) return;
    const t0 = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.min(0.7, (vol || 0.2) * 2.4), t0 + 0.012);   // 기존보다 약 8dB 크게
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
    octetOpen: () => { [880, 880, 1175].forEach((f, i) => tone(f, i * 0.13, 0.11, 0.2, 'square')); },
    octetOk: () => { [N.C5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.07, 0.25, 0.16, 'triangle')); tone(N.E6, 0.22, 0.4, 0.12, 'sine'); },
    catchHit: () => { tone(900, 0, 0.18, 0.2, 'sawtooth', 120); tone(120, 0.12, 0.3, 0.25, 'square', 60); },
    tap:    () => { tone(660, 0, 0.05, 0.07, 'sine', 520); },
    tick:   () => { tone(900, 0, 0.04, 0.08, 'square'); },
    noble:  () => { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.06, 0.2, 0.12, 'sine')); },
    covalent: () => { tone(N.E5, 0, 0.14, 0.14, 'triangle'); tone(N.E5 * 1.5, 0.02, 0.14, 0.1, 'triangle'); },
    ionic:  () => { tone(700, 0, 0.12, 0.13, 'triangle', 1100); tone(1100, 0.1, 0.14, 0.11, 'triangle', 600); },
    beta:   () => { tone(520, 0, 0.3, 0.15, 'sawtooth', 120); },
    fission:() => { tone(90, 0, 0.5, 0.25, 'sawtooth', 40); tone(1200, 0, 0.35, 0.08, 'square', 200); },
    win:    () => { [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, i * 0.11, 0.3, 0.15, 'triangle')); },
    lose:   () => { [N.G4, N.E4, N.C4].forEach((f, i) => tone(f, i * 0.18, 0.4, 0.14, 'sine')); },
  };
  function snd(name) { if (muted) return; if (ctx && ctx.state === 'suspended') ctx.resume(); const f = SOUNDS[name]; if (f) { try { f(); } catch (e) { /* 소리 실패는 무시 */ } } }
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
    if (!muted) { unlock(); setTimeout(() => snd('good'), 60); }
  }

  /* ---------- 크고 강렬한 연출: 특수카드 · 옥텟 ----------
     화면을 가로지르는 색 띠 + 돌아가는 빛살 + 큰 아이콘/이름이 쾅 하고 나타난다. 공격은 화면이 흔들린다. 깜빡임·그림자 없음. */
  const BIG = {
    noble:    { icon: '8e⁻', title: '비활성기체', sub: '새 기준을 정해요', color: '#4a5fc4' },
    covalent: { icon: 'A:A', title: '공유결합',   sub: '한 장 더 낼 수 있어요', color: '#1f8f82' },
    ionic:    { icon: '+/−', title: '이온결합',   sub: '상대 카드를 뺏어요', color: '#8f5fc4' },
    beta:     { icon: 'β',   title: '베타붕괴',   sub: '다음 사람 +2장 · 건너뛰기', color: '#e0573d', shake: 1 },
    fission:  { icon: '☢',   title: '핵분열',     sub: '다음 사람 +3장 · 건너뛰기', color: '#c0281f', shake: 2 },
    octetOpen:{ icon: '1',   title: '옥텟?!',     sub: '손패 1장! 버튼을 눌러요', color: '#f5a524', dark: 1, long: 1 },
    octet:    { icon: '8',   title: '옥텟!',      sub: '안전하게 외쳤어요', color: '#1fa467' },
    catch:    { icon: '!',   title: '지적 성공!', sub: '패널티 적용', color: '#e23b45', shake: 1 },
  };
  function big(key, who, subOverride) {
    const d = BIG[key]; if (!d) return;
    const host = document.getElementById('screen-game'); if (!host) return;
    host.querySelectorAll('.big-fx').forEach((n) => n.remove());
    const n = document.createElement('div');
    n.className = 'big-fx' + (d.dark ? ' dark' : '') + (d.long ? ' long' : '');
    n.style.setProperty('--bc', d.color);
    n.innerHTML = '<i class="bf-wash"></i><i class="bf-rays"></i>' +
      '<div class="bf-band"><span class="bf-icon">' + d.icon + '</span>' +
      '<div class="bf-text"><b>' + d.title + '</b><small>' + (who ? '<em>' + who + '</em> ' : '') + (subOverride || d.sub) + '</small></div></div>';
    host.appendChild(n);
    if (d.shake) { host.classList.remove('shake1', 'shake2'); void host.offsetWidth; host.classList.add('shake' + d.shake); setTimeout(() => host.classList.remove('shake1', 'shake2'), 700); }
    setTimeout(() => n.remove(), d.long ? 1500 : 1900);
  }
  function special(key, who) {
    const plain = who ? String(who).replace(/<[^>]+>/g, '') : '';
    snd(key); if (key === 'beta' || key === 'fission') vib([40, 40, 90]); else vib(30);
    big(key, plain);
  }
  function octetEvent(kind, who, sub) {
    const plain = who ? String(who).replace(/<[^>]+>/g, '') : '';
    snd(kind === 'octetOpen' ? 'octetOpen' : kind === 'catch' ? 'catchHit' : 'octetOk');
    vib(kind === 'catch' ? [60, 40, 90] : 40);
    big(kind, plain, sub);
  }

  function init() {
    syncBtn();
    const b = document.getElementById('snd-btn');
    if (b) b.addEventListener('click', () => setMuted(!muted));
    // 버튼을 누르면 가벼운 소리(소리 버튼 자신은 제외)
    document.addEventListener('click', (ev) => { const t = ev.target.closest && ev.target.closest('button'); if (t && t.id !== 'snd-btn') snd('tap'); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.Fx = { big, octetEvent, state: () => (ctx ? ctx.state + ":" + ctx.currentTime.toFixed(2) : "none"), snd, vib, special, isMuted: () => muted, setMuted };
})();
