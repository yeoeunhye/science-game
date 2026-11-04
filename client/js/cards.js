// 카드 / 주기율표 컴포넌트 (게임 보드에서도 재사용)
(function () {
  const E = window.Elements;

  const SPECIALS = {
    noble:    { name: '비활성기체', sub: '와일드',     icon: '8e⁻' },
    covalent: { name: '공유결합',   sub: '연속 제출',   icon: 'A:A' },
    ionic:    { name: '이온결합',   sub: '카드 뺏기',   icon: '+/−' },
    beta:     { name: '베타붕괴',   sub: '+2장 · 스킵', icon: 'β' },
    fission:  { name: '핵분열',     sub: '+3장 · 스킵', icon: '☢' },
  };

  function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  // spec: 원소 객체(num 있음) 또는 문자열(특수카드 key). opts.width: px
  function makeCard(spec, opts) {
    opts = opts || {};
    let card;
    if (typeof spec === 'string') {
      const s = SPECIALS[spec];
      card = h('div', 'card special sp-' + spec);
      card.innerHTML =
        '<span class="corner tl">' + s.icon + '</span>' +
        '<div class="oval"><span class="sym">' + s.icon + '</span></div>' +
        '<span class="nm">' + s.name + '</span>' +
        '<span class="corner br">' + s.icon + '</span>';
      card.dataset.special = spec;
    } else {
      card = h('div', 'card cat-' + spec.cat);
      card.innerHTML =
        '<span class="corner tl">' + spec.num + '</span>' +
        '<div class="oval"><span class="sym">' + spec.symbol + '</span></div>' +
        '<span class="nm">' + spec.name + '</span>' +
        '<span class="corner br">' + spec.num + '</span>';
      card.dataset.num = spec.num;
    }
    if (opts.width) card.style.setProperty('--cw', opts.width + 'px');
    return card;
  }

  function makeBack(opts) {
    opts = opts || {};
    const c = h('div', 'card back', '<div class="oval"><span class="sym">원소</span></div>');
    if (opts.width) c.style.setProperty('--cw', opts.width + 'px');
    return c;
  }

  // 주기율표 (1~36번). 칸을 누르면 같은 주기(가로) + 같은 족(세로)이 강조됨.
  function buildTable(opts) {
    opts = opts || {};
    const wrap = h('div', 'ptable-wrap');
    const grid = h('div', 'ptable');
    const cells = [];

    grid.appendChild(h('div', 'pt-corner', '족→<br>주기↓'));
    for (let g = 1; g <= 18; g++) {
      const hd = h('div', 'pt-head', String(g));
      hd.dataset.group = g;
      grid.appendChild(hd);
    }
    for (let p = 1; p <= 4; p++) {
      const rh = h('div', 'pt-head side', String(p));
      rh.dataset.period = p;
      grid.appendChild(rh);
      for (let g = 1; g <= 18; g++) {
        const el = E.ELEMENTS.find((x) => x.period === p && x.group === g);
        if (el) {
          const c = h('button', 'pt-cell cat-' + el.cat,
            '<small>' + el.num + '</small><b>' + el.symbol + '</b>');
          c.dataset.num = el.num;
          c.title = el.name;
          c.addEventListener('click', () => select(el));
          grid.appendChild(c);
          cells.push(c);
        } else {
          grid.appendChild(h('div', 'pt-empty'));
        }
      }
    }
    wrap.appendChild(grid);

    const info = h('div', 'pt-info', '칸을 눌러 보세요! 가로줄이 <b>주기</b>, 세로줄이 <b>족</b>이에요.');
    wrap.appendChild(info);

    const legend = h('div', 'legend');
    Object.keys(E.CAT_LABEL).forEach((k) => {
      legend.appendChild(h('span', 'lg cat-' + k, E.CAT_LABEL[k]));
    });
    wrap.appendChild(legend);

    function select(el) {
      grid.querySelectorAll('.hl-p,.hl-g,.sel').forEach((n) => n.classList.remove('hl-p', 'hl-g', 'sel'));
      cells.forEach((c) => {
        const o = E.byNum[c.dataset.num];
        if (o.period === el.period) c.classList.add('hl-p');
        if (o.group === el.group) c.classList.add('hl-g');
        if (o === el) c.classList.add('sel');
      });
      grid.querySelectorAll('.pt-head').forEach((n) => {
        if (n.dataset.period == el.period || n.dataset.group == el.group) n.classList.add('hl-g');
      });
      info.innerHTML = '<b>' + el.symbol + '(' + el.name + ')</b> · 원자번호 ' + el.num +
        ' → <span class="tag p">' + el.period + '주기</span> <span class="tag g">' + el.group + '족</span>';
      if (opts.onSelect) opts.onSelect(el);
    }
    if (opts.initial) select(E.byNum[opts.initial]);
    return wrap;
  }

  function openTable() {
    const m = document.getElementById('tablemodal');
    const body = document.getElementById('tablemodal-body');
    body.innerHTML = '';
    body.appendChild(buildTable());
    m.classList.remove('hidden');
  }
  function closeTable() { document.getElementById('tablemodal').classList.add('hidden'); }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  window.Cards = { SPECIALS, h, makeCard, makeBack, buildTable, openTable, closeTable, toast };
})();
