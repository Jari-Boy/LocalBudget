/**
 * buildExpenseSplittingJournalEntryInputs(複数人割勘の仕訳配列組み立て)の純粋関数
 * としてのユニットテスト。計画Issue #40の合意事項(複数人割勘は複数の2者間仕訳として
 * 実現し、単一の可変長仕訳パターンは採用しない)に基づき、分担者ごとに
 * buildHouseholdMemberExpenseSplittingJournalEntryInput/
 * buildCounterpartyExpenseSplittingJournalEntryInputへ振り分けて
 * CreateJournalEntryInput[]を組み立てる合成ロジックを検証する。計画Issue #133により、
 * 立替金行のタグはsettlementBatchId、費用行のタグ(eventProjectId)はproject_id(イベント)に
 * 分かれたことも検証する。元仕訳との関連付け(journal_entry_links)は計画Issue #138で
 * 関連仕訳グループに置き換わり、本関数の責務ではなくなった。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildExpenseSplittingJournalEntryInputs } from './buildExpenseSplittingJournalEntryInputs'

describe('buildExpenseSplittingJournalEntryInputs', () => {
  it('世帯メンバーの分担者のみの場合、分担者ごとに4行仕訳を生成する', () => {
    const result = buildExpenseSplittingJournalEntryInputs({
      expenseAccountId: 10,
      advanceAssetAccountId: 20,
      fromMemberId: 100,
      settlementBatchId: 5,
      entryDate: '2026-08-15',
      memo: '生活費割勘',
      recipients: [
        { kind: 'householdMember', toMemberId: 101, advanceLiabilityAccountId: 21, amount: 300 },
        { kind: 'householdMember', toMemberId: 102, advanceLiabilityAccountId: 21, amount: 300 },
      ],
    })

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      entryDate: '2026-08-15',
      memo: '生活費割勘',
      householdMemberId: 100,
      sourceType: 'expense_splitting',
      lines: [
        { accountId: 10, householdMemberId: 101, projectId: null, side: 'debit', amount: 300 },
        { accountId: 20, householdMemberId: 100, settlementBatchId: 5, side: 'debit', amount: 300 },
        { accountId: 10, householdMemberId: 100, projectId: null, side: 'credit', amount: 300 },
        { accountId: 21, householdMemberId: 101, settlementBatchId: 5, side: 'credit', amount: 300 },
      ],
    })
    expect(result[1].lines[0]).toMatchObject({ accountId: 10, householdMemberId: 102, side: 'debit', amount: 300 })
  })

  it('eventProjectIdを渡すと、費用行(イベントのタグ)に引き継がれる(計画Issue #133)', () => {
    const result = buildExpenseSplittingJournalEntryInputs({
      expenseAccountId: 10,
      advanceAssetAccountId: 20,
      fromMemberId: 100,
      settlementBatchId: 5,
      eventProjectId: 77,
      entryDate: '2026-08-15',
      recipients: [{ kind: 'householdMember', toMemberId: 101, advanceLiabilityAccountId: 21, amount: 300 }],
    })

    expect(result[0].lines[0]).toMatchObject({ accountId: 10, projectId: 77 })
    expect(result[0].lines[2]).toMatchObject({ accountId: 10, projectId: 77 })
    expect(result[0].lines[1]).toMatchObject({ accountId: 20, settlementBatchId: 5 })
  })

  it('世帯外相手の分担者のみの場合、分担者ごとに2行仕訳を生成する', () => {
    const result = buildExpenseSplittingJournalEntryInputs({
      expenseAccountId: 10,
      advanceAssetAccountId: 20,
      fromMemberId: 100,
      settlementBatchId: 5,
      entryDate: '2026-08-15',
      recipients: [{ kind: 'counterparty', counterpartyId: 7, amount: 500 }],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      entryDate: '2026-08-15',
      memo: null,
      householdMemberId: 100,
      sourceType: 'expense_splitting',
      lines: [
        { accountId: 20, householdMemberId: 100, settlementBatchId: 5, side: 'debit', amount: 500 },
        { accountId: 10, householdMemberId: 100, counterpartyId: 7, projectId: null, side: 'credit', amount: 500 },
      ],
    })
  })

  it('世帯メンバー・世帯外相手が混在する分担者リストから、種別ごとに正しい仕訳を生成する', () => {
    const result = buildExpenseSplittingJournalEntryInputs({
      expenseAccountId: 10,
      advanceAssetAccountId: 20,
      fromMemberId: 100,
      settlementBatchId: 5,
      entryDate: '2026-08-15',
      recipients: [
        { kind: 'householdMember', toMemberId: 101, advanceLiabilityAccountId: 21, amount: 300 },
        { kind: 'counterparty', counterpartyId: 7, amount: 200 },
      ],
    })

    expect(result).toHaveLength(2)
    expect(result[0].lines).toHaveLength(4)
    expect(result[1].lines).toHaveLength(2)
  })

  it('分担者が0人の場合は空配列を返す', () => {
    const result = buildExpenseSplittingJournalEntryInputs({
      expenseAccountId: 10,
      advanceAssetAccountId: 20,
      fromMemberId: 100,
      settlementBatchId: 5,
      entryDate: '2026-08-15',
      recipients: [],
    })

    expect(result).toEqual([])
  })
})
