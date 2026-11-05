// 카드 / 주기율표 컴포넌트 (게임 보드에서도 재사용)
(function () {
  const E = window.Elements;

  const SPECIALS = {
    noble:    { name: '비활성기체', sub: '와일드',     icon: '8e⁻',
      how: '언제든 낼 수 있어요. 다음 기준(<b>주기 또는 족</b>)을 내가 정해요.',
      sci: '비활성기체는 반응성이 거의 없고 다른 원소와 쉽게 결합하지 않는 안정한 원소예요. 그래서 매칭 규칙에 얽매이지 않는 와일드카드로, 반응 조건의 영향을 받지 않는 "규칙을 새로 정하는 자유"로 표현했어요.' },
    covalent: { name: '공유결합',   sub: '연속 제출',   icon: 'A:A',
      how: '내고 나서 조건에 맞는 카드가 또 있으면 <b>이어서 한 장 더</b> 낼 수 있어요.',
      sci: '공유결합은 두 원자가 전자를 서로 <b>공유</b>하며 결합이 이어지는 현상이에요. 결합이 계속 이어지는 모습을 "연속 제출"로 나타냈어요.' },
    ionic:    { name: '이온결합',   sub: '카드 뺏기',   icon: '+/−',
      how: '상대 한 명을 골라 그 사람의 손패에서 <b>무작위 1장</b>을 가져와요.',
      sci: '이온결합은 한 원자가 다른 원자의 <b>전자를 빼앗거나 주고받으며</b> 결합하는 현상이에요. 전자를 가져오는 상호작용을 카드를 가져오는 효과로 연결했어요.' },
    beta:     { name: '베타붕괴',   sub: '+2장 · 스킵', icon: 'β',
      how: '다음 사람이 <b>2장</b>을 받고 차례를 건너뛰어요. 베타붕괴·핵분열로 맞받으면 장수가 쌓여요.',
      sci: '베타붕괴는 원자핵 안의 중성자가 양성자로 바뀌며 전자(β선)를 내놓아 <b>원소가 다른 원소로 바뀌는</b> 현상이에요. 원소가 변하는 과정을 상대에게 불이익을 주는 효과로 표현했어요.' },
    fission:  { name: '핵분열',     sub: '+3장 · 스킵', icon: '☢',
      how: '다음 사람이 <b>3장</b>을 받고 건너뛰어요. 내가 <b>새 기준</b>(주기 또는 족)도 정해요. 맞받아치기 가능, 장수는 누적!',
      sci: '핵분열은 원자핵이 쪼개지며 <b>큰 에너지</b>를 내놓는 현상이에요. 베타붕괴보다 훨씬 큰 파급력을 반영해서 더 강한 효과(3장)와 추가 권한(기준 지정)을 줬어요.' },
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

  // 특수카드 설명 목록 (게임방법·게임 중 "특수카드" 버튼에서 같이 사용)
  function specialList(opts) {
    opts = opts || {};
    const E = window.Elements, list = h('div', 'sp-list');
    Object.keys(SPECIALS).forEach((k) => {
      const s = SPECIALS[k], row = h('div', 'sp-row');
      row.appendChild(makeCard(k, { width: opts.width || 74 }));
      row.appendChild(h('div', 'sp-text',
        '<div class="sp-name">' + s.name + ' <small>' + s.sub + ' · ' + E.SPECIAL_COUNTS[k] + '장</small></div>' +
        '<div>' + s.how + '</div>' +
        '<div class="sp-sci"><span>과학 연결</span>' + s.sci + '</div>'));
      list.appendChild(row);
    });
    return list;
  }
  function openSpecials() {
    const body = document.getElementById('spmodal-body');
    body.innerHTML = '';
    body.appendChild(h('p', 'lead', '특수카드는 <b>기준과 상관없이</b> 낼 수 있어요.'));
    body.appendChild(specialList({ width: 70 }));
    body.appendChild(h('div', 'sp-sci oct', '<span>옥텟!</span>손패가 2장에서 <b>1장</b>이 되는 순간 "옥텟!"을 외쳐야 해요. 원자는 바깥 전자가 <b>8개(옥텟)</b>를 채우면 안정해지는데, 손패가 거의 비어 안정(승리)에 가까워지는 순간을 여기에 빗댔어요.'));
    document.getElementById('spmodal').classList.remove('hidden');
  }
  function closeSpecials() { document.getElementById('spmodal').classList.add('hidden'); }

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

  window.Cards = { SPECIALS, h, makeCard, makeBack, buildTable, openTable, closeTable, specialList, openSpecials, closeSpecials, toast };
})();
