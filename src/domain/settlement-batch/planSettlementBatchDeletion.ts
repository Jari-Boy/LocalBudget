import type { JournalEntry } from '../journal/JournalEntry'

export interface SettlementBatchDeletionPlan {
  /** アプリが作った割勘仕訳だけでバッチが成り立っていて、削除できるか */
  deletable: boolean
  /** バッチと一緒に削除する割勘仕訳のid。削除できないときは空 */
  splitEntryIds: number[]
}

/**
 * 精算バッチを、アプリが作った割勘仕訳ごと削除できるかを決める(計画Issue #153)。バッチのタグが
 * 付いた仕訳がすべて割勘仕訳(expense_splitting)なら削除でき、削除するのはその割勘仕訳だけで、
 * 元の支出の仕訳は触らない。精算で紐づけた既存の仕訳(明細取込の入出金など)や、精算の仕訳・差額の
 * 仕訳が1件でもあれば、精算が進んでいるものとして削除できない(実際の取引の記録を消さないため)。
 * 明細の無い空のバッチは、削除する仕訳が無いまま削除できる。DB非依存の純粋関数。
 */
export function planSettlementBatchDeletion(batchId: number, entries: readonly JournalEntry[]): SettlementBatchDeletionPlan {
  const tagged = entries.filter((e) => e.lines.some((l) => l.settlementBatchId === batchId))
  if (tagged.some((e) => e.sourceType !== 'expense_splitting')) return { deletable: false, splitEntryIds: [] }
  return { deletable: true, splitEntryIds: tagged.map((e) => e.id) }
}
