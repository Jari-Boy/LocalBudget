import type { Account } from '../account/Account'
import { expandGroupIds } from '../account-group/expandGroupIds'
import { matchesSearch } from '../search/normalizeForSearch'
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
 * 別々の明細行で満たしてもヒットする。1つの軸の中の複数指定はOR。科目・取引先・プロジェクトで
 * 同じ軸の項目指定(accountIds等)とグループ指定(accountGroupIds等)を併用した場合もOR(計画Issue #203)。
 * 互換用の単一指定(accountId等)は従来どおりAND。
 * 世帯メンバーの判定は明細行のhouseholdMemberIdと直接比較する(明細行は常に実際の世帯メンバーを
 * 持つ、docs/domain/household-members.md 1.2節、計画Issue #169)。
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
  const institutionNameSet = isActive(filter.financialInstitutionNames) ? new Set(filter.financialInstitutionNames) : null
  const accountGroupSet = isActive(filter.accountGroupIds)
    ? expandGroupIds(context.accountGroups ?? [], filter.accountGroupIds)
    : null
  const counterpartyGroupSet = isActive(filter.counterpartyGroupIds)
    ? expandGroupIds(context.counterpartyGroups ?? [], filter.counterpartyGroupIds)
    : null
  const projectGroupSet = isActive(filter.projectGroupIds)
    ? expandGroupIds(context.projectGroups ?? [], filter.projectGroupIds)
    : null
  const memoKeyword = filter.memo ?? ''

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
      !anyLine(entry, (line) => line.householdMemberId === filter.householdMemberId)
    ) {
      return false
    }

    // 摘要はひらがな/カタカナ・全角半角・大文字小文字の違いを吸収して部分一致(計画Issue #303)
    if (!matchesSearch(entry.memo ?? '', memoKeyword)) return false

    if (filter.amountMin !== undefined || filter.amountMax !== undefined) {
      const amount = entry.lines.filter((line) => line.side === 'debit').reduce((total, line) => total + line.amount, 0)
      if (filter.amountMin !== undefined && amount < filter.amountMin) return false
      if (filter.amountMax !== undefined && amount > filter.amountMax) return false
    }

    // 出どころの軸: 作成経路と取り込んだ金融機関は、どちらかに該当すればよい(OR、計画Issue #289)
    if (sourceTypeSet !== null || institutionNameSet !== null) {
      const matchesSourceType = sourceTypeSet?.has(entry.sourceType) ?? false
      const matchesInstitution =
        institutionNameSet !== null &&
        entry.sourceType === 'external_import' &&
        institutionNameSet.has(entry.financialInstitutionName ?? null)
      if (!matchesSourceType && !matchesInstitution) return false
    }
    // 項目指定とグループ指定は同じ軸の中でOR(計画Issue #203)。どちらか一方でも指定があれば、
    // いずれかの明細行が項目指定またはグループ指定のどちらかに該当することを求める
    if (accountIdSet !== null || accountGroupSet !== null) {
      const matches = anyLine(entry, (line) => {
        if (accountIdSet?.has(line.accountId)) return true
        const groupId = accountsById.get(line.accountId)?.accountGroupId ?? null
        return groupId !== null && (accountGroupSet?.has(groupId) ?? false)
      })
      if (!matches) return false
    }
    if (projectIdSet !== null || projectGroupSet !== null) {
      const matches = anyLine(entry, (line) => {
        if (line.projectId === null) return false
        if (projectIdSet?.has(line.projectId)) return true
        const groupId = projectGroupById.get(line.projectId) ?? null
        return groupId !== null && (projectGroupSet?.has(groupId) ?? false)
      })
      if (!matches) return false
    }
    if (counterpartyIdSet !== null || counterpartyGroupSet !== null) {
      const matches = anyLine(entry, (line) => {
        if (line.counterpartyId === null) return false
        if (counterpartyIdSet?.has(line.counterpartyId)) return true
        const groupId = counterpartyGroupById.get(line.counterpartyId) ?? null
        return groupId !== null && (counterpartyGroupSet?.has(groupId) ?? false)
      })
      if (!matches) return false
    }
    if (
      memberIdSet !== null &&
      !anyLine(entry, (line) => memberIdSet.has(line.householdMemberId))
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

    return true
  })
}
