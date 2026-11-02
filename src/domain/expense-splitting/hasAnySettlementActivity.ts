import type { Account } from '../account/Account'
import type { JournalEntry, JournalLine } from '../journal/JournalEntry'

/**
 * 割勘仕訳に対して何らかの精算操作が行われたかどうかを判定する(JournalEntryDetailScreenの
 * 取り消し導線向け、計画Issue #133)。isExpenseSplittingEntrySettled(全ての一時勘定行の残高が
 * ゼロになって初めて「精算済み」とみなす、履歴画面向けの厳密な判定)とは異なり、こちらは
 * 「少なくとも1件の精算操作が行われたか」を判定する。精算が一部でも進んだ割勘仕訳を物理削除
 * すると、既に起票済みの精算仕訳が参照先を失い整合性が崩れるため、一部でも精算が進んでいれば
 * 取り消しを禁止し返金案内に切り替える(journal_entry_linksのsettlesリンクが1件でも存在すれば
 * 精算済み扱いとしていた旧実装の挙動を、settlement_batch_idタグの集計方式で再現する)。
 *
 * 判定は「このタグの残高集計値が動いているか」ではなく、「自分自身以外の仕訳から、この
 * タグに対して残高を減少させる向き(精算側)の行が存在するか」で行う(evaluatorレビューで
 * 指摘された回帰の修正: 精算バッチは既存バッチへ複数の割勘仕訳を追記できる設計のため、
 * 単純な残高集計の差分比較では、精算が一度も行われていなくても同じタグを持つ別の
 * 未精算の割勘仕訳が存在するだけで誤って「精算済み」と判定してしまっていた)。割勘仕訳
 * (splitEntry)自身の一時勘定行は常に残高を増加させる向きで作られる(buildExpenseSplitting
 * JournalEntryInput*参照)ため、減少させる向きの行が他の仕訳に存在すれば、それは精算仕訳
 * (buildSettlementJournalEntryInput)に由来するとみなせる。DBアクセスなしの純粋関数。
 */
export function hasAnySettlementActivity(
  splitEntry: JournalEntry,
  accounts: readonly Account[],
  allLines: readonly JournalLine[],
): boolean {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))

  const advanceLines = splitEntry.lines.filter((line) => {
    const account = accountsById.get(line.accountId)
    return (
      account?.isSystemManaged === true && (account.category === 'asset' || account.category === 'liability')
    )
  })

  return advanceLines.some((line) => {
    if (line.settlementBatchId === null) return false
    const category = accountsById.get(line.accountId)!.category as 'asset' | 'liability'
    const decreasingSide = category === 'asset' ? 'credit' : 'debit'
    return allLines.some(
      (candidate) =>
        candidate.journalEntryId !== splitEntry.id &&
        candidate.settlementBatchId === line.settlementBatchId &&
        candidate.accountId === line.accountId &&
        candidate.householdMemberId === line.householdMemberId &&
        candidate.counterpartyId === line.counterpartyId &&
        candidate.side === decreasingSide,
    )
  })
}
