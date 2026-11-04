// 다크 / 라이트 모드. 첫 페인트 전에 적용(깜빡임 방지)하고 선택은 이 브라우저에 저장.
(function () {
  const KEY = 'wonso.theme';
  let theme = 'dark';
  try { const s = localStorage.getItem(KEY); if (s === 'light' || s === 'dark') theme = s; } catch (e) { /* 저장소 불가 시 기본값 */ }
  document.documentElement.dataset.theme = theme;

  function set(t) {
    theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch (e) { /* 무시 */ }
    const btn = document.getElementById('theme-btn');
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
  }
  window.Theme = { get: () => theme, set, toggle: () => set(theme === 'dark' ? 'light' : 'dark') };
})();
