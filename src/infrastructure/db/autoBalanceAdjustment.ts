import type { Database } from 'sql.js'
import {
  planBalanceAnchorAdjustments,
  type BalanceAnchor,
  type BalanceAnchorPlan,
  type LedgerDelta,
  type PlannedAdjustment,
} from '../../domain/reconciliation/planBalanceAnchorAdjustments'
import { resolveStatementAnchors } from '../../domain/reconciliation/resolveStatementAnchors'

/**
 * 残高の基準点に合わせた自動調整仕訳の計算し直し(計画Issue #205、docs/domain/reconciliation.md 1.5・1.6)。
 * 自動調整仕訳は科目ごとに「あるべき一覧」(planBalanceAnchorAdjustments)から導出するデータで、
 * ここでDB上の自動調整仕訳をそれに合わせる。仕訳の作成・更新・削除、取込の確定、残高の記録の
 * 追加・編集・削除のたびに、呼び出し側のトランザクションの中で呼ぶ(この関数自身はBEGIN/COMMITを持たない)。
 * 資産・負債以外の科目は対象外で、何もしない。
 */
export const AUTO_BALANCE_ADJUSTMENT_SOURCE_TYPE = 'auto_balance_adjustment'

interface AccountRow {
  id: number
  category: 'asset' | 'liability'
  name: string
  autoBalanceAdjustment: boolean
  householdMemberId: number | null
}

export function reconcileAutoBalanceAdjustments(db: Database, accountIds: Iterable<number>): void {
  for (const accountId of new Set(accountIds)) {
    reconcileAccount(db, accountId)
  }
}

/** 科目の基準点・帳簿から、あるべき自動調整の計画を計算する(DBは変更しない) */
export function computeAccountPlan(db: Database, accountId: number): BalanceAnchorPlan | null {
  const account = loadAccount(db, accountId)
  if (!account) return null
  return planFor(db, account, loadAnchors(db, accountId))
}

/** 科目の基準点(CSVの取引後残高 + 手で記録した残高) */
export function loadAnchors(db: Database, accountId: number): BalanceAnchor[] {
  const [refs] = db.exec(
    `SELECT id, entry_date, amount, external_balance_after, row_order, imported_at
     FROM external_transaction_refs WHERE account_id = ?`,
    [accountId],
  )
  const statementAnchors = resolveStatementAnchors(
    (refs?.values ?? []).map((row) => ({
      id: row[0] as number,
      entryDate: row[1] as string,
      amount: row[2] as number,
      externalBalanceAfter: row[3] as number | null,
      rowOrder: row[4] as number | null,
      importedAt: row[5] as string,
    })),
  )
  const [manual] = db.exec('SELECT record_date, balance FROM account_balance_records WHERE account_id = ?', [
    accountId,
  ])
  const manualAnchors = (manual?.values ?? []).map((row) => ({ date: row[0] as string, balance: row[1] as number }))
  // 同じ日は後ろに置いたものが採用される(手で記録した残高を優先する)
  return [...statementAnchors, ...manualAnchors]
}

function planFor(db: Database, account: AccountRow, anchors: BalanceAnchor[]): BalanceAnchorPlan {
  return planBalanceAnchorAdjustments({
    anchors,
    ledger: loadLedger(db, account),
    autoAdjust: account.autoBalanceAdjustment,
  })
}

function loadAccount(db: Database, accountId: number): AccountRow | null {
  const [result] = db.exec(
    'SELECT id, category, name, auto_balance_adjustment, household_member_id FROM accounts WHERE id = ?',
    [accountId],
  )
  const row = result?.values[0]
  if (!row) return null
  const category = row[1] as string
  if (category !== 'asset' && category !== 'liability') return null
  return {
    id: row[0] as number,
    category,
    name: row[2] as string,
    autoBalanceAdjustment: row[3] !== 0,
    householdMemberId: row[4] as number | null,
  }
}

/** 自動調整仕訳を除いた帳簿の増減(残高が増える向きを正) */
function loadLedger(db: Database, account: AccountRow): LedgerDelta[] {
  const increaseSide = account.category === 'asset' ? 'debit' : 'credit'
  const [result] = db.exec(
    `SELECT e.entry_date, l.side, l.amount
     FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
     WHERE l.account_id = ? AND e.source_type != ?`,
    [account.id, AUTO_BALANCE_ADJUSTMENT_SOURCE_TYPE],
  )
  return (result?.values ?? []).map((row) => ({
    date: row[0] as string,
    delta: row[1] === increaseSide ? (row[2] as number) : -(row[2] as number),
  }))
}

interface DesiredEntry {
  key: string
  adjustment: PlannedAdjustment
  memo: string
}

interface ExistingEntry {
  id: number
  key: string
}

function reconcileAccount(db: Database, accountId: number): void {
  const account = loadAccount(db, accountId)
  if (!account) return

  const plan = planFor(db, account, loadAnchors(db, accountId))
  const desired: DesiredEntry[] = plan.adjustments.map((adjustment) => {
    const memo = buildMemo(account.name, adjustment)
    return { key: entryKey(adjustment.kind, adjustment.entryDate, adjustment.amount, memo), adjustment, memo }
  })
  const existing = loadExistingEntries(db, account)

  // 同じ内容(種別・日付・金額・摘要)の仕訳は作り直さず残し、余りだけ削除・不足だけ追加する
  const remaining = [...existing]
  const toInsert: DesiredEntry[] = []
  for (const entry of desired) {
    const index = remaining.findIndex((candidate) => candidate.key === entry.key)
    if (index >= 0) remaining.splice(index, 1)
    else toInsert.push(entry)
  }
  for (const stale of remaining) {
    db.run('DELETE FROM journal_entries WHERE id = ?', [stale.id])
  }
  for (const entry of toInsert) {
    insertEntry(db, account, entry)
  }
}

