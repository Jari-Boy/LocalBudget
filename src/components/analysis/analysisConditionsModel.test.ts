/**
 * 分析画面の条件(計画Issue #155)を、集計用の絞り込みと仕訳一覧へ引き継ぐ絞り込みへ変換する
 * 純粋関数(analysisConditionsModel)のテスト。
 * 条件バーの選択ツリーの値は、項目が「ID」、グループが「g:ID」、未選択が空文字。
 * - toStatementFilter: 世帯メンバー・プロジェクト・取引先を財務諸表の絞り込み(ID配列)にする。
 *   グループは配下(入れ子を含む)の項目のIDに展開する
 * - toJournalFilter: 期間と選んだ条件を仕訳一覧の検索条件にする(グループはグループ指定のまま渡す)
 * DOM・DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { toJournalFilter, toStatementFilter, type AnalysisConditionValues } from './analysisConditionsModel'

const none: AnalysisConditionValues = { member: '', project: '', counterparty: '' }

const masters = {
  projects: [
    { id: 1, projectGroupId: 10 },
    { id: 2, projectGroupId: 11 },
    { id: 3, projectGroupId: null },
  ],
  projectGroups: [
    { id: 10, parentGroupId: null },
    { id: 11, parentGroupId: 10 },
  ],
  counterparties: [
    { id: 5, counterpartyGroupId: 20 },
    { id: 6, counterpartyGroupId: null },
  ],
  counterpartyGroups: [{ id: 20, parentGroupId: null }],
}

describe('toStatementFilter', () => {
  it('何も選んでいなければ、絞り込みなし(空のオブジェクト)', () => {
    expect(toStatementFilter(none, masters)).toEqual({})
  })

  it('世帯メンバーの項目を選ぶと、そのIDだけで絞り込む', () => {
    expect(toStatementFilter({ ...none, member: '2' }, masters)).toEqual({ householdMemberIds: [2] })
  })

  it('プロジェクトの項目を選ぶと、そのIDで絞り込む', () => {
    expect(toStatementFilter({ ...none, project: '3' }, masters)).toEqual({ projectIds: [3] })
  })

  it('プロジェクトのグループを選ぶと、入れ子の配下を含むすべてのプロジェクトのIDに展開する', () => {
    const filter = toStatementFilter({ ...none, project: 'g:10' }, masters)
    expect([...(filter.projectIds ?? [])].sort()).toEqual([1, 2])
  })

  it('取引先のグループを選ぶと、配下の取引先のIDに展開する', () => {
    expect(toStatementFilter({ ...none, counterparty: 'g:20' }, masters)).toEqual({ counterpartyIds: [5] })
  })

  it('配下に項目がないグループを選ぶと、どの明細にも一致しない絞り込みになる(全件にはしない)', () => {
    const filter = toStatementFilter({ ...none, project: 'g:99' }, masters)
    expect(filter.projectIds).toEqual([])
  })

  it('複数の軸を選ぶと、すべて指定する', () => {
    const filter = toStatementFilter({ member: '1', project: '3', counterparty: '6' }, masters)
    expect(filter).toEqual({ householdMemberIds: [1], projectIds: [3], counterpartyIds: [6] })
  })
})

describe('toJournalFilter', () => {
  const period = { from: '2026-10-01', to: '2026-10-31' }

  it('期間を、仕訳一覧の開始日・終了日にする', () => {
    expect(toJournalFilter(period, none)).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-31' })
  })

  it('選んだ世帯メンバー・プロジェクト・取引先を引き継ぐ', () => {
    expect(toJournalFilter(period, { member: '2', project: '3', counterparty: '6' })).toEqual({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      householdMemberIds: [2],
      projectIds: [3],
      counterpartyIds: [6],
    })
  })

  it('グループを選んでいれば、グループ指定のまま引き継ぐ', () => {
    const filter = toJournalFilter(period, { ...none, project: 'g:10', counterparty: 'g:20' })
    expect(filter.projectGroupIds).toEqual([10])
    expect(filter.counterpartyGroupIds).toEqual([20])
    expect(filter.projectIds).toBeUndefined()
  })

  it('科目を指定すると、その科目の明細がある仕訳に絞る', () => {
    expect(toJournalFilter(period, none, { accountIds: [7] }).accountIds).toEqual([7])
  })

  it('期間を渡さなければ、日付の条件を付けない(取り消し)', () => {
    expect(toJournalFilter(null, none)).toEqual({})
  })
})
