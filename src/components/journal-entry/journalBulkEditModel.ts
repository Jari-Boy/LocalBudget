import type { Account } from '../../domain/account/Account'
import type { JournalEntry, JournalLine, JournalLineInput, UpdateJournalEntryInput } from '../../domain/journal/JournalEntry'
import { isSettlementBatchTaggableAccount } from '../../domain/settlement-batch/isSettlementBatchTaggableAccount'
import { fromJournalLine, isCounterpartyEligibleCategory, toJournalLineInput } from './journalEntryFormLine'
import { applyAccountChange } from './journalLineAccountChange'

/**
 * 明細行単位の表の一括編集(計画Issue #182、仕訳をまたいで、選んだ明細の行をまとめて編集)の純粋関数。
 * 変えられる項目は 科目・プロジェクト・取引先・精算バッチ・世帯メンバー。選択した行と科目の選択から「選べる項目」を
 * 先に決めて不正な操作をできなくし(UIは選べない項目を無効にする)、更新内容を仕訳ごとの更新入力に組み立てる。
 * DB・DOM非依存。
 */

/** 1項目の選択。keep=変更しない、clear=外す(なしにする)、set=この値にする */
export type BulkChange<T> = { kind: 'keep' } | { kind: 'clear' } | { kind: 'set'; value: T }

export interface BulkPick {
  /** 科目。null=変更しない(科目は外せない) */
  accountId: number | null
  project: BulkChange<number>
  counterparty: BulkChange<number>
  batch: BulkChange<number>
  /** 世帯メンバー。null=変更しない(世帯メンバーは外せない) */
  memberId: number | null
}

export const EMPTY_BULK_PICK: BulkPick = {
  accountId: null,
  project: { kind: 'keep' },
  counterparty: { kind: 'keep' },
  batch: { kind: 'keep' },
  memberId: null,
}

/** 選択した明細の行と、その仕訳 */
export interface BulkSelectedLine {
  entry: JournalEntry
  line: JournalLine
}

const UNKNOWN_ACCOUNT = '(不明な科目)'

export interface BulkEditRules {
  /** 取引先を選べるか: 選択した行(科目を変えるなら変更後の科目)がすべて費用・収益の科目 */
  counterpartyAllowed: boolean
  /** 精算バッチを選べるか: すべてシステム管理の立替金・未払金(バッチ専用科目) */
  batchAllowed: boolean
  /** 世帯メンバーを選べるか: 既定の世帯メンバーがある科目の行を含まない */
  memberAllowed: boolean
  /** 選べない理由になっている科目名(重複なし、選択した順) */
  counterpartyBlockedBy: string[]
  batchBlockedBy: string[]
  memberBlockedBy: string[]
}

/** 選択した行の科目(科目を一括で変えるときは変更後の科目)で、選べる項目を求める。0行のときはどれも選べない */
export function bulkEditRules(
  selected: readonly BulkSelectedLine[],
  pick: BulkPick,
  accountById: ReadonlyMap<number, Account>,
): BulkEditRules {
  const blockedBy = (isBlocked: (account: Account | undefined) => boolean): string[] => {
    const names: string[] = []
    for (const { line } of selected) {
      const account = accountById.get(pick.accountId ?? line.accountId)
      if (!isBlocked(account)) continue
      const name = account?.name ?? UNKNOWN_ACCOUNT
      if (!names.includes(name)) names.push(name)
    }
    return names
  }
  const counterpartyBlockedBy = blockedBy((a) => a === undefined || !isCounterpartyEligibleCategory(a.category))
  const batchBlockedBy = blockedBy((a) => a === undefined || !isSettlementBatchTaggableAccount(a))
  const memberBlockedBy = blockedBy((a) => a !== undefined && a.householdMemberId !== null)
  const any = selected.length > 0
  return {
    counterpartyAllowed: any && counterpartyBlockedBy.length === 0,
    batchAllowed: any && batchBlockedBy.length === 0,
    memberAllowed: any && memberBlockedBy.length === 0,
    counterpartyBlockedBy,
    batchBlockedBy,
    memberBlockedBy,
  }
}

/** 選べなくなった項目の選択を「変更しない」に戻す(選べる項目と、科目・プロジェクトの選択は残す) */
export function sanitizeBulkPick(pick: BulkPick, rules: BulkEditRules): BulkPick {
  return {
    ...pick,
    counterparty: rules.counterpartyAllowed ? pick.counterparty : { kind: 'keep' },
    batch: rules.batchAllowed ? pick.batch : { kind: 'keep' },
    memberId: rules.memberAllowed ? pick.memberId : null,
  }
}

/** 何も選んでいない(すべて「変更しない」)か */
export function isBulkPickEmpty(pick: BulkPick): boolean {
  return (
    pick.accountId === null &&
    pick.project.kind === 'keep' &&
    pick.counterparty.kind === 'keep' &&
    pick.batch.kind === 'keep' &&
    pick.memberId === null
  )
}

export interface SelectionStats {
  lineCount: number
  debitCount: number
  creditCount: number
  /** 選んだ行を含む仕訳の件数(同じ仕訳の複数行は1件) */
  entryCount: number
}

export function selectionStats(selected: readonly BulkSelectedLine[]): SelectionStats {
  const debitCount = selected.filter((s) => s.line.side === 'debit').length
  return {
    lineCount: selected.length,
    debitCount,
    creditCount: selected.length - debitCount,
    entryCount: new Set(selected.map((s) => s.entry.id)).size,
  }
}

/** 1件の仕訳の更新(仕訳ごとに1回、Repositoryのupdateへ渡す) */
export interface BulkUpdate {
  entry: JournalEntry
  input: UpdateJournalEntryInput
}

