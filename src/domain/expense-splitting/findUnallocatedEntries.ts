import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import { isExpenseSplitEntry } from './isExpenseSplitEntry'

/**
 * 割勘対象候補の絞り込み(docs/domain/expense-splitting.md 1.5節)。journal_entry_links
 * (計画Issue #132)のallocatesリンクによる絞り込みは計画Issue #138で廃止され、関連仕訳グループ
 * (表示専用の多対多グルーピング)+科目構成による分類(isExpenseSplitEntry)に置き換わった。
 * 対象の仕訳が次のいずれにも当たらないものだけを返す。
 *
 * - 仕訳自身が割勘仕訳である(isExpenseSplitEntryがtrue): 「割勘の割勘」という意味のない
 *   状態を防ぐ(人間レビューでの指摘、計画Issue #40)
 * - 関連仕訳グループで繋がる仕訳の中に割勘仕訳が存在する: 「既に割勘済み」の元仕訳を
 *   候補一覧から除外する(割勘・精算の仕訳作成時に自動的に同一グループへ所属することを
 *   前提にした判定)
 *
 * 割勘対象の仕訳選択UIで、この絞り込みを通過した仕訳だけを候補として使う。
 * DBアクセスなしの純粋関数。
 */
export function findUnallocatedEntries(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  relatedEntryIdsByEntryId: ReadonlyMap<number, ReadonlySet<number>>,
): JournalEntry[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))

  return entries.filter((entry) => {
    if (isExpenseSplitEntry(entry, accounts)) return false

    const relatedIds = relatedEntryIdsByEntryId.get(entry.id) ?? new Set<number>()
    const alreadySplit = [...relatedIds].some((id) => {
      const related = entriesById.get(id)
      return related !== undefined && isExpenseSplitEntry(related, accounts)
    })
    return !alreadySplit
  })
}
