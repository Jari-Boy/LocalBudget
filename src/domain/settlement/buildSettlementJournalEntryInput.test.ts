/**
 * buildSettlementJournalEntryInput(精算仕訳の組み立て)の純粋関数としての
 * ユニットテスト。docs/domain/expense-splitting.md 1.3節の精算1(負債側立替金の消込)・
 * 精算2(資産側立替金の消込)の例に沿って、一時勘定の区分(資産/負債)に応じて
 * 借方/貸方が入れ替わることを検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildSettlementJournalEntryInput } from './buildSettlementJournalEntryInput'

describe('buildSettlementJournalEntryInput', () => {
  it('負債科目(立替金)の精算では、立替金(負債)を借方、精算元の口座を貸方にする(精算1相当)', () => {
    const result = buildSettlementJournalEntryInput({
      targetEntryId: 1000,
      settlementAccountId: 11,
      settlementAccountCategory: 'liability',
      counterAccountId: 20,
      amount: 500,
      householdMemberId: 200,
      projectId: 26,
      entryDate: '2026-07-20',
    })

    expect(result).toEqual({
      entryDate: '2026-07-20',
      memo: null,
      householdMemberId: 200,
      lines: [
        { accountId: 11, side: 'debit', amount: 500, projectId: 26, householdMemberId: 200 },
        { accountId: 20, side: 'credit', amount: 500 },
      ],
      links: [{ toEntryId: 1000, linkType: 'settles', amount: 500 }],
    })
  })

  it('資産科目(立替金)の精算では、精算先の口座を借方、立替金(資産)を貸方にする(精算2相当)', () => {
    const result = buildSettlementJournalEntryInput({
      targetEntryId: 1000,
      settlementAccountId: 10,
      settlementAccountCategory: 'asset',
      counterAccountId: 21,
      amount: 500,
      householdMemberId: 100,
      projectId: 26,
      entryDate: '2026-07-25',
      memo: '精算',
    })

    expect(result).toEqual({
      entryDate: '2026-07-25',
      memo: '精算',
      householdMemberId: 100,
      lines: [
        { accountId: 21, side: 'debit', amount: 500 },
        { accountId: 10, side: 'credit', amount: 500, projectId: 26, householdMemberId: 100 },
      ],
      links: [{ toEntryId: 1000, linkType: 'settles', amount: 500 }],
    })
  })

  it('projectIdを指定しない場合、一時勘定行のprojectIdはnullになる', () => {
    const result = buildSettlementJournalEntryInput({
      targetEntryId: 1000,
      settlementAccountId: 11,
      settlementAccountCategory: 'liability',
      counterAccountId: 20,
      amount: 500,
      householdMemberId: 200,
      projectId: null,
      entryDate: '2026-07-20',
    })

    expect(result.lines[0]).toMatchObject({ accountId: 11, projectId: null })
  })
})
