/**
 * buildBalanceAdjustmentJournalEntryInput(残高調整仕訳の生成)の純粋関数としてのユニットテスト。
 * docs/domain/financial-statements.md 1.2の「帳簿残高が外部残高より大きければ資産を貸方に、
 * 小さければ資産を借方に」という過不足の向きに応じた借方/貸方の決定と、
 * docs/domain/reconciliation.md 1.6のsource_type='balance_adjustment'を検証する。
 * DB非依存、外部依存なし。
 */
import { describe, expect, it } from 'vitest'
import { buildBalanceAdjustmentJournalEntryInput } from './buildBalanceAdjustmentJournalEntryInput'
import { NoBalanceDiscrepancyError } from './NoBalanceDiscrepancyError'

describe('buildBalanceAdjustmentJournalEntryInput', () => {
  it('帳簿残高が外部残高より大きい(超過)場合は資産を貸方に、費用・残高調整を借方に減額計上する', () => {
    // 帳簿10,000円、実際9,200円(financial-statements.md 1.2の例)
    const input = buildBalanceAdjustmentJournalEntryInput({
      targetAccountId: 1,
      adjustmentAccountId: 99,
      bookBalance: 10000,
      externalBalance: 9200,
      entryDate: '2026-08-01',
    })

    expect(input.sourceType).toBe('balance_adjustment')
    expect(input.entryDate).toBe('2026-08-01')
    expect(input.lines).toEqual([
      { accountId: 99, side: 'debit', amount: 800 },
      { accountId: 1, side: 'credit', amount: 800 },
    ])
  })

  it('帳簿残高が外部残高より小さい(不足)場合は資産を借方に、費用・残高調整を貸方に増額計上する', () => {
    // 帳簿300円不足していたケース(financial-statements.md 1.2の例)
    const input = buildBalanceAdjustmentJournalEntryInput({
      targetAccountId: 1,
      adjustmentAccountId: 99,
      bookBalance: 9700,
      externalBalance: 10000,
      entryDate: '2026-08-01',
    })

    expect(input.lines).toEqual([
      { accountId: 1, side: 'debit', amount: 300 },
      { accountId: 99, side: 'credit', amount: 300 },
    ])
  })

  it('memoを渡した場合はそのままentryのmemoに使われる', () => {
    const input = buildBalanceAdjustmentJournalEntryInput({
      targetAccountId: 1,
      adjustmentAccountId: 99,
      bookBalance: 10000,
      externalBalance: 9200,
      entryDate: '2026-08-01',
      memo: '原因不明差異の確定',
    })

    expect(input.memo).toBe('原因不明差異の確定')
  })

  it('帳簿残高と外部残高が一致している場合はNoBalanceDiscrepancyErrorをスローする', () => {
    expect(() =>
      buildBalanceAdjustmentJournalEntryInput({
        targetAccountId: 1,
        adjustmentAccountId: 99,
        bookBalance: 10000,
        externalBalance: 10000,
        entryDate: '2026-08-01',
      }),
    ).toThrow(NoBalanceDiscrepancyError)
  })

  it('生成した仕訳は貸借バランスの検証(assertJournalBalance)を通過する', async () => {
    const { assertJournalBalance } = await import('../journal/assertJournalBalance')
    const input = buildBalanceAdjustmentJournalEntryInput({
      targetAccountId: 1,
      adjustmentAccountId: 99,
      bookBalance: 10000,
      externalBalance: 9200,
      entryDate: '2026-08-01',
    })

    expect(() => assertJournalBalance(input.lines)).not.toThrow()
  })
})
