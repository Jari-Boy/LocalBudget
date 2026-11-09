import type { Account } from '../account/Account'
import type { JournalEntry, JournalLineSide } from '../journal/JournalEntry'
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
 * household_member_idが対象者と厳密に一致する行だけに絞る(割勘仕訳の立替金行が明示的に
 * household_member_idを持つのと同じ考え方)。明細行は常に世帯メンバーを持つため(計画Issue #169)、
 * 世帯外の相手(取引先)のバッチの精算でも、対象者は世帯メンバーである。
 * 取引日・相手科目・金額といった他の情報を手掛かりに、ユーザーが候補一覧から正しい仕訳を選ぶ。
 *
 * 「対象の科目かつ対象者」は同じ明細行で満たす固定条件であり、検索条件(searchのfilter)では
 * 置き換えられない(計画Issue #145)。検索条件は仕訳全体で判定する(複数の条件を別々の明細行で
 * 満たしてもヒットする)ため、行単位のこの固定条件とは別に、先に仕訳を絞り込む形で重ねる。
 * 精算の候補は`filterJournalEntries`を直接は使わず、この関数が固定条件と検索条件を組み合わせる。
 *
 * sideを渡すと、方向(貸借)も同じ行で満たす固定条件に加える(計画Issue #153)。立替金を減らす精算は
 * 立替金の貸方、未払金を減らす精算は未払金の借方の行が候補になる。省略時は方向で絞り込まない。
 *
 * 結果は取引日の昇順に並べ替える。DBアクセスなしの純粋関数。
 */
export function findUnassignedAdvanceEntriesForTarget(
  entries: readonly JournalEntry[],
  accountId: number,
  target: SettlementTarget,
  search?: UnassignedAdvanceEntrySearch,
  side?: JournalLineSide,
): UnassignedAdvanceEntryCandidate[] {
  const result: UnassignedAdvanceEntryCandidate[] = []
  const searched = search ? filterJournalEntries(entries, search.accounts, search.filter, search.context) : entries

  for (const entry of searched) {
    for (const line of entry.lines) {
      if (line.accountId !== accountId || line.settlementBatchId !== null) continue
      if (side !== undefined && line.side !== side) continue
      if (line.householdMemberId !== target.householdMemberId) continue
      result.push({ entry, lineId: line.id, amount: line.amount })
    }
  }

  return result.sort((a, b) => a.entry.entryDate.localeCompare(b.entry.entryDate))
}
