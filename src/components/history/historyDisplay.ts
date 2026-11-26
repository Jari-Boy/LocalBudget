import type { HistoryOperation } from '../../infrastructure/history/OperationHistory'
import type {
  AccountUsage,
  EntryChange,
  EntrySnapshot,
  OperationDetail,
} from '../../infrastructure/history/operationDetail'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'

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

// ---- 操作の詳細(計画Issue #295): どの仕訳をどう変えたか ----

const yen = (amount: number): string => formatCurrency(amount, 'JPY').replace('￥', '¥')

/** 仕訳の金額(借方の合計) */
export function entryAmount(snapshot: EntrySnapshot): number {
  return snapshot.lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0)
}

/** 変更後(削除は削除前)の仕訳の内容 */
function currentOf(change: EntryChange): EntrySnapshot {
  return (change.after ?? change.before)!
}

const orNull = (text: string | null): string | null => (text === null || text === '' ? null : text)

export interface EntrySubjectParts {
  /** 摘要。無ければnull(表示側で「摘要なし」と出す) */
  memo: string | null
  date: string
  /** 「¥3,200」の形 */
  amount: string
}

/** 一覧に出す対象名の要素(摘要・日付・金額)。削除は削除前の内容から作る */
export function entrySubjectParts(change: EntryChange): EntrySubjectParts {
  const current = currentOf(change)
  return { memo: orNull(current.memo), date: current.date, amount: yen(entryAmount(current)) }
}

export type ChangedField = 'date' | 'memo' | 'comment' | 'amount' | 'account' | 'lines'

/** 編集で変わった項目(一覧のタグ用)。作成・削除は空 */
export function changedFields(change: EntryChange): ChangedField[] {
  if (change.kind !== 'updated' || !change.before || !change.after) return []
  const { before, after } = change
  const fields: ChangedField[] = []
  if (before.date !== after.date) fields.push('date')
  if (orNull(before.memo) !== orNull(after.memo)) fields.push('memo')
  if (orNull(before.comment) !== orNull(after.comment)) fields.push('comment')
  const pairs = Math.min(before.lines.length, after.lines.length)
  const lineChanged = (pick: (b: EntrySnapshot['lines'][number], a: EntrySnapshot['lines'][number]) => boolean) =>
    before.lines.slice(0, pairs).some((b, i) => pick(b, after.lines[i]))
  if (lineChanged((b, a) => b.amount !== a.amount)) fields.push('amount')
  if (lineChanged((b, a) => b.accountName !== a.accountName || b.side !== a.side)) fields.push('account')
  if (before.lines.length !== after.lines.length) fields.push('lines')
  return fields
}

export type DiffLabel = { field: 'date' | 'memo' | 'comment' } | { side: 'debit' | 'credit'; account: string | null }

export interface DiffRow {
  label: DiffLabel
  /** 操作の前の値。作成ではnull */
  before: string | null
  /** 操作のあとの値。削除ではnull */
  after: string | null
}

const lineText = (line: EntrySnapshot['lines'][number]): string => `${line.accountName} ${yen(line.amount)}`

/**
 * 右パネルに出す行。編集は変わった項目だけを前→後で、作成は作成された内容(後だけ)、削除は削除された内容(前だけ)を返す。
 * 明細は、科目が同じなら金額だけを前後に出し(科目名はラベル)、科目が違えば「科目名 金額」を前後に出す。
 */
export function diffRows(change: EntryChange): DiffRow[] {
  if (change.kind === 'updated') {
    const { before, after } = change
    if (!before || !after) return []
    const rows: DiffRow[] = []
    if (before.date !== after.date) rows.push({ label: { field: 'date' }, before: before.date, after: after.date })
    if (orNull(before.memo) !== orNull(after.memo)) {
      rows.push({ label: { field: 'memo' }, before: orNull(before.memo), after: orNull(after.memo) })
    }
    if (orNull(before.comment) !== orNull(after.comment)) {
      rows.push({ label: { field: 'comment' }, before: orNull(before.comment), after: orNull(after.comment) })
    }
    for (let i = 0; i < Math.max(before.lines.length, after.lines.length); i++) {
      const b = before.lines[i]
      const a = after.lines[i]
      if (b && a) {
        if (b.side === a.side && b.accountName === a.accountName) {
          if (b.amount !== a.amount) {
            rows.push({ label: { side: a.side, account: a.accountName }, before: yen(b.amount), after: yen(a.amount) })
          }
        } else {
          rows.push({ label: { side: a.side, account: null }, before: lineText(b), after: lineText(a) })
        }
      } else if (b) {
        rows.push({ label: { side: b.side, account: null }, before: lineText(b), after: null })
      } else if (a) {
        rows.push({ label: { side: a.side, account: null }, before: null, after: lineText(a) })
      }
    }
    return rows
  }

  // 作成・削除: 内容の一覧(作成は後だけ、削除は前だけを持つ)
  const content = currentOf(change)
  const created = change.kind === 'created'
  const row = (label: DiffLabel, value: string): DiffRow => ({
    label,
    before: created ? null : value,
    after: created ? value : null,
  })
  const rows: DiffRow[] = [row({ field: 'date' }, content.date)]
  const memo = orNull(content.memo)
  if (memo !== null) rows.push(row({ field: 'memo' }, memo))
  const comment = orNull(content.comment)
  if (comment !== null) rows.push(row({ field: 'comment' }, comment))
  for (const line of content.lines) rows.push(row({ side: line.side, account: null }, lineText(line)))
  return rows
}

/** 一覧の行に出す、仕訳の明細の科目名(重複なし)。取込先の科目などを除ける */
export function sampleAccounts(change: EntryChange, exclude?: string | null): string[] {
  const names = currentOf(change).lines.map((line) => line.accountName)
  return [...new Set(names)].filter((name) => name !== exclude)
}

export interface AccountUsageSummary {
  shown: AccountUsage[]
  /** 上位に入らなかった科目の数と、その件数の合計。無ければnull */
  rest: { accounts: number; count: number } | null
}

/** 使った科目の要約。除外する科目(取込先)を除き、多い順の上位だけを残し、残りは1つにまとめる */
export function summarizeAccountUsage(
  usage: readonly AccountUsage[],
  options: { exclude?: string | null; top: number },
): AccountUsageSummary {
  const filtered = usage.filter((u) => u.name !== options.exclude)
  const shown = filtered.slice(0, options.top)
  const rest = filtered.slice(options.top)
  return {
    shown,
    rest: rest.length === 0 ? null : { accounts: rest.length, count: rest.reduce((sum, u) => sum + u.count, 0) },
  }
}

export type OperationKind = EntryChange['kind'] | 'mixed'

/** 操作全体の種別。1種類の変更だけならその種別、複数が混ざればmixed */
export function operationKind(detail: OperationDetail): OperationKind {
  const present = (['created', 'updated', 'deleted'] as const).filter((kind) => detail.kinds[kind] > 0)
  return present.length === 1 ? present[0] : 'mixed'
}
