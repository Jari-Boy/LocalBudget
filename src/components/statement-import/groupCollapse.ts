/**
 * 明細取込画面の一覧のグループ折りたたみ(計画Issue #231 フェーズ1)の純粋関数。
 * 3グループ(重複・似た取引あり・問題なし)ごとの開閉と、見出しに出す「未確認の行数」を扱う。
 * 折りたたんでも、行は処理の対象から外れない(全選択・一括操作・確定は表示の有無によらない)。DB・DOM非依存。
 */
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { rowGroup, rowStatus, type ImportRowState, type RowGroup } from './importRowModel'

/** 折りたたんでいるグループ。空なら全グループが開いている(初期状態) */
export type CollapsedGroups = ReadonlySet<RowGroup>

/** グループの開閉を切り替える。元の集合は書き換えない */
export function toggleCollapsedGroup(collapsed: CollapsedGroups, group: RowGroup): CollapsedGroups {
  const next = new Set(collapsed)
  if (next.has(group)) next.delete(group)
  else next.add(group)
  return next
}

/** グループを開く(重複元の行へ移るときの自動展開)。すでに開いていれば同じ集合を返す */
export function expandGroup(collapsed: CollapsedGroups, group: RowGroup): CollapsedGroups {
  if (!collapsed.has(group)) return collapsed
  const next = new Set(collapsed)
  next.delete(group)
  return next
}

type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

/**
 * グループごとの「未確認」の行数。ステータスが「要確認」(相手科目が決まっていない、置き換え対象が未選択)の行を数える。
 * 取り込み対象外の行(重複・保存しない)は数えない。折りたたみ中の見出しに出して、見えない行の確認漏れに気づけるようにする。
 * indicesには、確定済みを除いた表示対象の行の番号を渡す。
 */
export function countUncheckedByGroup(
  indices: readonly number[],
  records: readonly RowRecord[],
  rows: readonly ImportRowState[],
): Record<RowGroup, number> {
  const counts: Record<RowGroup, number> = { duplicate: 0, similar: 0, clean: 0 }
  for (const i of indices) {
    if (rowStatus(records[i], rows[i]) === 'check') counts[rowGroup(records[i])]++
  }
  return counts
}