function applyChange<T>(change: BulkChange<T>, current: T | null): T | null {
  if (change.kind === 'set') return change.value
  if (change.kind === 'clear') return null
  return current
}

/**
 * 選択した行に一括編集を適用した、仕訳ごとの更新入力を組み立てる。同じ仕訳の行は1件にまとめ、その仕訳の
 * 全行を渡す(選択していない行は変えず、行のid・精算バッチのタグも保つ)。取引日・摘要・コメントはそのまま、
 * 起票者は指定しない(既存を維持)。科目を変えた行は、新しい科目で持てない取引先・精算バッチが外れ、世帯メンバーは
 * 既存の規則(科目の既定 > 手で選んだ値 > 起票者)で決まる(行編集と同じ applyAccountChange)。取引先・精算バッチ・
 * 世帯メンバーの指定は、その行の科目で持てる場合だけ反映する(UIは先に選べなくするため、通常は全行に反映される)。
 * 何も選んでいない・行がないときは空配列。
 */
export function buildBulkUpdates(
  selected: readonly BulkSelectedLine[],
  pick: BulkPick,
  accountById: ReadonlyMap<number, Account>,
): BulkUpdate[] {
  if (isBulkPickEmpty(pick) || selected.length === 0) return []

  const lineIdsByEntry = new Map<number, { entry: JournalEntry; lineIds: Set<number> }>()
  for (const { entry, line } of selected) {
    const group = lineIdsByEntry.get(entry.id) ?? { entry, lineIds: new Set<number>() }
    group.lineIds.add(line.id)
    lineIdsByEntry.set(entry.id, group)
  }

  return [...lineIdsByEntry.values()].map(({ entry, lineIds }) => {
    const lines = entry.lines
      .map((line): JournalLineInput | null => {
        let form = fromJournalLine(line)
        if (lineIds.has(line.id)) {
          if (pick.accountId !== null) {
            form = applyAccountChange({ line: form, accountId: pick.accountId, accountById, bookkeeperId: entry.householdMemberId })
          }
          const account = form.accountId === null ? undefined : accountById.get(form.accountId)
          form = { ...form, projectId: applyChange(pick.project, form.projectId) }
          if (account !== undefined && isCounterpartyEligibleCategory(account.category)) {
            form = { ...form, counterpartyId: applyChange(pick.counterparty, form.counterpartyId) }
          }
          if (account !== undefined && isSettlementBatchTaggableAccount(account)) {
            form = { ...form, settlementBatchId: applyChange(pick.batch, form.settlementBatchId ?? null) }
          }
          if (pick.memberId !== null && account?.householdMemberId == null) {
            form = { ...form, householdMemberId: pick.memberId }
          }
        }
        return toJournalLineInput(form)
      })
      .filter((l): l is JournalLineInput => l !== null)
    return { entry, input: { entryDate: entry.entryDate, memo: entry.memo, comment: entry.comment, lines } }
  })
}

export interface BulkSummaryLine {
  text: string
  /** 注意を引く(取引先・精算バッチが外れる行がある) */
  warn: boolean
}

/** 値のIDから表示名を引く関数(プロジェクト・取引先・精算バッチ・世帯メンバー) */
export interface BulkLabels {
  project: (id: number) => string
  counterparty: (id: number) => string
  batch: (id: number) => string
  member: (id: number) => string
}

/** 一括編集バーに出す、変更内容の表示文(適用される行数、外れる取引先・精算バッチの件数)。何も選んでいなければ促す1行 */
export function summarizeBulkEdit(
  selected: readonly BulkSelectedLine[],
  pick: BulkPick,
  accountById: ReadonlyMap<number, Account>,
  labels: BulkLabels,
): BulkSummaryLine[] {
  if (isBulkPickEmpty(pick)) return [{ text: '変える項目を選ぶと、ここに変更の内容が出ます', warn: false }]
  const n = selected.length
  const lines: BulkSummaryLine[] = []
  const valueText = <T,>(change: BulkChange<T>, label: (value: T) => string) =>
    change.kind === 'clear' ? 'なし' : change.kind === 'set' ? label(change.value) : ''

  if (pick.accountId !== null) {
    const account = accountById.get(pick.accountId)
    let text = `科目 → ${account?.name ?? UNKNOWN_ACCOUNT}: ${n}行に適用`
    const clearCounterparty =
      account !== undefined && isCounterpartyEligibleCategory(account.category) ? 0 : selected.filter((s) => s.line.counterpartyId !== null).length
    const clearBatch =
      account !== undefined && isSettlementBatchTaggableAccount(account) ? 0 : selected.filter((s) => s.line.settlementBatchId !== null).length
    if (clearCounterparty > 0) text += `(取引先が付いている${clearCounterparty}行は、取引先が外れます)`
    if (clearBatch > 0) text += `(精算バッチが付いている${clearBatch}行は、精算バッチが外れます)`
    lines.push({ text, warn: clearCounterparty + clearBatch > 0 })
  }
  if (pick.project.kind !== 'keep') lines.push({ text: `プロジェクト → ${valueText(pick.project, labels.project)}: ${n}行に適用`, warn: false })
  if (pick.counterparty.kind !== 'keep') {
    lines.push({ text: `取引先 → ${valueText(pick.counterparty, labels.counterparty)}: ${n}行に適用`, warn: false })
  }
  if (pick.batch.kind !== 'keep') lines.push({ text: `精算バッチ → ${valueText(pick.batch, labels.batch)}: ${n}行に適用`, warn: false })
  if (pick.memberId !== null) lines.push({ text: `世帯メンバー → ${labels.member(pick.memberId)}: ${n}行に適用`, warn: false })
  return lines
}
