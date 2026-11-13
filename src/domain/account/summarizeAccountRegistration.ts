import type { JournalEntry } from '../journal/JournalEntry'
import type { Account } from './Account'

/** 資産・負債科目の「登録時の設定」(計画Issue #189)。画面には表示のみで、あとから変更しない */
export interface AccountRegistrationSummary {
  /**
   * 残高情報の有無。is_reconcilableがtrue(外部明細あり かつ 残高情報あり)のときだけtrue。
   * falseは「外部明細あり・残高情報なし」と「外部明細なし」を区別できないため、外部明細の
   * 有無はここでは断定しない(docs/domain/accounts.md 4.2)
   */
  hasBalanceInfo: boolean
  /** 初期残高(source_type='initial_balance'の仕訳から求める)。登録時に入力しなかった科目はnull */
  initialBalance: { amount: number; date: string } | null
}

/**
 * 資産・負債科目の登録時の設定を、科目と仕訳から求める。資産・負債以外はnull(対象外)。
 * 初期残高の金額は、その科目の自然な側(資産=借方、負債=貸方)の明細行の合計。
 */
export function summarizeAccountRegistration(
  account: Account,
  entries: readonly JournalEntry[],
): AccountRegistrationSummary | null {
  if (account.category !== 'asset' && account.category !== 'liability') return null

  const naturalSide = account.category === 'asset' ? 'debit' : 'credit'
  let total = 0
  let date: string | null = null
  for (const entry of entries) {
    if (entry.sourceType !== 'initial_balance') continue
    const amount = entry.lines
      .filter((l) => l.accountId === account.id && l.side === naturalSide)
      .reduce((sum, l) => sum + l.amount, 0)
    if (amount === 0) continue
    total += amount
    date = entry.entryDate
  }

  return {
    hasBalanceInfo: account.isReconcilable === true,
    initialBalance: date === null ? null : { amount: total, date },
  }
}
