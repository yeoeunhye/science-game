// 내 닉네임 / 이모티콘 (이 브라우저에 저장)
(function () {
  const KEY = 'wonso.profile';
  const EMOJIS = ['😎', '🦊', '🐼', '🐸', '🐙', '🦁', '🐧', '🐱', '🐶', '🐰', '🦄', '🐯', '🐨', '🐵', '🐲', '🦉',
    '🤖', '👽', '🧑‍🔬', '🧪', '⚛️', '🚀', '🌟', '🔥', '🍀', '🍎', '🎮', '🏆'];
  const DEFAULT = { name: '플레이어', avatar: '😎' };
  let p = { ...DEFAULT };

  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s.name === 'string' && s.name.trim()) p = { name: s.name.trim().slice(0, 8), avatar: EMOJIS.includes(s.avatar) ? s.avatar : DEFAULT.avatar };
  } catch (e) { /* 저장소를 못 쓰면 기본값 사용 */ }

  function set(name, avatar) {
    p = { name: (name || '').trim().slice(0, 8) || DEFAULT.name, avatar: EMOJIS.includes(avatar) ? avatar : DEFAULT.avatar };
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* 무시 */ }
    return get();
  }
  function get() { return { name: p.name, avatar: p.avatar }; }

  window.Profile = { EMOJIS, get, set };
})();
