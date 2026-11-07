import type { Account } from '../account/Account'
import type { JournalEntry } from '../journal/JournalEntry'
import type { JournalEntryFilter, JournalEntryFilterContext } from '../journal/JournalEntryFilter'
import { filterJournalEntries } from '../journal/filterJournalEntries'
import type { SettlementTarget } from '../settlement-batch/SettlementTarget'

export interface UnassignedAdvanceEntryCandidate {
  entry: JournalEntry
  lineId: number
  amount: number
}

/** 候補に重ねる検索条件(計画Issue #145)。filterJournalEntriesと同じ条件・マスタを受け取る */
export interface UnassignedAdvanceEntrySearch {
  filter: JournalEntryFilter
  accounts: readonly Account[]
  context?: JournalEntryFilterContext
}

/**
 * 精算画面(計画Issue #139)の「消込む仕訳を選ぶ」候補一覧を組み立てる純粋関数。候補は、対象の
 * 科目でsettlement_batch_idが未設定(null)の明細行を持つ仕訳(CSV取込等で既に起票済みだが、まだ
 * どの精算バッチにも割り当てられていないもの)。
 *
 * 対象者が世帯メンバーの場合はhousehold_member_idが対象者と厳密に一致する行だけに絞る(割勘仕訳の
 * 立替金行が明示的にhousehold_member_idを持つのと同じ考え方)。対象者が取引先の場合、
 * journal_lines.counterparty_idは資産・負債の行に設定できない(docs/domain/counterparties.md 1.2)
 * ため、未割当の行に「この取引先向け」という印を明細行自体に残す手段がない。そのため
 * household_member_idがnull(特定の世帯メンバーの支出として明細側で上書きされていない)の行を
 * 候補とする設計を採用した(計画Issue #139の懸念点「候補仕訳の検索条件の具体的なクエリ実装は
 * 実装時に設計する」への対応、詳細はdocs/decisions.md参照)。この設計では、取引日・相手科目・
 * 金額といった他の情報を手掛かりに、ユーザーが候補一覧から正しい仕訳を選ぶことを前提とする。
 *
 * 「対象の科目かつ対象者」は同じ明細行で満たす固定条件であり、検索条件(searchのfilter)では
 * 置き換えられない(計画Issue #145)。検索条件は仕訳全体で判定する(複数の条件を別々の明細行で
 * 満たしてもヒットする)ため、行単位のこの固定条件とは別に、先に仕訳を絞り込む形で重ねる。
 * 精算の候補は`filterJournalEntries`を直接は使わず、この関数が固定条件と検索条件を組み合わせる。
 *
 * 結果は取引日の昇順に並べ替える。DBアクセスなしの純粋関数。
 */
export function findUnassignedAdvanceEntriesForTarget(
  entries: readonly JournalEntry[],
  accountId: number,
  target: SettlementTarget,
  search?: UnassignedAdvanceEntrySearch,
): UnassignedAdvanceEntryCandidate[] {
  const result: UnassignedAdvanceEntryCandidate[] = []
  const searched = search ? filterJournalEntries(entries, search.accounts, search.filter, search.context) : entries

  for (const entry of searched) {
    for (const line of entry.lines) {
      if (line.accountId !== accountId || line.settlementBatchId !== null) continue
      const matches =
        target.kind === 'householdMember' ? line.householdMemberId === target.householdMemberId : line.householdMemberId === null
      if (!matches) continue
      result.push({ entry, lineId: line.id, amount: line.amount })
    }
  }

  return result.sort((a, b) => a.entry.entryDate.localeCompare(b.entry.entryDate))
}
