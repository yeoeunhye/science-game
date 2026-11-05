(function () {
  const C = window.Cards;
  const E = window.Elements;
  const $ = (id) => document.getElementById(id);

  // 화면 전환
  function show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    $('bg').style.display = id === 'screen-main' ? '' : 'none';
  }
  window.App = { show };

  // 배경: 떠다니는 카드들
  function buildBackground() {
    const bg = $('bg');
    const pool = E.ELEMENTS.slice(0, 20);
    const specials = Object.keys(C.SPECIALS);
    for (let i = 0; i < 16; i++) {
      const spec = i % 5 === 4 ? specials[i % specials.length] : pool[Math.floor(Math.random() * pool.length)];
      const c = C.makeCard(spec, { width: 70 + Math.random() * 60 });
      c.classList.add('float');
      c.style.left = (Math.random() * 100) + '%';
      c.style.top = (Math.random() * 100) + '%';
      c.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');
      c.style.animationDuration = (9 + Math.random() * 9) + 's';
      c.style.animationDelay = (-Math.random() * 12) + 's';
      bg.appendChild(c);
    }
  }

  // 혼자하기 설정
  const setup = { players: 4, mode: 'easy' };
  function buildSeg(id, items, key) {
    const box = $(id);
    box.innerHTML = '';
    items.forEach(([val, label, sub]) => {
      const b = document.createElement('button');
      b.innerHTML = label + (sub ? '<small>' + sub + '</small>' : '');
      if (setup[key] === val) b.classList.add('on');
      b.addEventListener('click', () => {
        setup[key] = val;
        box.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      box.appendChild(b);
    });
  }
  function openSetup() {
    buildSeg('seg-players', [[2, '2명', '나 + AI 1'], [3, '3명', '나 + AI 2'], [4, '4명', '나 + AI 3']], 'players');
    buildSeg('seg-mode', [['easy', '이지', '1~20번 · 74장'], ['hard', '하드', '1~36번 · 86장']], 'mode');
    $('setup').classList.remove('hidden');
  }
  function closeSetup() { $('setup').classList.add('hidden'); }

  // 처음 하는 사람(이 브라우저에서 게임방법을 본 적 없음)은 게임 시작 전에 게임방법을 먼저 보여준다
  function firstTimeGate(fn) {
    let seen = true;
    try { seen = localStorage.getItem('wonso.tutSeen') === '1'; } catch (e) { seen = true; }
    if (seen) fn(); else window.Tutorial.open(fn);
  }

  // 프로필 (닉네임 / 이모티콘)
  const P = window.Profile;
  let pfAvatar = P.get().avatar;
  function renderChip() {
    const me = P.get();
    $('profile-chip').innerHTML = '<span class="av">' + me.avatar + '</span>' + me.name + '<span class="ed">✎</span>';
  }
  function paintGrid() {
    $('pf-av').textContent = pfAvatar;
    const grid = $('pf-grid');
    grid.innerHTML = '';
    P.EMOJIS.forEach((e) => {
      const b = document.createElement('button');
      b.textContent = e;
      if (e === pfAvatar) b.classList.add('on');
      b.addEventListener('click', () => { pfAvatar = e; paintGrid(); });
      grid.appendChild(b);
    });
  }
  function openProfile() {
    const me = P.get();
    pfAvatar = me.avatar;
    $('pf-name').value = me.name;
    paintGrid();
    $('profile').classList.remove('hidden');
    $('pf-name').focus();
  }
  function closeProfile() { $('profile').classList.add('hidden'); }
  function saveProfile() {
    P.set($('pf-name').value, pfAvatar);
    renderChip();
  window.Theme.set(window.Theme.get());
    closeProfile();
    C.toast('프로필을 저장했어요!');
  }
  $('pf-name').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') saveProfile(); });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    if (!b) return;
    switch (b.dataset.action) {
      case 'tutorial': window.Tutorial.open(); break;
      case 'tut-close': window.Tutorial.close(); break;
      case 'table': C.openTable(); break;
      case 'table-close': C.closeTable(); break;
      case 'theme': window.Theme.toggle(); break;
      case 'profile': openProfile(); break;
      case 'profile-close': closeProfile(); break;
      case 'profile-save': saveProfile(); break;
      case 'solo': openSetup(); break;
      case 'setup-close': closeSetup(); break;
      case 'setup-start':
        closeSetup();
        firstTimeGate(() => { show('screen-game'); window.Solo.start({ players: setup.players, mode: setup.mode }); });
        break;
      case 'friends': firstTimeGate(() => window.Mp.open()); break;
      case 'friends-close': window.Mp.close(); break;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { C.closeTable(); window.Tutorial.close(); closeSetup(); closeProfile(); }
  });
  renderChip();

  window.Solo.init(() => show('screen-main'));
  window.Mp.init();
  buildBackground();
  show('screen-main');

  // 자리 비움: 화면을 떠나(다른 앱/화면 꺼짐) 일정 시간 안 돌아오면 게임을 자동으로 종료한다
  const AWAY_MS = window.WONSO_AWAY_MS || 60000;
  let hiddenAt = 0, awayT = null;
  async function endIfAway() {
    const inMp = await window.Mp.away();            // 친구와 하기: 방에서 나감(내 자리는 AI가 이어받음)
    const soloOn = !inMp && $('screen-game').classList.contains('active');
    if (soloOn) { window.Solo.stop(); show('screen-main'); }
    if (inMp || soloOn) C.toast('오래 자리를 비워서 게임을 종료했어요');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      clearTimeout(awayT);
      awayT = setTimeout(endIfAway, AWAY_MS);
    } else {
      clearTimeout(awayT);
      if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) endIfAway();   // 타이머가 멈췄던 경우(폰 절전 등)
      hiddenAt = 0;
    }
  });

  // 초대 링크(?room=ABCD)로 들어오면 바로 입장 창을 연다
  try {
    const code = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (code) { history.replaceState(null, '', location.pathname); firstTimeGate(() => window.Mp.open(code)); }
  } catch (e) { /* ignore */ }
})();
