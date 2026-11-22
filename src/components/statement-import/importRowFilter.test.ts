/**
 * importRowFilter(明細取込画面の行の絞り込み、計画Issue #258)のユニットテスト。
 * 摘要のテキスト絞り込み(選択欄の検索と同じ正規化で、表記ゆれに強い)、期間(両端を含む)、金額(符号つき、マイナスも指定できる、両端を含む)、
 * 相手科目・取引先・プロジェクト・メンバー・精算バッチの複数選択(軸の中はOR・軸どうしはAND)と「未設定」、選択欄の値(項目・「g:グループID」)から対象のidへの展開、
 * 入力欄を持たない重複の行の扱い、絞り込みで隠れた行の選択を外す処理を検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import {
  activeConditionCount,
  EMPTY_FILTER_INPUT,
  EMPTY_ROW_FILTER,
  expandTreeValues,
  isRowFilterActive,
  matchesRowFilter,
  pruneSelection,
  resolveFilterInput,
  UNSET_VALUE,
  type FilterableRow,
  type ImportRowFilter,
} from './importRowFilter'

const row = (
  overrides: Partial<Omit<FilterableRow, 'inputs'>> & { inputs?: Partial<NonNullable<FilterableRow['inputs']>> | null } = {},
): FilterableRow => ({
  description: 'セブン-イレブン 新宿三丁目店',
  entryDate: '2026-10-05',
  amount: -648,
  ...overrides,
  inputs:
    overrides.inputs === null
      ? null
      : { counterAccountId: null, counterpartyId: null, projectId: null, memberId: null, batchId: null, ...overrides.inputs },
})

const filter = (overrides: Partial<ImportRowFilter>): ImportRowFilter => ({ ...EMPTY_ROW_FILTER, ...overrides })

describe('isRowFilterActive / activeConditionCount', () => {
  it('条件が1つも無いときは絞り込み中ではなく、条件数は0', () => {
    expect(isRowFilterActive(EMPTY_ROW_FILTER)).toBe(false)
    expect(activeConditionCount(EMPTY_ROW_FILTER)).toBe(0)
  })

  it('空白だけの摘要は条件として数えない', () => {
    expect(isRowFilterActive(filter({ description: '  ' }))).toBe(false)
  })

  it('期間は開始日・終了日のどちらを指定しても1つ、金額は下限・上限のどちらを指定しても1つの条件として数える', () => {
    expect(activeConditionCount(filter({ dateFrom: '2026-10-01' }))).toBe(1)
    expect(activeConditionCount(filter({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }))).toBe(1)
    expect(activeConditionCount(filter({ amountMax: 1000 }))).toBe(1)
    expect(activeConditionCount(filter({ amountMin: 0, amountMax: 1000 }))).toBe(1)
    expect(activeConditionCount(filter({ batch: [UNSET_VALUE] }))).toBe(1)
  })

  it('指定した軸の数を数える(軸の中で複数選んでも1つ。「未設定」も条件)', () => {
    const f = filter({ description: 'セブン', project: [UNSET_VALUE], counterAccount: [3, 4], member: [1] })
    expect(isRowFilterActive(f)).toBe(true)
    expect(activeConditionCount(f)).toBe(4)
  })
})

describe('matchesRowFilter: 摘要', () => {
  it('条件が空なら、どの行も一致する', () => {
    expect(matchesRowFilter(EMPTY_ROW_FILTER, row())).toBe(true)
    expect(matchesRowFilter(EMPTY_ROW_FILTER, row({ inputs: null }))).toBe(true)
  })

  it('摘要に含まれる文字で一致する(部分一致)', () => {
    expect(matchesRowFilter(filter({ description: 'セブン' }), row())).toBe(true)
    expect(matchesRowFilter(filter({ description: 'ローソン' }), row())).toBe(false)
  })

  it('全角半角・大文字小文字・カタカナとひらがなの違いを区別しない', () => {
    const r = row({ description: 'ＡＭＡＺＯＮ.CO.JP ｱﾏｿﾞﾝ' })
    expect(matchesRowFilter(filter({ description: 'amazon' }), r)).toBe(true)
    expect(matchesRowFilter(filter({ description: 'あまぞん' }), r)).toBe(true)
  })

  it('検索語の空白は無視する', () => {
    expect(matchesRowFilter(filter({ description: ' セブン イレブン ' }), row({ description: 'セブンイレブン池袋' }))).toBe(true)
  })
})

describe('matchesRowFilter: 相手科目・取引先・プロジェクト・メンバー', () => {
  it('指定したidのどれかと同じ行が一致する(軸の中はOR)', () => {
    const f = filter({ counterAccount: [5, 7] })
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 5 } }))).toBe(true)
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 7 } }))).toBe(true)
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 6 } }))).toBe(false)
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: null } }))).toBe(false)
  })

  it('「未設定」は、その項目がnullの行だけ一致する。idと一緒に選ぶと、どちらかに合えば一致する', () => {
    const unset = filter({ project: [UNSET_VALUE] })
    expect(matchesRowFilter(unset, row({ inputs: { projectId: null } }))).toBe(true)
    expect(matchesRowFilter(unset, row({ inputs: { projectId: 2 } }))).toBe(false)
    const both = filter({ project: [UNSET_VALUE, 2] })
    expect(matchesRowFilter(both, row({ inputs: { projectId: null } }))).toBe(true)
    expect(matchesRowFilter(both, row({ inputs: { projectId: 2 } }))).toBe(true)
    expect(matchesRowFilter(both, row({ inputs: { projectId: 3 } }))).toBe(false)
  })

  it('取引先・メンバーの条件は、それぞれの項目だけを見る', () => {
    const f = filter({ counterparty: [9], member: [2] })
    expect(matchesRowFilter(f, row({ inputs: { counterpartyId: 9, memberId: 2, counterAccountId: 1 } }))).toBe(true)
    expect(matchesRowFilter(f, row({ inputs: { counterpartyId: 1, memberId: 2, counterAccountId: 9 } }))).toBe(false)
    expect(matchesRowFilter(f, row({ inputs: { counterpartyId: 9, memberId: 3 } }))).toBe(false)
  })
})

describe('matchesRowFilter: 精算バッチ', () => {
  it('選んだバッチの行と、「未設定」(未割当)の行を出し分けられる', () => {
    expect(matchesRowFilter(filter({ batch: [4] }), row({ inputs: { batchId: 4 } }))).toBe(true)
    expect(matchesRowFilter(filter({ batch: [4] }), row({ inputs: { batchId: null } }))).toBe(false)
    expect(matchesRowFilter(filter({ batch: [UNSET_VALUE] }), row({ inputs: { batchId: null } }))).toBe(true)
    expect(matchesRowFilter(filter({ batch: [UNSET_VALUE] }), row({ inputs: { batchId: 4 } }))).toBe(false)
  })
})

describe('matchesRowFilter: 期間', () => {
  const on = (entryDate: string) => row({ entryDate })

  it('開始日と終了日の両端を含む範囲に入る行だけ一致する', () => {
    const f = filter({ dateFrom: '2026-10-05', dateTo: '2026-10-10' })
    expect(matchesRowFilter(f, on('2026-10-05'))).toBe(true)
    expect(matchesRowFilter(f, on('2026-10-10'))).toBe(true)
    expect(matchesRowFilter(f, on('2026-10-04'))).toBe(false)
    expect(matchesRowFilter(f, on('2026-10-11'))).toBe(false)
  })

  it('開始日だけなら、その日以降のすべて。終了日だけなら、その日以前のすべて', () => {
    expect(matchesRowFilter(filter({ dateFrom: '2026-10-05' }), on('2026-12-31'))).toBe(true)
    expect(matchesRowFilter(filter({ dateFrom: '2026-10-05' }), on('2026-10-04'))).toBe(false)
    expect(matchesRowFilter(filter({ dateTo: '2026-10-05' }), on('2026-01-01'))).toBe(true)
    expect(matchesRowFilter(filter({ dateTo: '2026-10-05' }), on('2026-10-06'))).toBe(false)
  })

  it('開始日が終了日より後なら、どの行も一致しない', () => {
    expect(matchesRowFilter(filter({ dateFrom: '2026-10-10', dateTo: '2026-10-01' }), on('2026-10-05'))).toBe(false)
  })
})

describe('matchesRowFilter: 金額', () => {
  const of = (amount: number) => row({ amount })

  it('取込の金額は符号つき(支出はマイナス、収入はプラス)のまま、下限・上限の両端を含めて判定する', () => {
    const income = filter({ amountMin: 500, amountMax: 1000 })
    expect(matchesRowFilter(income, of(500))).toBe(true)
    expect(matchesRowFilter(income, of(1000))).toBe(true)
    expect(matchesRowFilter(income, of(499))).toBe(false)
    expect(matchesRowFilter(income, of(1001))).toBe(false)
    expect(matchesRowFilter(income, of(-700))).toBe(false)
  })

  it('マイナスの範囲を指定すると、支出だけを絞れる(下限が小さい側、上限が大きい側)', () => {
    const expense = filter({ amountMin: -1000, amountMax: -500 })
    expect(matchesRowFilter(expense, of(-500))).toBe(true)
    expect(matchesRowFilter(expense, of(-1000))).toBe(true)
    expect(matchesRowFilter(expense, of(-499))).toBe(false)
    expect(matchesRowFilter(expense, of(-1001))).toBe(false)
    expect(matchesRowFilter(expense, of(700))).toBe(false)
  })

  it('下限だけなら、その金額以上のすべて。上限だけなら、その金額以下のすべて(0円も扱える)', () => {
    expect(matchesRowFilter(filter({ amountMin: 1000 }), of(50000))).toBe(true)
    expect(matchesRowFilter(filter({ amountMin: 1000 }), of(-50000))).toBe(false)
    expect(matchesRowFilter(filter({ amountMax: -1 }), of(-50000))).toBe(true)
    expect(matchesRowFilter(filter({ amountMax: -1 }), of(0))).toBe(false)
    expect(matchesRowFilter(filter({ amountMax: 0 }), of(0))).toBe(true)
  })
})

describe('matchesRowFilter: 複数条件(軸どうしはAND)', () => {
  const f = filter({ description: 'セブン', counterAccount: [5], project: [UNSET_VALUE] })

  it('すべての軸に合う行だけ一致する', () => {
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 5, projectId: null } }))).toBe(true)
  })

  it('1つでも合わない軸があれば一致しない', () => {
    expect(matchesRowFilter(f, row({ description: 'ローソン', inputs: { counterAccountId: 5 } }))).toBe(false)
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 6 } }))).toBe(false)
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 5, projectId: 1 } }))).toBe(false)
  })
})

describe('matchesRowFilter: 入力欄を持たない行(重複)', () => {
  it('摘要の条件だけなら、摘要で判定する', () => {
    expect(matchesRowFilter(filter({ description: 'セブン' }), row({ inputs: null }))).toBe(true)
    expect(matchesRowFilter(filter({ description: 'ローソン' }), row({ inputs: null }))).toBe(false)
  })

  it('科目・取引先・プロジェクト・メンバーの条件があると、「未設定」を含めて一致しない(値を持たないため)', () => {
    expect(matchesRowFilter(filter({ counterAccount: [5] }), row({ inputs: null }))).toBe(false)
    expect(matchesRowFilter(filter({ project: [UNSET_VALUE] }), row({ inputs: null }))).toBe(false)
    expect(matchesRowFilter(filter({ member: [UNSET_VALUE] }), row({ inputs: null }))).toBe(false)
    expect(matchesRowFilter(filter({ batch: [UNSET_VALUE] }), row({ inputs: null }))).toBe(false)
  })

  it('期間と金額は、どの行も日付と金額を持つので、重複の行にも効く', () => {
    expect(matchesRowFilter(filter({ dateFrom: '2026-10-06' }), row({ entryDate: '2026-10-05', inputs: null }))).toBe(false)
    expect(matchesRowFilter(filter({ dateFrom: '2026-10-06' }), row({ entryDate: '2026-10-07', inputs: null }))).toBe(true)
    expect(matchesRowFilter(filter({ amountMin: -400 }), row({ amount: -500, inputs: null }))).toBe(false)
  })
})

describe('expandTreeValues', () => {
  const categories: TreeSelectCategory[] = [
    {
      key: 'expense',
      name: '費用',
      nodes: [
        {
          kind: 'group',
          id: '10',
          name: '食費',
          children: [
            { kind: 'item', value: '1', name: 'コンビニ', isActive: true },
            {
              kind: 'group',
              id: '11',
              name: '外食',
              children: [{ kind: 'item', value: '2', name: 'ランチ', isActive: true }],
            },
          ],
        },
        { kind: 'item', value: '3', name: '日用品費', isActive: true },
      ],
    },
  ]

  it('項目の値は、その項目のidになる', () => {
    expect(expandTreeValues(categories, ['3'])).toEqual([3])
  })

  it('「g:グループID」は、そのグループの配下(入れ子を含む)のすべての項目のidになる', () => {
    expect(new Set(expandTreeValues(categories, ['g:10']))).toEqual(new Set([1, 2]))
    expect(expandTreeValues(categories, ['g:11'])).toEqual([2])
  })

  it('「未設定」はそのまま残り、同じidは重ねない', () => {
    expect(expandTreeValues(categories, [UNSET_VALUE, '1', 'g:10'])).toEqual([UNSET_VALUE, 1, 2])
  })

  it('何も選んでいなければ空(絞り込まない)', () => {
    expect(expandTreeValues(categories, [])).toEqual([])
  })

  it('配下に項目が無い(存在しない)グループだけを選んだときは、何にも一致しない選択になる(絞り込み中のまま)', () => {
    expect(expandTreeValues(categories, ['g:99'])).toEqual([-1])
  })
})

describe('resolveFilterInput', () => {
  const flat = (...values: string[]): TreeSelectCategory[] => [
    { key: 'k', name: '', nodes: values.map((v) => ({ kind: 'item' as const, value: v, name: v, isActive: true })) },
  ]
  const categories = { counterAccount: flat('1'), counterparty: flat('2'), project: flat('3'), member: flat('4'), batch: flat('5') }

  it('入力が空なら、絞り込まない条件になる', () => {
    expect(resolveFilterInput(EMPTY_FILTER_INPUT, categories)).toEqual(EMPTY_ROW_FILTER)
  })

  it('摘要はそのまま、各軸の選択欄の値は対象のidに展開される', () => {
    const result = resolveFilterInput(
      {
        ...EMPTY_FILTER_INPUT,
        description: 'セブン',
        values: { counterAccount: ['1'], counterparty: [], project: [UNSET_VALUE, '3'], member: ['4'], batch: ['5'] },
      },
      categories,
    )

    expect(result).toEqual({
      ...EMPTY_ROW_FILTER,
      description: 'セブン',
      counterAccount: [1],
      project: [UNSET_VALUE, 3],
      member: [4],
      batch: [5],
    })
  })

  it('期間はそのまま、金額の入力は数値にする(空・数字として読めない入力は条件にしない)', () => {
    const result = resolveFilterInput(
      { ...EMPTY_FILTER_INPUT, dateFrom: '2026-10-01', dateTo: '2026-10-31', amountMin: '500', amountMax: '1,000円' },
      categories,
    )

    expect(result.dateFrom).toBe('2026-10-01')
    expect(result.dateTo).toBe('2026-10-31')
    expect(result.amountMin).toBe(500)
    expect(result.amountMax).toBeNull()
    expect(resolveFilterInput({ ...EMPTY_FILTER_INPUT, amountMin: '  ' }, categories).amountMin).toBeNull()
    expect(resolveFilterInput({ ...EMPTY_FILTER_INPUT, amountMax: '0' }, categories).amountMax).toBe(0)
    expect(resolveFilterInput({ ...EMPTY_FILTER_INPUT, amountMin: '-1000' }, categories).amountMin).toBe(-1000)
  })
})

describe('pruneSelection', () => {
  it('表示中の行の選択だけを残し、外した件数を返す', () => {
    const result = pruneSelection(new Set([1, 2, 3, 4]), (i) => i % 2 === 0)
    expect([...result.kept].sort()).toEqual([2, 4])
    expect(result.removed).toBe(2)
  })

  it('すべて表示中なら、選択は変わらず外した件数は0', () => {
    const result = pruneSelection(new Set([1, 2]), () => true)
    expect([...result.kept].sort()).toEqual([1, 2])
    expect(result.removed).toBe(0)
  })
})
