import type { Account } from '../account/Account'
import { expandGroupIds } from '../account-group/expandGroupIds'
import { resolveEffectiveHouseholdMemberId } from '../financial-statement/resolveEffectiveHouseholdMemberId'
import type { JournalEntry, JournalLine } from './JournalEntry'
import type { JournalEntryFilter, JournalEntryFilterContext } from './JournalEntryFilter'

/** 空配列・未指定は絞り込みなし */
function isActive<T>(values: readonly T[] | undefined): values is readonly T[] {
  return values !== undefined && values.length > 0
}

/**
 * 仕訳の複数軸絞り込み(計画Issue #40、割勘対象選択画面での再利用を見据えた共通フィルタ)。
 * 期間・科目・世帯メンバー・プロジェクト(従来の単一指定)に加え、計画Issue #145で追加した
 * 摘要・金額の範囲・取引先・精算バッチ(未割当を含む)・作成経路・複数選択・グループ指定
 * (配下すべてを対象)を、AND条件で組み合わせる。各軸は「仕訳内のいずれかの明細行が条件に
 * 一致すればその仕訳を含める」(行単位ではなく仕訳単位でフィルタする)ため、複数の軸を
 * 別々の明細行で満たしてもヒットする。1つの軸の中の複数指定はOR。
 * 世帯メンバーの判定は財務諸表ドメインのresolveEffectiveHouseholdMemberId
 * (科目既定値→明細の上書き→起票者の順のフォールバック)を再利用する。
 * グループ指定の展開にはcontext(グループ・取引先・プロジェクトのマスタ)を渡す。DB非依存の純粋関数。
 */
export function filterJournalEntries(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  filter: JournalEntryFilter,
  context: JournalEntryFilterContext = {},
): JournalEntry[] {
  const accountsById = new Map(accounts.map((account) => [account.id, account]))
  const counterpartyGroupById = new Map(
    (context.counterparties ?? []).map((counterparty) => [counterparty.id, counterparty.counterpartyGroupId]),
  )
  const projectGroupById = new Map((context.projects ?? []).map((project) => [project.id, project.projectGroupId]))

  const accountIdSet = isActive(filter.accountIds) ? new Set(filter.accountIds) : null
  const memberIdSet = isActive(filter.householdMemberIds) ? new Set(filter.householdMemberIds) : null
  const projectIdSet = isActive(filter.projectIds) ? new Set(filter.projectIds) : null
  const counterpartyIdSet = isActive(filter.counterpartyIds) ? new Set(filter.counterpartyIds) : null
  const sourceTypeSet = isActive(filter.sourceTypes) ? new Set(filter.sourceTypes) : null
  const accountGroupSet = isActive(filter.accountGroupIds)
    ? expandGroupIds(context.accountGroups ?? [], filter.accountGroupIds)
    : null
  const counterpartyGroupSet = isActive(filter.counterpartyGroupIds)
    ? expandGroupIds(context.counterpartyGroups ?? [], filter.counterpartyGroupIds)
    : null
  const projectGroupSet = isActive(filter.projectGroupIds)
    ? expandGroupIds(context.projectGroups ?? [], filter.projectGroupIds)
    : null
  const memoKeyword = filter.memo?.trim().toLowerCase() ?? ''

  const anyLine = (entry: JournalEntry, predicate: (line: JournalLine) => boolean): boolean =>
    entry.lines.some(predicate)

  return entries.filter((entry) => {
    if (filter.dateFrom !== undefined && entry.entryDate < filter.dateFrom) return false
    if (filter.dateTo !== undefined && entry.entryDate > filter.dateTo) return false
    if (filter.accountId !== undefined && !anyLine(entry, (line) => line.accountId === filter.accountId)) {
      return false
    }
    if (filter.projectId !== undefined && !anyLine(entry, (line) => line.projectId === filter.projectId)) {
      return false
    }
    if (
      filter.householdMemberId !== undefined &&
      !anyLine(
        entry,
        (line) => resolveEffectiveHouseholdMemberId(line, accountsById, entry.householdMemberId) === filter.householdMemberId,
      )
    ) {
      return false
    }

    if (memoKeyword !== '' && !(entry.memo ?? '').toLowerCase().includes(memoKeyword)) return false

    if (filter.amountMin !== undefined || filter.amountMax !== undefined) {
      const amount = entry.lines.filter((line) => line.side === 'debit').reduce((total, line) => total + line.amount, 0)
      if (filter.amountMin !== undefined && amount < filter.amountMin) return false
      if (filter.amountMax !== undefined && amount > filter.amountMax) return false
    }

    if (sourceTypeSet !== null && !sourceTypeSet.has(entry.sourceType)) return false
    if (accountIdSet !== null && !anyLine(entry, (line) => accountIdSet.has(line.accountId))) return false
    if (projectIdSet !== null && !anyLine(entry, (line) => line.projectId !== null && projectIdSet.has(line.projectId))) {
      return false
    }
    if (
      counterpartyIdSet !== null &&
      !anyLine(entry, (line) => line.counterpartyId !== null && counterpartyIdSet.has(line.counterpartyId))
    ) {
      return false
    }
    if (
      memberIdSet !== null &&
      !anyLine(entry, (line) =>
        memberIdSet.has(resolveEffectiveHouseholdMemberId(line, accountsById, entry.householdMemberId)),
      )
    ) {
      return false
    }

    if (isActive(filter.settlementBatchIds)) {
      const wantsUnassigned = filter.settlementBatchIds.includes(null)
      const batchIds = new Set(filter.settlementBatchIds.filter((id): id is number => id !== null))
      const hasAnyTag = anyLine(entry, (line) => line.settlementBatchId !== null)
      const matchesBatch = anyLine(
        entry,
        (line) => line.settlementBatchId !== null && batchIds.has(line.settlementBatchId),
      )
      if (!(matchesBatch || (wantsUnassigned && !hasAnyTag))) return false
    }

    if (accountGroupSet !== null) {
      const matches = anyLine(entry, (line) => {
        const groupId = accountsById.get(line.accountId)?.accountGroupId ?? null
        return groupId !== null && accountGroupSet.has(groupId)
      })
      if (!matches) return false
    }
    if (counterpartyGroupSet !== null) {
      const matches = anyLine(entry, (line) => {
        const groupId = line.counterpartyId === null ? null : (counterpartyGroupById.get(line.counterpartyId) ?? null)
        return groupId !== null && counterpartyGroupSet.has(groupId)
      })
      if (!matches) return false
    }
    if (projectGroupSet !== null) {
      const matches = anyLine(entry, (line) => {
        const groupId = line.projectId === null ? null : (projectGroupById.get(line.projectId) ?? null)
        return groupId !== null && projectGroupSet.has(groupId)
      })
      if (!matches) return false
    }

    return true
  })
}
