/**
 * importRowFilter(明細取込画面の列ごとの行の絞り込み、計画Issue #258)のユニットテスト。
 * 摘要のテキスト絞り込み(選択欄の検索と同じ正規化で、表記ゆれに強い)、期間(開始日・終了日、両端を含む)、
 * 相手科目・取引先・プロジェクト・メンバーのid絞り込みと「未設定」、複数条件のAND、入力欄を持たない重複の行の扱い、絞り込みで隠れた行の選択を外す処理を検証する。
 * DB・DOM非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import {
  activeConditionCount,
  EMPTY_ROW_FILTER,
  isRowFilterActive,
  matchesRowFilter,
  pruneSelection,
  type FilterableRow,
  type ImportRowFilter,
} from './importRowFilter'

const row = (
  overrides: Partial<Omit<FilterableRow, 'inputs'>> & { inputs?: Partial<NonNullable<FilterableRow['inputs']>> | null } = {},
): FilterableRow => ({
  description: 'セブン-イレブン 新宿三丁目店',
  entryDate: '2026-10-05',
  ...overrides,
  inputs:
    overrides.inputs === null
      ? null
      : { counterAccountId: null, counterpartyId: null, projectId: null, memberId: null, ...overrides.inputs },
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

  it('指定した条件の数を数える(「未設定」も条件)', () => {
    const f = filter({ description: 'セブン', project: 'unset', counterAccount: 3 })
    expect(isRowFilterActive(f)).toBe(true)
    expect(activeConditionCount(f)).toBe(3)
  })

  it('期間は、開始日・終了日のどちらを指定しても、1つの条件として数える', () => {
    expect(activeConditionCount(filter({ dateFrom: '2026-10-01' }))).toBe(1)
    expect(activeConditionCount(filter({ dateTo: '2026-10-31' }))).toBe(1)
    expect(activeConditionCount(filter({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }))).toBe(1)
  })

  it('メンバーの条件も数える', () => {
    expect(activeConditionCount(filter({ member: 'unset' }))).toBe(1)
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

describe('matchesRowFilter: 相手科目・取引先・プロジェクト', () => {
  it('指定したidと同じ行だけ一致する', () => {
    const f = filter({ counterAccount: 5 })
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 5 } }))).toBe(true)
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 6 } }))).toBe(false)
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: null } }))).toBe(false)
  })

  it('「未設定」は、その項目がnullの行だけ一致する', () => {
    const f = filter({ project: 'unset' })
    expect(matchesRowFilter(f, row({ inputs: { projectId: null } }))).toBe(true)
    expect(matchesRowFilter(f, row({ inputs: { projectId: 2 } }))).toBe(false)
  })

  it('取引先の条件は取引先の項目だけを見る', () => {
    const f = filter({ counterparty: 9 })
    expect(matchesRowFilter(f, row({ inputs: { counterpartyId: 9, counterAccountId: 1 } }))).toBe(true)
    expect(matchesRowFilter(f, row({ inputs: { counterpartyId: 1, counterAccountId: 9 } }))).toBe(false)
  })
})

describe('matchesRowFilter: メンバー', () => {
  it('指定したメンバーの行だけ一致し、「未設定」はメンバーが決まっていない行だけ一致する', () => {
    expect(matchesRowFilter(filter({ member: 2 }), row({ inputs: { memberId: 2 } }))).toBe(true)
    expect(matchesRowFilter(filter({ member: 2 }), row({ inputs: { memberId: 3 } }))).toBe(false)
    expect(matchesRowFilter(filter({ member: 'unset' }), row({ inputs: { memberId: null } }))).toBe(true)
    expect(matchesRowFilter(filter({ member: 'unset' }), row({ inputs: { memberId: 2 } }))).toBe(false)
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

  it('入力欄を持たない行(重複)にも、期間は効く', () => {
    const f = filter({ dateFrom: '2026-10-06' })
    expect(matchesRowFilter(f, row({ entryDate: '2026-10-05', inputs: null }))).toBe(false)
    expect(matchesRowFilter(f, row({ entryDate: '2026-10-07', inputs: null }))).toBe(true)
  })
})

describe('matchesRowFilter: 複数条件(AND)', () => {
  const f = filter({ description: 'セブン', counterAccount: 5, project: 'unset' })

  it('すべての条件に合う行だけ一致する', () => {
    expect(matchesRowFilter(f, row({ inputs: { counterAccountId: 5, projectId: null } }))).toBe(true)
  })

  it('1つでも合わない条件があれば一致しない', () => {
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
    expect(matchesRowFilter(filter({ counterAccount: 5 }), row({ inputs: null }))).toBe(false)
    expect(matchesRowFilter(filter({ project: 'unset' }), row({ inputs: null }))).toBe(false)
    expect(matchesRowFilter(filter({ member: 'unset' }), row({ inputs: null }))).toBe(false)
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
