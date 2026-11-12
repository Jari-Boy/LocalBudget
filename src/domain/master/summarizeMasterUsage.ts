import type { Account } from '../account/Account'
import type { Budget } from '../budget/Budget'
import type { JournalEntry } from '../journal/JournalEntry'
import type { RecurringTransactionRule, RecurringTransactionRuleLine } from '../recurring-transaction/RecurringTransactionRule'
import type { SettlementBatch } from '../settlement-batch/SettlementBatch'

/** マスタ画面で削除の可否を判定する対象(計画Issue #154) */
export type MasterKind = 'account' | 'counterparty' | 'project' | 'householdMember' | 'recurringRule'

/** 削除をさまたげる参照の種類。使用件数の項目名と同じ */
export type DeletionBlockSource =
  | 'journalLines'
  | 'budgets'
  | 'recurringRules'
  | 'settlementBatches'
  | 'entryAuthors'
  | 'accountOwners'
  | 'generatedEntries'

export interface MasterUsageCount {
  /** 仕訳の明細で使われた件数。初期残高の仕訳の明細は含めない(initialBalanceEntryIdsで別に持つ) */
  journalLines: number
  /** 科目の明細を持つ初期残高の仕訳のid。口座の削除時に一緒に消す対象 */
  initialBalanceEntryIds: number[]
  budgets: number
  recurringRules: number
  settlementBatches: number
  /** 仕訳の起票者として使われた件数 */
  entryAuthors: number
  /** 科目の名義として使われた件数 */
  accountOwners: number
  /** 定期取引ルールから生成された仕訳の件数 */
  generatedEntries: number
}

export interface MasterUsageInput {
  entries: readonly JournalEntry[]
  budgets: readonly Pick<Budget, 'accountId'>[]
  rules: readonly {
    bookkeeperHouseholdMemberId: RecurringTransactionRule['bookkeeperHouseholdMemberId']
    lines: readonly Pick<
      RecurringTransactionRuleLine,
      'accountId' | 'counterpartyId' | 'projectId' | 'householdMemberId'
    >[]
  }[]
  settlementBatches: readonly Pick<SettlementBatch, 'counterpartyId'>[]
  accounts: readonly Pick<Account, 'householdMemberId'>[]
}

export interface MasterUsage {
  /** 使用件数を返す。一度も使われていないidは、すべて0の件数を返す */
  get(kind: MasterKind, id: number): MasterUsageCount
}

export interface DeletionBlock {
  source: DeletionBlockSource
  count: number
}

function emptyCount(): MasterUsageCount {
  return {
    journalLines: 0,
    initialBalanceEntryIds: [],
    budgets: 0,
    recurringRules: 0,
    settlementBatches: 0,
    entryAuthors: 0,
    accountOwners: 0,
    generatedEntries: 0,
  }
}

/**
 * 仕訳・予算・定期取引ルール・精算バッチ・科目の名義から、項目ごとの使用状況を集計する。
 * Issueの削除条件の表(科目・取引先・プロジェクト・世帯メンバー・定期取引ルール)の根拠となる
 * 参照を数える。どの参照が削除をさまたげるかの判定はlistDeletionBlocksが担う。
 */
export function summarizeMasterUsage(input: MasterUsageInput): MasterUsage {
  const byKind: Record<MasterKind, Map<number, MasterUsageCount>> = {
    account: new Map(),
    counterparty: new Map(),
    project: new Map(),
    householdMember: new Map(),
    recurringRule: new Map(),
  }
  const countOf = (kind: MasterKind, id: number): MasterUsageCount => {
    let count = byKind[kind].get(id)
    if (!count) {
      count = emptyCount()
      byKind[kind].set(id, count)
    }
    return count
  }

  for (const entry of input.entries) {
    const isInitialBalance = entry.sourceType === 'initial_balance'
    countOf('householdMember', entry.householdMemberId).entryAuthors += 1
    if (entry.generatedFromRuleId !== null) {
      countOf('recurringRule', entry.generatedFromRuleId).generatedEntries += 1
    }
    for (const line of entry.lines) {
      const account = countOf('account', line.accountId)
      if (isInitialBalance) {
        if (!account.initialBalanceEntryIds.includes(entry.id)) account.initialBalanceEntryIds.push(entry.id)
      } else {
        account.journalLines += 1
      }
      if (line.counterpartyId !== null) countOf('counterparty', line.counterpartyId).journalLines += 1
      if (line.projectId !== null) countOf('project', line.projectId).journalLines += 1
      if (line.householdMemberId !== null) countOf('householdMember', line.householdMemberId).journalLines += 1
    }
  }
  for (const budget of input.budgets) {
    countOf('account', budget.accountId).budgets += 1
  }
  for (const rule of input.rules) {
    // 1つのルールが同じマスタを複数の行で使っていても、使用中のルールの件数は1件と数える(計画Issue #180)
    const used: Record<'account' | 'counterparty' | 'project' | 'householdMember', Set<number>> = {
      account: new Set(),
      counterparty: new Set(),
      project: new Set(),
      householdMember: new Set(),
    }
    if (rule.bookkeeperHouseholdMemberId !== null) used.householdMember.add(rule.bookkeeperHouseholdMemberId)
    for (const line of rule.lines) {
      used.account.add(line.accountId)
      if (line.counterpartyId !== null) used.counterparty.add(line.counterpartyId)
      if (line.projectId !== null) used.project.add(line.projectId)
      if (line.householdMemberId !== null) used.householdMember.add(line.householdMemberId)
    }
    for (const kind of Object.keys(used) as (keyof typeof used)[]) {
      for (const id of used[kind]) countOf(kind, id).recurringRules += 1
    }
  }
  for (const batch of input.settlementBatches) {
    if (batch.counterpartyId !== null) countOf('counterparty', batch.counterpartyId).settlementBatches += 1
  }
  for (const account of input.accounts) {
    if (account.householdMemberId !== null) countOf('householdMember', account.householdMemberId).accountOwners += 1
  }

  return { get: (kind, id) => byKind[kind].get(id) ?? emptyCount() }
}

/** 対象ごとの、削除をさまたげる参照の種類(Issueの削除条件の表の順) */
const BLOCKING_SOURCES: Record<MasterKind, readonly DeletionBlockSource[]> = {
  account: ['journalLines', 'budgets', 'recurringRules'],
  counterparty: ['journalLines', 'recurringRules', 'settlementBatches'],
  project: ['journalLines', 'recurringRules'],
  householdMember: ['journalLines', 'entryAuthors', 'accountOwners', 'recurringRules'],
  recurringRule: ['generatedEntries'],
}

/**
 * 削除できない理由を、使用件数が1件以上の参照ごとに返す(空なら削除できる)。
 * 口座に紐づく仕訳が初期残高の仕訳だけの場合は、通常の使用件数(journalLines)が0になるため
 * 理由が空になり、呼び出し側はinitialBalanceEntryIdsの仕訳を一緒に削除する。
 */
export function listDeletionBlocks(kind: MasterKind, usage: MasterUsageCount): DeletionBlock[] {
  return BLOCKING_SOURCES[kind]
    .map((source) => ({ source, count: usage[source] }))
    .filter((block) => block.count > 0)
}
