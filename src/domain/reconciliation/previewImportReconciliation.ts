import type { JournalLineSide } from '../journal/JournalEntry'
import {
  planBalanceAnchorAdjustments,
  type LedgerDelta,
  type PlannedAdjustment,
} from './planBalanceAnchorAdjustments'
import { resolveStatementAnchors, type StatementAnchorSource } from './resolveStatementAnchors'

export interface ImportPreviewLine {
  journalEntryId: number
  entryDate: string
  side: JournalLineSide
  amount: number
  sourceType: string
}

export interface ImportPreviewRef extends StatementAnchorSource {
  journalEntryId: number
}

export interface ImportPreviewRow {
  entryDate: string
  /** 正 = 科目の残高が増える方向 */
  amount: number
  balanceAfter: number | null
  /** CSV上の行の順番 */
  rowOrder: number
}

export interface PreviewImportReconciliationParams {
  /** 取込先の既存の明細行(自動調整仕訳の行を含んでよい。除いて数える) */
  existingLines: readonly ImportPreviewLine[]
  /** 取込先の既存の突合マスタ */
  existingRefs: readonly ImportPreviewRef[]
  /** 確定版として置き換える旧仕訳のid。帳簿と基準点から除く */
  replacedEntryIds: ReadonlySet<number>
  /** 今回取り込む行 */
  newRows: readonly ImportPreviewRow[]
  autoAdjust: boolean
}

export interface ImportReconciliationGap {
  periodStart: string
  periodEnd: string
  /** 取り込んだ後に区間の終わりで調整される額(符号付き、残高が増える向きが正) */
  amount: number
  /** 調整前の帳簿残高(区間の終わりの日) */
  bookBalance: number
}

export interface ImportReconciliationPreview {
  /** 2つ目以降の基準点の区間ごとの食い違い */
  gaps: ImportReconciliationGap[]
  /** 最初の基準点の差額(元手、初期残高の仕訳になる)。無ければnull */
  capital: PlannedAdjustment | null
  /** 自動調整がオンで、gapsが調整仕訳として入るか(オフなら表示のみ) */
  adjusted: boolean
}

/** 今回の取込を、既存の取込(importedAt)と区別するための取込日時。並び順の判定は取込単位で行う */
const NEW_IMPORT_KEY = '￿-new-import'

/**
 * 明細取込の確定前に、基準点(取引後残高)に対する帳簿のずれを予測する純粋関数(計画Issue #205)。
 * 取込先は取引後残高のある資産科目(is_reconcilable = true)を想定し、残高が増える向きは借方。
 * 既存の基準点・帳簿に今回取り込む行を加えて planBalanceAnchorAdjustments で計算するため、
 * 古いCSVでも各基準点の日までの帳簿で比べ、CSV最終日より後の取引で偽陽性にならない。
 */
export function previewImportReconciliation(params: PreviewImportReconciliationParams): ImportReconciliationPreview {
  const ledger: LedgerDelta[] = [
    ...params.existingLines
      .filter((line) => line.sourceType !== 'auto_balance_adjustment' && !params.replacedEntryIds.has(line.journalEntryId))
      .map((line) => ({ date: line.entryDate, delta: line.side === 'debit' ? line.amount : -line.amount })),
    ...params.newRows.map((row) => ({ date: row.entryDate, delta: row.amount })),
  ]

  const refs: StatementAnchorSource[] = [
    ...params.existingRefs.filter((ref) => !params.replacedEntryIds.has(ref.journalEntryId)),
    ...params.newRows.map((row, index) => ({
      id: Number.MAX_SAFE_INTEGER - index,
      entryDate: row.entryDate,
      amount: row.amount,
      externalBalanceAfter: row.balanceAfter,
      rowOrder: row.rowOrder,
      importedAt: NEW_IMPORT_KEY,
    })),
  ]

  const plan = planBalanceAnchorAdjustments({
    anchors: resolveStatementAnchors(refs),
    ledger,
    autoAdjust: params.autoAdjust,
  })

  const gaps = plan.rows
    .filter((row) => !row.isCapital && (row.adjustment !== 0 || row.discrepancy !== 0))
    .map((row) => ({
      periodStart: row.periodStart!,
      periodEnd: row.date,
      amount: row.adjustment !== 0 ? row.adjustment : row.discrepancy,
      bookBalance: row.bookBalance,
    }))
  return {
    gaps,
    capital: plan.adjustments.find((adjustment) => adjustment.kind === 'capital') ?? null,
    adjusted: params.autoAdjust,
  }
}
