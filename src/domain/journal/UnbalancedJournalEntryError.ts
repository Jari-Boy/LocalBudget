/**
 * 仕訳明細の借方合計と貸方合計が一致しない場合にスローされるドメインエラー
 * (docs/domain/journal.md 1.3)。呼び出し側はinstanceofで判定できる。
 */
export class UnbalancedJournalEntryError extends Error {
  readonly debitTotal: number
  readonly creditTotal: number

  constructor(debitTotal: number, creditTotal: number) {
    super(`journal entry is unbalanced: debit=${debitTotal}, credit=${creditTotal}`)
    this.name = 'UnbalancedJournalEntryError'
    this.debitTotal = debitTotal
    this.creditTotal = creditTotal
  }
}
