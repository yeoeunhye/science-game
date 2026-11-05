// 게임방법보기: 전체 진행 + 특수카드 설명 (단계별)
(function () {
  const C = window.Cards;
  const E = window.Elements;
  const h = C.h;

  const slides = [
    {
      title: '1. 게임 목표',
      render(box) {
        box.innerHTML =
          '<p class="lead">손패를 <b>가장 먼저 모두 내는 사람</b>이 승리! (2~4명)</p>';
        const fan = h('div', 'fan');
        [1, 8, 11, 17, 20].forEach((n, i) => {
          const c = C.makeCard(E.byNum[n], { width: 84 });
          c.style.transform = 'rotate(' + (i - 2) * 9 + 'deg) translateY(' + Math.abs(i - 2) * 6 + 'px)';
          fan.appendChild(c);
        });
        box.appendChild(fan);
        box.appendChild(h('ul', 'steps',
          '<li>카드를 <b>7장</b>씩 받고 시작해요.</li>' +
          '<li>가운데 카드와 <b>같은 주기</b>거나 <b>같은 족</b>이면 낼 수 있어요.</li>' +
          '<li>낼 카드가 없으면 더미에서 <b>한 장 뽑아요</b>.</li>'));
      },
    },
    {
      title: '2. 주기와 족',
      render(box) {
        box.appendChild(h('p', 'lead',
          '<b>가로줄 = 주기</b> (1~4주기) · <b>세로줄 = 족</b> (1~18족)<br>' +
          '원소마다 "몇 주기 몇 족"이 정해져 있어요.'));
        box.appendChild(C.buildTable({ initial: 11 }));
        box.appendChild(h('div', 'note warn',
          '카드에는 번호·기호·이름만 있고 <b>주기와 족은 적혀 있지 않아요.</b> 외워 두거나 <b>주기율표 버튼</b>으로 확인하세요.'));
      },
    },
    {
      title: '3. 카드 내는 법',
      render(box) {
        box.appendChild(h('p', 'lead', '직접 해 볼까요? 가운데 카드는 <b>Na(나트륨)</b>이에요. 손패의 카드를 눌러 보세요!'));
        const center = E.byNum[11];
        const table = h('div', 'demo-table');
        const pile = h('div', 'demo-center');
        pile.appendChild(C.makeCard(center, { width: 104 }));
        pile.appendChild(h('div', 'cap', '가운데 카드'));
        table.appendChild(pile);
        const panel = h('div', 'demo-panel');
        table.appendChild(panel);
        box.appendChild(table);

        const hand = h('div', 'demo-hand');
        [11, 19, 12, 8].forEach((n) => {
          const el = E.byNum[n];
          const c = C.makeCard(el, { width: 82 });
          c.classList.add('clickable');
          c.addEventListener('click', () => choose(el));
          hand.appendChild(c);
        });
        box.appendChild(hand);
        const tools = h('div', 'demo-tools');
        const tb = h('button', 'btn btn-sm btn-ghost', '주기율표 열기');
        tb.addEventListener('click', C.openTable);
        tools.appendChild(tb);
        box.appendChild(tools);

        function reset() {
          panel.innerHTML = '<div class="hint">← 카드를 누르면 <b>"낼 수 있는 근거"</b>가 나타나요.<br>' +
            '모르겠으면 주기율표를 열어 Na가 몇 주기 몇 족인지 먼저 확인!</div>';
        }
        function choose(el) {
          const reasons = E.validBasis(el, center);
          panel.innerHTML = '';
          panel.appendChild(h('div', 'q', '<b>' + el.symbol + '(' + el.name + ')</b>를 낼까요?'));
          if (!reasons.length) {
            panel.appendChild(h('div', 'none',
              '낼 수 있는 근거가 없어요.<br>' + el.symbol + '는 ' + el.period + '주기 ' + el.group + '족이라 ' +
              'Na(3주기 1족)와 겹치지 않아요. → 드로우!'));
            addReset();
            return;
          }
          panel.appendChild(h('div', 'sub', '지금 <b>실제로 유효한 근거</b>만 보여요. 하나를 골라요:'));
          const list = h('div', 'basis');
          reasons.forEach((r) => {
            const b = h('button', 'btn btn-sm ' + (r.type === 'period' ? 'btn-period' : 'btn-group'), r.label + '로 인정');
            b.addEventListener('click', () => {
              panel.innerHTML = '';
              panel.appendChild(h('div', 'alert',
                '철수님 <b>' + el.symbol + '(' + el.name + ')</b> 제출! <b>' + r.label + '</b>로 인정'));
              panel.appendChild(h('div', 'sub',
                el.symbol + '는 ' + el.period + '주기 ' + el.group + '족. Na와 ' +
                (r.type === 'period' ? '같은 ' + r.label : '같은 ' + r.label) + '라서 낼 수 있어요.'));
              addReset();
            });
            list.appendChild(b);
          });
          panel.appendChild(list);
          if (reasons.length === 2) {
            panel.appendChild(h('div', 'sub small', '👉 같은 원소는 <b>주기와 족이 모두</b> 같아서 선택지가 2개예요!'));
          }
        }
        function addReset() {
          const b = h('button', 'btn btn-sm btn-ghost', '다시 해보기');
          b.addEventListener('click', reset);
          panel.appendChild(b);
        }
        reset();
        box.appendChild(h('div', 'note',
          '실제 게임에서는 <b>밝은 카드</b>만 낼 수 있어요. 누르거나 <b>끌어서</b> 내고, <b>30초</b> 안에 못 내면 자동으로 뽑아요.'));
      },
    },
    {
      title: '4. 특수카드',
      render(box) {
        box.appendChild(h('p', 'lead', '특수카드는 <b>기준과 상관없이</b> 낼 수 있어요. 화학·물리 개념에서 따왔어요.'));
        box.appendChild(C.specialList({ width: 66 }));
        box.appendChild(h('div', 'note', '게임 중에도 위쪽 <b>특수카드</b> 버튼으로 언제든 다시 볼 수 있어요.'));
      },
    },
    {
      title: '5. 옥텟! 그리고 승리',
      render(box) {
        box.appendChild(h('p', 'lead', '손패가 <b>2장 → 1장</b>이 되는 순간, 반드시 <b>"옥텟!"</b>을 외쳐요.'));
        const row = h('div', 'octet-demo');
        const hand = h('div', 'demo-hand');
        [3, 17].forEach((n, i) => {
          const c = C.makeCard(E.byNum[n], { width: 78 });
          if (i === 1) c.classList.add('gone');
          hand.appendChild(c);
        });
        row.appendChild(hand);
        row.appendChild(h('div', 'octet-btn', '옥텟!'));
        box.appendChild(row);
        box.appendChild(h('ul', 'steps',
          '<li>1장이 된 사람이 외치기 전에 <b>다른 사람이 먼저 누르면</b> 그 사람은 카드 <b>2장 패널티</b>!</li>' +
          '<li>버튼은 <b>연타하면 10초 동안 잠겨요</b>.</li>' +
          '<li>손패를 <b>0장</b>으로 만들면 승리!</li>'));
        box.appendChild(h('div', 'sp-sci oct', '<span>과학 연결</span>원자는 바깥 전자가 <b>8개(옥텟)</b>를 채우면 안정해져요. 손패가 거의 비어 안정(승리)에 가까워지는 순간에 "옥텟!"을 외치는 규칙으로 표현했어요.'));
      },
    },
  ];

  let idx = 0;
  const $ = (id) => document.getElementById(id);

  function render() {
    const s = slides[idx];
    $('tut-title').textContent = s.title;
    const body = $('tut-body');
    body.innerHTML = '';
    body.scrollTop = 0;
    s.render(body);
    const dots = $('tut-dots');
    dots.innerHTML = '';
    slides.forEach((_, i) => {
      const d = h('button', 'dot' + (i === idx ? ' on' : ''));
      d.setAttribute('aria-label', (i + 1) + '단계');
      d.addEventListener('click', () => { idx = i; render(); });
      dots.appendChild(d);
    });
    $('tut-prev').style.visibility = idx === 0 ? 'hidden' : 'visible';
    const last = idx === slides.length - 1;
    $('tut-next').textContent = last ? (onDone ? '게임 시작 ▶' : '완료 ✔') : '다음 ▶';
  }

  $('tut-prev').addEventListener('click', () => { if (idx > 0) { idx--; render(); } });
  $('tut-next').addEventListener('click', () => {
    if (idx < slides.length - 1) { idx++; render(); } else close();
  });

  // 닫힐 때 callback 이 있으면 실행한다 (처음 하는 사람: 설명을 본 뒤 게임 시작)
  let onDone = null;
  function open(cb) {
    onDone = typeof cb === 'function' ? cb : null;
    try { localStorage.setItem('wonso.tutSeen', '1'); } catch (e) { /* ignore */ }
    idx = 0; render(); $('tutorial').classList.remove('hidden');
  }
  function close() {
    const was = !$('tutorial').classList.contains('hidden');
    $('tutorial').classList.add('hidden');
    if (was && onDone) { const cb = onDone; onDone = null; cb(); }
  }

  window.Tutorial = { open, close };
})();
