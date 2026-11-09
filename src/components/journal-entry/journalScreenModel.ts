import type { Account } from '../../domain/account/Account'
import { isDescendantGroup, type GroupNode } from '../../domain/account-group/isDescendantGroup'
import type { ExpenseSplitBlockReason } from '../../domain/expense-splitting/checkExpenseSplittability'
import type { JournalEntry, JournalEntrySourceType } from '../../domain/journal/JournalEntry'
import type { JournalEntryFilter } from '../../domain/journal/JournalEntryFilter'
import { summarizeSide, type JournalResultItem } from '../common/journal-result/journalResultModel'
import type { JournalEntryFormLine } from './journalEntryFormLine'
import { calculateJournalLineTotals } from './journalLineTotals'

/**
 * 仕訳画面(計画Issue #152)の表示ロジックを集めた純粋関数。DB・DOM非依存。
 * 貸借の合計と保存できない理由、割勘できない理由、削除の影響、削除後に選ぶ行、
 * 定期取引の提案の並びと処理順の制限、科目で絞り込んだときの一覧の行を扱う。
 */

export interface BalanceSummary {
  debitTotal: number
  creditTotal: number
  /** 借方合計と貸方合計の差の絶対値 */
  difference: number
  /** 両側が0より大きく、合計が一致している */
  isBalanced: boolean
}

export function summarizeBalance(lines: readonly JournalEntryFormLine[]): BalanceSummary {
  const totals = calculateJournalLineTotals(lines)
  return {
    debitTotal: totals.debitTotal,
    creditTotal: totals.creditTotal,
    difference: Math.abs(totals.difference),
    isBalanced: totals.debitTotal > 0 && totals.difference === 0,
  }
}

/** 確定(仕訳として保存)できない理由。下書きにはこの制限はかからない */
export type IncompleteReason = 'unselectedAccount' | 'unselectedMember' | 'invalidAmount' | 'insufficientLines' | 'unbalanced'

function hasPositiveAmount(line: JournalEntryFormLine): boolean {
  const amount = Number(line.amountInput)
  return line.amountInput !== '' && Number.isFinite(amount) && amount > 0
}

/** 優先順に判定し、最初に当たった理由を返す。完成していれば null */
export function findIncompleteReason(lines: readonly JournalEntryFormLine[]): IncompleteReason | null {
  if (lines.some((line) => line.accountId === null)) return 'unselectedAccount'
  // 明細行は常に世帯メンバーを持つ(継承=未指定は廃止、計画Issue #169)
  if (lines.some((line) => line.householdMemberId === null)) return 'unselectedMember'
  if (lines.some((line) => !hasPositiveAmount(line))) return 'invalidAmount'
  const hasDebit = lines.some((line) => line.side === 'debit')
  const hasCredit = lines.some((line) => line.side === 'credit')
  if (!hasDebit || !hasCredit) return 'insufficientLines'
  if (!summarizeBalance(lines).isBalanced) return 'unbalanced'
  return null
}

const INCOMPLETE_MESSAGES: Record<IncompleteReason, string> = {
  unselectedAccount: '未選択の科目があります',
  unselectedMember: '世帯メンバーが未選択の行があります',
  invalidAmount: '金額が正しくない行があります',
  insufficientLines: '借方と貸方の行がそれぞれ1行以上必要です',
  unbalanced: '貸借が一致していません',
}

export function describeIncompleteReason(reason: IncompleteReason): string {
  return INCOMPLETE_MESSAGES[reason]
}

const SPLIT_BLOCK_MESSAGES: Record<ExpenseSplitBlockReason, string> = {
  is_expense_split_entry: '割勘で作られた仕訳は割勘できません',
  already_split: 'この仕訳は割勘済みです',
  no_debit_expense_line: '費用科目の行がないため割勘できません',
}

export function describeSplitBlock(reason: ExpenseSplitBlockReason): string {
  return SPLIT_BLOCK_MESSAGES[reason]
}

/**
 * 確定済みの仕訳を削除するときの影響の一覧(確認中に表示する)。物理削除で元に戻せない
 * (docs/domain/journal.md 1.5)。出どころごとの影響に、精算バッチと関連仕訳の影響を加える。
 */
