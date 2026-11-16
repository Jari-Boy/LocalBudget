import type { HistoryOperation } from '../../infrastructure/history/OperationHistory'

/** マスタとして数える表(仕訳・明細・取込の記録・内部の記録などは含めない) */
const MASTER_TABLES: ReadonlySet<string> = new Set([
  'accounts',
  'account_groups',
  'counterparties',
  'counterparty_groups',
  'keyword_rules',
  'household_members',
  'household_member_group_memberships',
  'projects',
  'project_groups',
  'budgets',
  'import_mapping_definitions',
  'recurring_transaction_rules',
  'journal_templates',
  'journal_template_groups',
  'settlement_batches',
])

export interface ImpactSummary {
  /** 影響する仕訳(ヘッダー)の件数 */
  journalEntries: number
  /** 影響する仕訳の明細行の件数(科目統合のように、ヘッダーは変わらず明細だけが変わる操作の把握用) */
  journalLines: number
  /** 影響するマスタの行の件数 */
  masters: number
}

function total(change: { inserted: number; updated: number; deleted: number }): number {
  return change.inserted + change.updated + change.deleted
}

/** 戻す操作が、仕訳とマスタにどれだけ影響するか */
export function summarizeImpact(operations: readonly HistoryOperation[]): ImpactSummary {
  const summary: ImpactSummary = { journalEntries: 0, journalLines: 0, masters: 0 }
  for (const operation of operations) {
    for (const change of operation.changes) {
      if (change.table === 'journal_entries') summary.journalEntries += total(change)
      else if (change.table === 'journal_lines') summary.journalLines += total(change)
      else if (MASTER_TABLES.has(change.table)) summary.masters += total(change)
    }
  }
  return summary
}

export type UndoAction = 'remove' | 'revert' | 'restore'

export interface UndoStep {
  table: string
  /** remove: 追加された行を削除する / revert: 変更された行を元の内容に戻す / restore: 削除された行を復元する */
  action: UndoAction
  count: number
}

/** 1つの操作を取り消すと、表ごとに何がどうなるか */
export function describeUndoSteps(operation: HistoryOperation): UndoStep[] {
  const steps: UndoStep[] = []
  for (const change of operation.changes) {
    if (change.inserted > 0) steps.push({ table: change.table, action: 'remove', count: change.inserted })
    if (change.updated > 0) steps.push({ table: change.table, action: 'revert', count: change.updated })
    if (change.deleted > 0) steps.push({ table: change.table, action: 'restore', count: change.deleted })
  }
  return steps
}
