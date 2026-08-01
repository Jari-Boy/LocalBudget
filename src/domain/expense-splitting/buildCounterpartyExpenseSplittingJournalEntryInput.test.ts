/**
 * buildCounterpartyExpenseSplittingJournalEntryInput(世帯外の相手との割勘仕訳の組み立て)の
 * 純粋関数としてのユニットテスト。docs/domain/expense-splitting.md 1.4節の「Aさんのカードで
 * 1,000円の食事(本来は友人Bさんと折半)をし、Bさんから500円を受け取る予定」例の通りに、
 * 立替金資産1行+費用(counterparty_id付き)1行から成る2行仕訳を組み立てられることと、
 * 負債側の立替金は発生しないこと、元仕訳へのallocatesリンクがlinksに含まれることを検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildCounterpartyExpenseSplittingJournalEntryInput } from './buildCounterpartyExpenseSplittingJournalEntryInput'

const EXPENSE_ACCOUNT_ID = 1 // 食費
const ADVANCE_ASSET_ACCOUNT_ID = 10 // 資産・立替金
const MEMBER_A = 100
const FRIEND_COUNTERPARTY_ID = 300 // 友人Bさん
const PROJECT_ID = 26 // 26/7生活費割勘
const ORIGINAL_ENTRY_ID = 999

describe('buildCounterpartyExpenseSplittingJournalEntryInput', () => {
  it('1.4節の例(世帯外の友人との割勘)通りに、立替金資産1行+費用(counterparty_id付き)1行の2行仕訳を組み立てる', () => {
    const input = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.entryDate).toBe('2026-07-15')
    expect(input.lines).toEqual([
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
        counterpartyId: FRIEND_COUNTERPARTY_ID,
        side: 'credit',
        amount: 500,
      },
    ])
  })

  it('負債側の立替金(advanceLiabilityAccountId相当)は行として発生しない', () => {
    const input = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.lines).toHaveLength(2)
  })

  it('元仕訳へのallocatesリンクを、仕訳作成と同一トランザクションで書き込めるようlinksに含める', () => {
    const input = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.links).toEqual([
      { toEntryId: ORIGINAL_ENTRY_ID, linkType: 'allocates', amount: 500 },
    ])
  })

  it('memoを渡した場合はそのままentryのmemoに使われる', () => {
    const input = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
      memo: '友人Bさんとの食事代割勘',
    })

    expect(input.memo).toBe('友人Bさんとの食事代割勘')
  })

  it('生成した仕訳は貸借バランスの検証(assertJournalBalance)を通過する', async () => {
    const { assertJournalBalance } = await import('../journal/assertJournalBalance')
    const input = buildCounterpartyExpenseSplittingJournalEntryInput({
      originalEntryId: ORIGINAL_ENTRY_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      payerMemberId: MEMBER_A,
      counterpartyId: FRIEND_COUNTERPARTY_ID,
      projectId: PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(() => assertJournalBalance(input.lines)).not.toThrow()
  })
})
