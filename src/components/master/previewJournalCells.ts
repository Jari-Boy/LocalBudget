import type { AccountCategory } from '../../domain/account/Account'
import { previewJournalSides } from '../../domain/statement-import/previewJournalSides'

export interface PreviewJournalCells {
  /** 借方の欄に出す「科目名 金額」 */
  debit: string
  /** 貸方の欄に出す「科目名 金額」 */
  credit: string
}

/**
 * マッピング編集のプレビューで、借方・貸方の欄に出す文字列を作る(計画Issue #192)。
 * 取込先の科目が入る側(previewJournalSides)にその科目名、反対側に相手科目として anyAccountLabel
 * (取込時に決まるため「任意の科目」)を、同じ金額(絶対値)で並べる。
 */
export function previewJournalCells(
  amount: number,
  account: { name: string; category: AccountCategory },
  anyAccountLabel: string,
): PreviewJournalCells {
  const { accountSide, amount: absolute } = previewJournalSides(amount, account.category)
  const yen = `¥${absolute.toLocaleString('ja-JP')}`
  const own = `${account.name} ${yen}`
  const counter = `${anyAccountLabel} ${yen}`
  return accountSide === 'debit' ? { debit: own, credit: counter } : { debit: counter, credit: own }
}
