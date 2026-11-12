import type { JournalLineSide } from '../journal/JournalEntry'
import type { RecurringTransactionRuleLine } from './RecurringTransactionRule'

/** 前回確定した仕訳の明細行(対応づけに必要な項目だけ) */
export interface LastConfirmedLine {
  accountId: number
  side: JournalLineSide
  amount: number
}

/**
 * 金額の初期値が「前回確定額」のルールの、行ごとの金額を決める純粋関数(計画Issue #180)。
 * ルールの行と前回の仕訳の行を、科目と借方/貸方の組で対応づけ、一致した行は前回の金額を引き継ぐ。
 * 一致しない行はルールの金額を使う(1回だけ手で足した行が次回に紛れ込まないため)。同じ科目・同じ側の
 * 行が複数あるときは、出現順に1対1で対応づける。金額以外の項目は変えない。
 */
export function resolveLastConfirmedLines(
  ruleLines: readonly RecurringTransactionRuleLine[],
  lastConfirmedLines: readonly LastConfirmedLine[],
): RecurringTransactionRuleLine[] {
  const remaining = [...lastConfirmedLines]
  return ruleLines.map((line) => {
    const index = remaining.findIndex((last) => last.accountId === line.accountId && last.side === line.side)
    if (index === -1) return { ...line }
    const [matched] = remaining.splice(index, 1)
    return { ...line, amount: matched.amount }
  })
}
