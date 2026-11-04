// 원소 데이터 (1~36번) + 유효 근거 계산. 브라우저/Node 양쪽에서 사용.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Elements = factory();
})(this, function () {
  // [원자번호, 기호, 이름, 주기, 족]
  const RAW = [
    [1, 'H', '수소', 1, 1], [2, 'He', '헬륨', 1, 18],
    [3, 'Li', '리튬', 2, 1], [4, 'Be', '베릴륨', 2, 2], [5, 'B', '붕소', 2, 13],
    [6, 'C', '탄소', 2, 14], [7, 'N', '질소', 2, 15], [8, 'O', '산소', 2, 16],
    [9, 'F', '플루오린', 2, 17], [10, 'Ne', '네온', 2, 18],
    [11, 'Na', '나트륨', 3, 1], [12, 'Mg', '마그네슘', 3, 2], [13, 'Al', '알루미늄', 3, 13],
    [14, 'Si', '규소', 3, 14], [15, 'P', '인', 3, 15], [16, 'S', '황', 3, 16],
    [17, 'Cl', '염소', 3, 17], [18, 'Ar', '아르곤', 3, 18],
    [19, 'K', '칼륨', 4, 1], [20, 'Ca', '칼슘', 4, 2], [21, 'Sc', '스칸듐', 4, 3],
    [22, 'Ti', '타이타늄', 4, 4], [23, 'V', '바나듐', 4, 5], [24, 'Cr', '크로뮴', 4, 6],
    [25, 'Mn', '망가니즈', 4, 7], [26, 'Fe', '철', 4, 8], [27, 'Co', '코발트', 4, 9],
    [28, 'Ni', '니켈', 4, 10], [29, 'Cu', '구리', 4, 11], [30, 'Zn', '아연', 4, 12],
    [31, 'Ga', '갈륨', 4, 13], [32, 'Ge', '저마늄', 4, 14], [33, 'As', '비소', 4, 15],
    [34, 'Se', '셀레늄', 4, 16], [35, 'Br', '브로민', 4, 17], [36, 'Kr', '크립톤', 4, 18],
  ];

  const METALLOID = [5, 14, 32, 33];
  const NONMETAL = [1, 2, 6, 7, 8, 9, 10, 15, 16, 17, 18, 34, 35, 36];

  const CAT_LABEL = { metal: '금속', nonmetal: '비금속', metalloid: '준금속' };

  const ELEMENTS = RAW.map(([num, symbol, name, period, group]) => ({
    num, symbol, name, period, group,
    cat: METALLOID.includes(num) ? 'metalloid' : NONMETAL.includes(num) ? 'nonmetal' : 'metal',
  }));

  const byNum = {};
  ELEMENTS.forEach((e) => { byNum[e.num] = e; });

  // 카드 a 를 기준(ref: {period, group} 중 하나 이상)에 내려놓을 때 실제로 유효한 근거 목록
  function validBasis(a, ref) {
    const out = [];
    if (ref.period != null && a.period === ref.period) out.push({ type: 'period', value: a.period, label: a.period + '주기' });
    if (ref.group != null && a.group === ref.group) out.push({ type: 'group', value: a.group, label: a.group + '족' });
    return out;
  }

  // 덱 구성: 이지(1~20 x3 = 60 + 특수 14 = 74) / 하드(1~36 x2 = 72 + 특수 14 = 86)
  const SPECIAL_COUNTS = { noble: 3, covalent: 3, ionic: 3, beta: 3, fission: 2 };
  const MODES = {
    easy: { max: 20, copies: 3 },
    hard: { max: 36, copies: 2 },
  };

  return { ELEMENTS, byNum, CAT_LABEL, validBasis, SPECIAL_COUNTS, MODES };
});
