/**
 * previewImportReconciliation の単体テスト(外部依存なしの純粋関数)。
 *
 * 検証対象: 明細取込画面で、取り込む前に「この取込を確定すると、基準点(取引後残高)に合わせて
 * どの区間にいくらの自動調整が入るか」を求める(計画Issue #205、旧「最後の行の残高と全帳簿の比較」の置き換え)。
 * 既存の明細の基準点と帳簿に、今回取り込む行を加えて planBalanceAnchorAdjustments で計算する。
 * 古いCSVでも、帳簿は各基準点の日までで比べるため偽陽性が出ない。
 */
import { describe, expect, it } from 'vitest'
import { previewImportReconciliation } from './previewImportReconciliation'

const base = {
  autoAdjust: true,
  existingLines: [],
  existingRefs: [],
  replacedEntryIds: new Set<number>(),
}

describe('previewImportReconciliation', () => {
  it('取り込む行の残高と帳簿が一致していれば、区間の調整は入らない', () => {
    const result = previewImportReconciliation({
      ...base,
      newRows: [
        { entryDate: '2026-02-10', amount: 1000, balanceAfter: 11000, rowOrder: 0 },
        { entryDate: '2026-02-11', amount: -500, balanceAfter: 10500, rowOrder: 1 },
      ],
      existingLines: [{ journalEntryId: 1, entryDate: '2026-02-01', side: 'debit', amount: 10000, sourceType: 'manual' }],
    })

    expect(result.gaps).toEqual([])
  })

  it('降順のCSVでも並び順を判定し、最初の基準点(取り込み開始直前の残高)との差額は元手になる', () => {
    const result = previewImportReconciliation({
      ...base,
      // 降順: 新しい行が先。基準点は 2/9=10000, 2/10=11000, 2/11=10500
      newRows: [
        { entryDate: '2026-02-11', amount: -500, balanceAfter: 10500, rowOrder: 0 },
        { entryDate: '2026-02-10', amount: 1000, balanceAfter: 11000, rowOrder: 1 },
      ],
      existingLines: [{ journalEntryId: 1, entryDate: '2026-02-01', side: 'debit', amount: 9000, sourceType: 'manual' }],
    })

    // 2/9 の基準点 10000 に対し帳簿は 9000 → 元手 1000。その後の区間に食い違いは無い
    expect(result.gaps).toEqual([])
    expect(result.capital).toMatchObject({ kind: 'capital', amount: 1000 })
  })

  it('基準点の間で帳簿が足りない区間は、その期間と調整額を gaps に返す', () => {
    const result = previewImportReconciliation({
      ...base,
      newRows: [
        { entryDate: '2026-02-10', amount: 1000, balanceAfter: 11000, rowOrder: 0 },
        // 途中の入金 300 が取り込まれていない(残高は 11000 → 11500 だが、この間の行は 200 だけ)
        { entryDate: '2026-02-20', amount: 200, balanceAfter: 11500, rowOrder: 1 },
      ],
    })

    expect(result.gaps).toEqual([
      { periodStart: '2026-02-11', periodEnd: '2026-02-20', amount: 300, bookBalance: 11200 },
    ])
  })

  it('自動調整をオフにした科目では、同じずれを adjusted=false として返す', () => {
    const result = previewImportReconciliation({
      ...base,
      autoAdjust: false,
      newRows: [
        { entryDate: '2026-02-10', amount: 1000, balanceAfter: 11000, rowOrder: 0 },
        { entryDate: '2026-02-20', amount: 200, balanceAfter: 11500, rowOrder: 1 },
      ],
    })

    expect(result.gaps).toHaveLength(1)
    expect(result.adjusted).toBe(false)
  })

  it('確定版として置き換える旧仕訳は、帳簿と基準点から除く', () => {
    const result = previewImportReconciliation({
      ...base,
      replacedEntryIds: new Set([7]),
      existingLines: [{ journalEntryId: 7, entryDate: '2026-02-10', side: 'debit', amount: 1000, sourceType: 'external_import' }],
      existingRefs: [
        { id: 1, journalEntryId: 7, entryDate: '2026-02-10', amount: 1000, externalBalanceAfter: 11000, rowOrder: 0, importedAt: 'old' },
      ],
      newRows: [{ entryDate: '2026-02-10', amount: 1000, balanceAfter: 11000, rowOrder: 0 }],
    })

    expect(result.gaps).toEqual([])
  })

  it('自動調整仕訳の明細は帳簿に数えない(導出データのため)', () => {
    const result = previewImportReconciliation({
      ...base,
      existingLines: [
        { journalEntryId: 1, entryDate: '2026-02-01', side: 'debit', amount: 10000, sourceType: 'auto_balance_adjustment' },
      ],
      newRows: [{ entryDate: '2026-02-10', amount: 1000, balanceAfter: 11000, rowOrder: 0 }],
    })

    // 帳簿は 0(自動調整は除外)。取り込み開始直前の基準点 10000 との差が元手になる
    expect(result.capital).toMatchObject({ amount: 10000 })
  })
})