export function buildDeleteImpactNotes(input: {
  sourceType: JournalEntrySourceType
  batchNames: readonly string[]
  isRelated: boolean
}): string[] {
  const notes: string[] = []
  if (input.sourceType === 'external_import') {
    notes.push('取り込み済みの記録も消えます。同じCSVを取り込むと、もう一度取り込まれます。')
  }
  if (input.sourceType === 'recurring_generated') {
    notes.push('定期取引の提案として、再び表示されることがあります。')
  }
  if (input.sourceType === 'expense_splitting') {
    notes.push('この割勘が取り消され、元の仕訳はまた割勘できるようになります。')
  }
  if (input.batchNames.length > 0) {
    notes.push(`精算バッチ「${input.batchNames.join('」「')}」の残高が変わります。`)
  }
  if (input.isRelated) {
    notes.push('関連仕訳のグループから外れます。')
  }
  return notes
}

/** 削除した行の次の行、無ければ一つ前の行を選ぶ。他に行が無ければ null */
export function pickSelectionAfterDelete(ids: readonly number[], deletedId: number): number | null {
  const index = ids.indexOf(deletedId)
  if (index === -1) return ids[0] ?? null
  return ids[index + 1] ?? ids[index - 1] ?? null
}

export interface ProposalKey {
  ruleId: number
  dueDate: string
}

export function sortProposalsOldestFirst<T extends ProposalKey>(proposals: readonly T[]): T[] {
  return [...proposals].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.ruleId - b.ruleId)
}

/**
 * 同じルールに、これより古い提案が残っているとき true。確定も見送りもできない
 * (docs/domain/recurring-transactions.md 1.2、昇順のみ許可)。
 */
export function isProposalBlocked(proposal: ProposalKey, all: readonly ProposalKey[]): boolean {
  return all.some((other) => other.ruleId === proposal.ruleId && other.dueDate < proposal.dueDate)
}

/**
 * 科目で絞り込んでいるとき、一覧で代表にする科目の集合(指定した科目と、指定したグループ配下の科目)。
 * 科目の指定が無ければ undefined。
 */
export function matchedAccountIdsOf(
  filter: JournalEntryFilter,
  accounts: readonly Pick<Account, 'id' | 'accountGroupId'>[],
  accountGroups: readonly GroupNode[],
): Set<number> | undefined {
  const ids = filter.accountIds ?? []
  const groupIds = filter.accountGroupIds ?? []
  if (ids.length === 0 && groupIds.length === 0) return undefined
  const matched = new Set<number>(ids)
  for (const account of accounts) {
    if (account.accountGroupId === null) continue
    const groupId = account.accountGroupId
    if (groupIds.some((target) => target === groupId || isDescendantGroup(accountGroups, target, groupId))) {
      matched.add(account.id)
    }
  }
  return matched
}

/**
 * 一覧の1行。科目で絞り込んでいるときは、一致した科目を代表にし、その金額を表示する
 * (貸借の両方に一致したら借方側)。指定が無ければ借方合計を表示する。
 */
export function toMatchedResultItem(
  entry: JournalEntry,
  accountNameOf: (accountId: number) => string,
  matchAccountIds: ReadonlySet<number> | undefined,
): JournalResultItem {
  const sum = (side: 'debit' | 'credit', only?: ReadonlySet<number>) =>
    entry.lines
      .filter((line) => line.side === side && (only === undefined || only.has(line.accountId)))
      .reduce((total, line) => total + line.amount, 0)

  let amount = sum('debit')
  if (matchAccountIds !== undefined) {
    const debitHit = entry.lines.some((line) => line.side === 'debit' && matchAccountIds.has(line.accountId))
    const creditHit = entry.lines.some((line) => line.side === 'credit' && matchAccountIds.has(line.accountId))
    if (debitHit) amount = sum('debit', matchAccountIds)
    else if (creditHit) amount = sum('credit', matchAccountIds)
  }

  return {
    id: entry.id,
    sourceType: entry.sourceType,
    memo: entry.memo && entry.memo !== '' ? entry.memo : '(摘要なし)',
    amount,
    currency: entry.currency,
    entryDate: entry.entryDate,
    debitSummary: summarizeSide(entry.lines, 'debit', accountNameOf, matchAccountIds),
    creditSummary: summarizeSide(entry.lines, 'credit', accountNameOf, matchAccountIds),
  }
}
