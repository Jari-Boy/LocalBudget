import type { JournalEntry } from '../journal/JournalEntry'

export type CreateRuleFromEntryCheck = { allowed: true } | { allowed: false; reason: string }

/**
 * 仕訳から定期仕訳を作れるかを判定する純粋関数(計画Issue #180、仕訳の詳細パネルの「定期仕訳にする」)。
 * 繰り返すものではない仕訳は作れない: 割勘(精算バッチに紐づく一回きりの精算)、初期残高・残高調整
 * (システムが作る仕訳)。手入力・外部明細取込・定期仕訳から生成した仕訳は作れる。
 */
export function canCreateRuleFromEntry(entry: Pick<JournalEntry, 'sourceType'>): CreateRuleFromEntryCheck {
  switch (entry.sourceType) {
    case 'expense_splitting':
      return { allowed: false, reason: '割勘の仕訳は一回きりの精算のため、定期仕訳にできません' }
    case 'initial_balance':
    case 'balance_adjustment':
      return { allowed: false, reason: '初期残高・残高調整の仕訳は、定期仕訳にできません' }
    default:
      return { allowed: true }
  }
}
