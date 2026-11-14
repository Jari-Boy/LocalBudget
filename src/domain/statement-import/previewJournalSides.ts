import type { AccountCategory } from '../account/Account'

export interface PreviewJournalSides {
  /** 取込先の科目が仕訳のどちら側に入るか(相手科目は取込時に決まるので反対側に「任意の科目」が入る) */
  accountSide: 'debit' | 'credit'
  /** 仕訳の金額(絶対値) */
  amount: number
}

/** 残高が増える側が借方になる科目の種別(資産・費用)。それ以外(負債・純資産・収益)は貸方 */
const DEBIT_NORMAL: ReadonlySet<AccountCategory> = new Set(['asset', 'expense'])

/**
 * マッピング編集のプレビューで、変換後の金額(正 = 科目の残高が増える、
 * docs/domain/statement-import.md 1.2)から、取込先の科目が仕訳の借方・貸方のどちらに入るかと
 * 金額を決める(計画Issue #192)。資産はプラスが借方、負債(クレジットカード)はプラスが貸方。
 */
export function previewJournalSides(amount: number, category: AccountCategory): PreviewJournalSides {
  const increases = amount >= 0
  const debitNormal = DEBIT_NORMAL.has(category)
  return { accountSide: increases === debitNormal ? 'debit' : 'credit', amount: Math.abs(amount) }
}