function loadExistingEntries(db: Database, account: AccountRow): ExistingEntry[] {
  const increaseSide = account.category === 'asset' ? 'debit' : 'credit'
  const [result] = db.exec(
    `SELECT e.id, e.entry_date, e.memo, l.side, l.amount,
            EXISTS (SELECT 1 FROM journal_lines c JOIN accounts a ON a.id = c.account_id
                    WHERE c.journal_entry_id = e.id AND a.category = 'equity') AS is_capital
     FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
     WHERE e.source_type = ? AND l.account_id = ?`,
    [AUTO_BALANCE_ADJUSTMENT_SOURCE_TYPE, account.id],
  )
  return (result?.values ?? []).map((row) => ({
    id: row[0] as number,
    key: entryKey(
      row[5] === 1 ? 'capital' : 'adjustment',
      row[1] as string,
      row[3] === increaseSide ? (row[4] as number) : -(row[4] as number),
      row[2] as string | null,
    ),
  }))
}

function entryKey(kind: string, date: string, amount: number, memo: string | null): string {
  return `${kind}|${date}|${amount}|${memo ?? ''}`
}

function buildMemo(accountName: string, adjustment: PlannedAdjustment): string {
  if (adjustment.kind === 'capital') return `初期残高(${accountName})`
  const start = toMonthDay(adjustment.periodStart ?? adjustment.periodEnd)
  return `残高の自動調整(${accountName} ${start}〜${toMonthDay(adjustment.periodEnd)})`
}

function toMonthDay(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`
}

function insertEntry(db: Database, account: AccountRow, entry: DesiredEntry): void {
  const { adjustment } = entry
  const counter = findCounterAccount(db, adjustment.kind)
  const entryMemberId = account.householdMemberId ?? firstHouseholdMemberId(db)
  const increaseSide = account.category === 'asset' ? 'debit' : 'credit'
  const decreaseSide = increaseSide === 'debit' ? 'credit' : 'debit'
  const accountSide = adjustment.amount > 0 ? increaseSide : decreaseSide
  const counterSide = accountSide === 'debit' ? 'credit' : 'debit'
  const amount = Math.abs(adjustment.amount)

  db.run(
    `INSERT INTO journal_entries (entry_date, memo, source_type, household_member_id) VALUES (?, ?, ?, ?)`,
    [adjustment.entryDate, entry.memo, AUTO_BALANCE_ADJUSTMENT_SOURCE_TYPE, entryMemberId],
  )
  const entryId = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
  const insertLine = (accountId: number, side: string, memberId: number) =>
    db.run(
      `INSERT INTO journal_lines (journal_entry_id, account_id, household_member_id, side, amount)
       VALUES (?, ?, ?, ?, ?)`,
      [entryId, accountId, memberId, side, amount],
    )
  insertLine(account.id, accountSide, account.householdMemberId ?? entryMemberId)
  insertLine(counter.id, counterSide, counter.householdMemberId ?? entryMemberId)
}

/** 元手は純資産のシステム管理科目「初期残高」、それ以外は費用のシステム管理科目「残高調整」 */
function findCounterAccount(
  db: Database,
  kind: PlannedAdjustment['kind'],
): { id: number; householdMemberId: number | null } {
  const category = kind === 'capital' ? 'equity' : 'expense'
  const [result] = db.exec(
    `SELECT id, household_member_id FROM accounts
     WHERE category = ? AND is_system_managed = 1 ORDER BY id LIMIT 1`,
    [category],
  )
  const row = result?.values[0]
  if (!row) {
    throw new Error(`system-managed ${category} account for auto balance adjustment is missing`)
  }
  return { id: row[0] as number, householdMemberId: row[1] as number | null }
}

function firstHouseholdMemberId(db: Database): number {
  const row = db.exec('SELECT id FROM household_members ORDER BY id LIMIT 1')[0]?.values[0]
  if (!row) throw new Error('household member is required for auto balance adjustment')
  return row[0] as number
}

/** 仕訳(1件)の明細行が触れている資産・負債科目のid(自動調整仕訳自身は対象にしない) */
export function findAffectedAccountIdsOfEntry(db: Database, entryId: number): number[] {
  const [result] = db.exec(
    `SELECT DISTINCT l.account_id FROM journal_lines l
     JOIN journal_entries e ON e.id = l.journal_entry_id
     WHERE l.journal_entry_id = ? AND e.source_type != ?`,
    [entryId, AUTO_BALANCE_ADJUSTMENT_SOURCE_TYPE],
  )
  return (result?.values ?? []).map((row) => row[0] as number)
}

/** 自動調整仕訳か(利用者の更新・削除の拒否に使う) */
export function isAutoBalanceAdjustmentEntry(db: Database, entryId: number): boolean {
  const [result] = db.exec('SELECT source_type FROM journal_entries WHERE id = ?', [entryId])
  return result?.values[0]?.[0] === AUTO_BALANCE_ADJUSTMENT_SOURCE_TYPE
}
