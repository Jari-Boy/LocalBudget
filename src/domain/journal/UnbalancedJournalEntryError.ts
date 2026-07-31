/**
 * 仕訳明細の借方合計と貸方合計が一致しない場合、または明細が2件未満で仕訳として
 * 成立しない場合にスローされるドメインエラー(docs/domain/journal.md 1.1, 1.3)。
 * 呼び出し側はinstanceofで判定できる。メッセージは省略時、debitTotal/creditTotalから
 * 貸借不一致を表す文言を組み立てるが、明細数不足など別の理由の場合は呼び出し側が
 * 専用のメッセージを渡すことでその原因を明示できる。
 */
export class UnbalancedJournalEntryError extends Error {
  readonly debitTotal: number
  readonly creditTotal: number

  constructor(debitTotal: number, creditTotal: number, message?: string) {
    super(message ?? `journal entry is unbalanced: debit=${debitTotal}, credit=${creditTotal}`)
    this.name = 'UnbalancedJournalEntryError'
    this.debitTotal = debitTotal
    this.creditTotal = creditTotal
  }
}
