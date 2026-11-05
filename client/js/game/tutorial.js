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
          '<li>처음에 카드를 <b>7장</b>씩 받아요.</li>' +
          '<li>가운데 카드와 <b>같은 주기</b>이거나 <b>같은 족</b>인 카드를 낼 수 있어요.</li>' +
          '<li>낼 카드가 없으면 더미에서 한 장 <b>드로우</b>!</li>'));
      },
    },
    {
      title: '2. 카드 보는 법',
      render(box) {
        const row = h('div', 'anatomy');
        row.appendChild(C.makeCard(E.byNum[11], { width: 150 }));
        row.appendChild(h('ul', 'legend-list',
          '<li><span class="num">11</span> <b>원자번호</b> (모서리)</li>' +
          '<li><span class="num">Na</span> <b>원소기호</b> (가운데)</li>' +
          '<li><span class="num">나트륨</span> <b>원소이름</b> (아래)</li>'));
        box.appendChild(row);
        const colors = h('div', 'color-row');
        [['metal', 'Na', '금속'], ['nonmetal', 'Cl', '비금속'], ['metalloid', 'Si', '준금속']].forEach(([cat, sym, label]) => {
          const el = E.ELEMENTS.find((x) => x.symbol === sym);
          const item = h('div', 'color-item');
          item.appendChild(C.makeCard(el, { width: 62 }));
          item.appendChild(h('span', 'lg cat-' + cat, label));
          colors.appendChild(item);
        });
        box.appendChild(colors);
        box.appendChild(h('div', 'note warn',
          '<b>주기와 족은 카드에 적혀 있지 않아요!</b><br>' +
          '카드 색은 <b>금속 / 비금속 / 준금속</b> 분류일 뿐, 규칙과는 상관없어요. ' +
          '외워 두거나 <b>주기율표 버튼</b>으로 확인하세요.'));
      },
    },
    {
      title: '3. 주기와 족',
      render(box) {
        box.appendChild(h('p', 'lead',
          '<b>가로줄 = 주기</b> (1~4주기) · <b>세로줄 = 족</b> (1~18족)<br>' +
          '원소마다 "몇 주기 몇 족"이 정해져 있어요.'));
        box.appendChild(C.buildTable({ initial: 11 }));
        box.appendChild(h('div', 'note',
          '<b>외우기 팁</b> · 1족: H Li Na K · 17족: F Cl Br · 18족: He Ne Ar Kr<br>' +
          '같은 줄(가로)에 있으면 같은 주기, 같은 칸(세로)에 있으면 같은 족!'));
      },
    },
    {
      title: '4. 카드 내는 법',
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
      },
    },
    {
      title: '5. 내 차례',
      render(box) {
        box.appendChild(h('p', 'lead', '차례마다 <b>30초</b>! 시간 안에 카드를 내거나 드로우하세요.'));
        const timer = h('div', 'timer-demo',
          '<div class="timer"><div class="bar"></div></div><div class="timer-label">30초</div>');
        box.appendChild(timer);
        box.appendChild(h('ul', 'steps',
          '<li>내 차례에 <b>낼 수 있는 카드는 밝게</b>, 낼 수 없는 카드는 <b>어둡게</b> 보여요. 밝은 카드를 눌러 근거를 고르세요.</li>' +
          '<li>낼 카드가 없으면 <b>드로우 더미</b>를 눌러 한 장 받아요.</li>' +
          '<li>30초가 지나면 <b>자동으로 드로우</b>되고 차례가 넘어가요.</li>' +
          '<li>드로우 더미가 떨어지면 버려진 카드를 <b>섞어서 다시</b> 써요.</li>' +
          '<li>기준은 <b>가운데 카드의 주기와 족</b>이에요. 내 카드가 둘 중 하나만 맞아도 낼 수 있어요.</li>' +
          '<li>특수카드로 <b>새 기준</b>을 정하면, <b>다음 사람은 그 기준에 맞는 카드</b>를 내야 해요. 그 카드를 내면 <b>그 카드의 주기·족</b>이 다시 기준이 돼요.</li>' +
          '<li>예) 2주기로 지정 → 누군가 <b>2주기 4족</b> 카드를 냄 → 다음 사람은 2주기 <b>또는 4족</b>을 낼 수 있어요.</li>'));
        box.appendChild(h('div', 'alert', '철수님 <b>Na(나트륨)</b> 제출! <b>3주기</b>로 인정'));
        box.appendChild(h('div', 'sub small center', '누가 무엇을 냈는지 이렇게 알림으로 알려줘요.'));
      },
    },
    {
      title: '6. 특수카드',
      render(box) {
        const info = {
          noble: '<b>와일드!</b> 언제든 낼 수 있어요. 원하는 <b>주기 또는 족</b>을 새 기준으로 정해요. 다음 사람은 그 기준에 맞는 카드를 내야 해요.',
          covalent: '<b>연속 제출!</b> 낸 뒤 이어서 <b>한 장 더</b> 낼 수 있어요. 낼 카드가 없으면 그냥 차례 종료.',
          ionic: '<b>카드 뺏기!</b> 상대 한 명을 골라 그 사람의 손패에서 <b>무작위 1장</b>을 가져와요.',
          beta: '<b>드로우 2 + 스킵!</b> 다음 사람은 <b>2장</b>을 받고 차례를 건너뛰어요. 베타붕괴나 핵분열로 <b>맞받아치면 쌓여서</b> 그다음 사람에게 넘어가요.',
          fission: '<b>드로우 3 + 스킵 + 기준 지정!</b> 다음 사람은 <b>3장</b>을 받고 건너뛰어요. 새 기준도 정해요. 맞받아치기 가능, 수량은 <b>누적</b>돼요.',
        };
        const counts = E.SPECIAL_COUNTS;
        box.appendChild(h('p', 'lead', '특수카드는 기준과 상관없이 낼 수 있어요. (총 14장)'));
        const list = h('div', 'sp-list');
        Object.keys(C.SPECIALS).forEach((k) => {
          const row = h('div', 'sp-row');
          row.appendChild(C.makeCard(k, { width: 74 }));
          const t = h('div', 'sp-text',
            '<div class="sp-name">' + C.SPECIALS[k].name + ' <small>' + C.SPECIALS[k].sub + ' · ' + counts[k] + '장</small></div>' +
            '<div>' + info[k] + '</div>');
          row.appendChild(t);
          list.appendChild(row);
        });
        box.appendChild(list);
        box.appendChild(h('div', 'note',
          '<b>쌓기 예시</b> · 철수가 베타붕괴(+2) → 영희가 핵분열로 맞받아치면 (+2 +3) = <b>+5</b>장이 다음 사람에게 가요. 맞받아칠 카드가 없으면 더미를 눌러 쌓인 장수를 받고 차례를 건너뛰어요.'));
      },
    },
    {
      title: '7. 옥텟! 그리고 승리',
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
          '<li>1장이 된 사람이 외치기 전에 <b>다른 사람이 먼저 대신 외쳐주면</b> → 그 사람은 카드 <b>2장 패널티</b>!</li>' +
          '<li>옥텟 버튼은 <b>항상 보여요</b>(내린 카드 더미 왼쪽). 시간 제한은 없고, 본인이 다시 카드를 내거나 뽑기 전까지 누를 수 있어요.</li>' +
          '<li>아무도 1장이 아닐 때 <b>잘못 누르면</b> → 누른 사람이 카드 <b>1장 패널티</b>!</li>' +
          '<li>카드는 <b>끌어서</b> 가운데로 내도 돼요. 손패는 <b>정렬</b> 버튼으로 주기별·족별로 정리할 수 있어요.</li>' +
          '<li>손패를 <b>0장</b>으로 만들면 승리!</li>' +
          '<li>플레이할수록 주기율표가 눈에 익어요. 한 판 더!</li>'));
        box.appendChild(h('div', 'note',
          '<b>기억하세요</b> — 낼 때마다 "이 원소는 몇 주기 몇 족?"을 확인하는 게 곧 공부! ' +
          '판이 끝나면 이번 판에 나온 원소를 복습해 줘요.'));
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
