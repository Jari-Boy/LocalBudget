/**
 * buildSettlementJournalEntryInput(精算仕訳の組み立て)の純粋関数としてのユニットテスト。
 * docs/domain/expense-splitting.md 1.3節の精算1(負債側立替金の消込)・精算2(資産側立替金の消込)の
 * 例に沿って、一時勘定の区分(資産/負債)に応じて借方/貸方が入れ替わることを検証する。計画Issue #133
 * により、settlesリンクによる消込(行対行のリンク)は廃止され、一時勘定行にsettlementBatchIdタグを
 * 付与するだけで未精算残高の集計方式に乗る設計になった。計画Issue #139で、精算画面の差額損益計上
 * (不一致時の調整仕訳)にも再利用できるよう、settlementHouseholdMemberIdをnull許容にし(取引先が
 * 対象者の場合、advance行はcounterparty_idを持てないため誰にも紐付けない、docs/domain/
 * counterparties.md 1.2)、仕訳の起票者(entryHouseholdMemberId)を別パラメータとして分離した。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildSettlementJournalEntryInput } from './buildSettlementJournalEntryInput'

describe('buildSettlementJournalEntryInput', () => {
  it('負債科目(立替金)の精算では、立替金(負債)を借方、精算元の口座を貸方にする(精算1相当)', () => {
    const result = buildSettlementJournalEntryInput({
      settlementBatchId: 26,
      settlementAccountId: 11,
      settlementAccountCategory: 'liability',
      counterAccountId: 20,
      amount: 500,
      settlementHouseholdMemberId: 200,
      entryHouseholdMemberId: 200,
      entryDate: '2026-07-20',
    })

    expect(result).toEqual({
      entryDate: '2026-07-20',
      memo: null,
      householdMemberId: 200,
      lines: [
        { accountId: 11, side: 'debit', amount: 500, settlementBatchId: 26, householdMemberId: 200 },
        { accountId: 20, side: 'credit', amount: 500 },
      ],
    })
  })

  it('資産科目(立替金)の精算では、精算先の口座を借方、立替金(資産)を貸方にする(精算2相当)', () => {
    const result = buildSettlementJournalEntryInput({
      settlementBatchId: 26,
      settlementAccountId: 10,
      settlementAccountCategory: 'asset',
      counterAccountId: 21,
      amount: 500,
      settlementHouseholdMemberId: 100,
      entryHouseholdMemberId: 100,
      entryDate: '2026-07-25',
      memo: '精算',
    })

    expect(result).toEqual({
      entryDate: '2026-07-25',
      memo: '精算',
      householdMemberId: 100,
      lines: [
        { accountId: 21, side: 'debit', amount: 500 },
        { accountId: 10, side: 'credit', amount: 500, settlementBatchId: 26, householdMemberId: 100 },
      ],
    })
  })

  it('取引先が対象者の場合、settlementHouseholdMemberIdをnullにし、起票者は別パラメータの値を使う(計画Issue #139)', () => {
    const result = buildSettlementJournalEntryInput({
      settlementBatchId: 30,
      settlementAccountId: 11,
      settlementAccountCategory: 'liability',
      counterAccountId: 40,
      amount: 4000,
      settlementHouseholdMemberId: null,
      entryHouseholdMemberId: 1,
      entryDate: '2026-10-10',
      memo: '雑収入への差額計上',
    })

    expect(result).toEqual({
      entryDate: '2026-10-10',
      memo: '雑収入への差額計上',
      householdMemberId: 1,
      lines: [
        { accountId: 11, side: 'debit', amount: 4000, settlementBatchId: 30, householdMemberId: null },
        { accountId: 40, side: 'credit', amount: 4000 },
      ],
    })
  })
})
