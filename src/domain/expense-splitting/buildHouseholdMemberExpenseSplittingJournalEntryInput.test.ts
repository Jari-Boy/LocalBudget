/**
 * buildHouseholdMemberExpenseSplittingJournalEntryInput(世帯メンバー間の割勘仕訳の組み立て)の
 * 純粋関数としてのユニットテスト。docs/domain/expense-splitting.md 1.3節の「Aさんのカードで
 * 1,000円の食事(本来はA・B折半)をし、後からBさんに500円分を割勘する」例の通りに、
 * 費用付け替え2行+立替金資産/負債2行から成る4行仕訳を組み立てられることと、
 * 元仕訳へのallocatesリンクが仕訳作成と同一のCreateJournalEntryInput.linksに含まれることを
 * 検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from './buildHouseholdMemberExpenseSplittingJournalEntryInput'

const EXPENSE_ACCOUNT_ID = 1 // 食費
const ADVANCE_ASSET_ACCOUNT_ID = 10 // 資産・立替金
const ADVANCE_LIABILITY_ACCOUNT_ID = 11 // 負債・立替金
const MEMBER_A = 100
const MEMBER_B = 200
const PROJECT_ID = 26 // 26/7生活費割勘
const ORIGINAL_ENTRY_ID = 999

describe('buildHouseholdMemberExpenseSplittingJournalEntryInput', () => {
  it('1.3節の例(A・Bの折半)通りに、費用付け替え2行+立替金資産/負債2行の4行仕訳を組み立てる', () => {
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.entryDate).toBe('2026-07-15')
    expect(input.lines).toEqual([
      {
        accountId: EXPENSE_ACCOUNT_ID,
        householdMemberId: MEMBER_B,
        side: 'debit',
        amount: 500,
      },
      {
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: MEMBER_A,
        projectId: PROJECT_ID,
        side: 'debit',
        amount: 500,
      },
      {
        accountId: EXPENSE_ACCOUNT_ID,
        householdMemberId: MEMBER_A,
        side: 'credit',
        amount: 500,
      },
      {
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: MEMBER_B,
        projectId: PROJECT_ID,
        side: 'credit',
        amount: 500,
      },
    ])
  })

  it('元仕訳へのallocatesリンクを、仕訳作成と同一トランザクションで書き込めるようlinksに含める', () => {
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.links).toEqual([
      { toEntryId: ORIGINAL_ENTRY_ID, linkType: 'allocates', amount: 500 },
    ])
  })

  it('memoを渡した場合はそのままentryのmemoに使われる', () => {
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
      memo: '26/7生活費割勘',
    })

    expect(input.memo).toBe('26/7生活費割勘')
  })

  it('生成した仕訳は貸借バランスの検証(assertJournalBalance)を通過する', async () => {
    const { assertJournalBalance } = await import('../journal/assertJournalBalance')
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(() => assertJournalBalance(input.lines)).not.toThrow()
  })
})
