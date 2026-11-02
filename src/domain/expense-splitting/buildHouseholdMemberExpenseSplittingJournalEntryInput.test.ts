/**
 * buildHouseholdMemberExpenseSplittingJournalEntryInput(世帯メンバー間の割勘仕訳の組み立て)の
 * 純粋関数としてのユニットテスト。docs/domain/expense-splitting.md 1.3節の「Aさんのカードで
 * 1,000円の食事(本来はA・B折半)をし、後からBさんに500円分を割勘する」例の通りに、
 * 費用付け替え2行+立替金資産/負債2行から成る4行仕訳を組み立てられることと、
 * 元仕訳の費用行へのallocatesリンク(割勘仕訳の費用の貸方行から張る、計画Issue #132)が
 * 仕訳作成と同一のCreateJournalEntryInput.linksに含まれることを検証する。
 * 計画Issue #133により、立替金行のタグはproject_id(精算バッチ)からsettlementBatchIdに変わり、
 * 費用行には元仕訳のproject_id(イベント)が引き継がれることも検証する。DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildHouseholdMemberExpenseSplittingJournalEntryInput } from './buildHouseholdMemberExpenseSplittingJournalEntryInput'

const EXPENSE_ACCOUNT_ID = 1 // 食費
const ADVANCE_ASSET_ACCOUNT_ID = 10 // 資産・立替金
const ADVANCE_LIABILITY_ACCOUNT_ID = 11 // 負債・立替金
const MEMBER_A = 100
const MEMBER_B = 200
const SETTLEMENT_BATCH_ID = 26 // 6月生活費
const ORIGINAL_LINE_ID = 999 // 元仕訳の費用行のid

describe('buildHouseholdMemberExpenseSplittingJournalEntryInput', () => {
  it('1.3節の例(A・Bの折半)通りに、費用付け替え2行+立替金資産/負債2行の4行仕訳を組み立てる', () => {
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.entryDate).toBe('2026-07-15')
    expect(input.householdMemberId).toBe(MEMBER_A)
    expect(input.lines).toEqual([
      {
        accountId: EXPENSE_ACCOUNT_ID,
        householdMemberId: MEMBER_B,
        projectId: null,
        side: 'debit',
        amount: 500,
      },
      {
        accountId: ADVANCE_ASSET_ACCOUNT_ID,
        householdMemberId: MEMBER_A,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'debit',
        amount: 500,
      },
      {
        accountId: EXPENSE_ACCOUNT_ID,
        householdMemberId: MEMBER_A,
        projectId: null,
        side: 'credit',
        amount: 500,
      },
      {
        accountId: ADVANCE_LIABILITY_ACCOUNT_ID,
        householdMemberId: MEMBER_B,
        settlementBatchId: SETTLEMENT_BATCH_ID,
        side: 'credit',
        amount: 500,
      },
    ])
  })

  it('eventProjectIdを渡すと、費用付け替えの2行(lines[0]・lines[2])にのみ引き継がれる(計画Issue #133、イベント別PL過大バグの解消)', () => {
    const EVENT_PROJECT_ID = 77 // 26年7月アメリカ旅行
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      eventProjectId: EVENT_PROJECT_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.lines[0]).toMatchObject({ accountId: EXPENSE_ACCOUNT_ID, projectId: EVENT_PROJECT_ID })
    expect(input.lines[2]).toMatchObject({ accountId: EXPENSE_ACCOUNT_ID, projectId: EVENT_PROJECT_ID })
    expect(input.lines[1]).not.toHaveProperty('projectId')
    expect(input.lines[3]).not.toHaveProperty('projectId')
    expect(input.lines[1]).toMatchObject({ settlementBatchId: SETTLEMENT_BATCH_ID })
    expect(input.lines[3]).toMatchObject({ settlementBatchId: SETTLEMENT_BATCH_ID })
  })

  it('費用を付け替える貸方行(4行目の手前=lines[2])から元仕訳の費用行へのallocatesリンクを、仕訳作成と同一トランザクションで書き込めるようlinksに含める', () => {
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(input.links).toEqual([
      { fromLineIndex: 2, toLineId: ORIGINAL_LINE_ID, linkType: 'allocates', amount: 500 },
    ])
    // from_lineは元の費用行と科目が同じ・貸借が逆(費用の貸方)になっている
    expect(input.lines[2]).toMatchObject({ accountId: EXPENSE_ACCOUNT_ID, side: 'credit' })
  })

  it('memoを渡した場合はそのままentryのmemoに使われる', () => {
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      amount: 500,
      entryDate: '2026-07-15',
      memo: '26/7生活費割勘',
    })

    expect(input.memo).toBe('26/7生活費割勘')
  })

  it('生成した仕訳は貸借バランスの検証(assertJournalBalance)を通過する', async () => {
    const { assertJournalBalance } = await import('../journal/assertJournalBalance')
    const input = buildHouseholdMemberExpenseSplittingJournalEntryInput({
      originalLineId: ORIGINAL_LINE_ID,
      expenseAccountId: EXPENSE_ACCOUNT_ID,
      advanceAssetAccountId: ADVANCE_ASSET_ACCOUNT_ID,
      advanceLiabilityAccountId: ADVANCE_LIABILITY_ACCOUNT_ID,
      fromMemberId: MEMBER_A,
      toMemberId: MEMBER_B,
      settlementBatchId: SETTLEMENT_BATCH_ID,
      amount: 500,
      entryDate: '2026-07-15',
    })

    expect(() => assertJournalBalance(input.lines)).not.toThrow()
  })
})
