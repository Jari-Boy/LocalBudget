/**
 * 明細取込画面の一覧のタブ分けとページ送り(計画Issue #263)の純粋関数。
 * 行は「新規」「重複」の2つのタブに分け(日付・金額を読めない行は行ではないので、3つ目のタブとして別に出す)、
 * 取り込み済みと完全一致して取り込まない行だけを「重複」に出す。似た取引の行は「新規」の中に並べ、先頭に寄せる。
 * 1ページに描く件数はタブごとに区切り、描画だけを分ける(状態・確定の対象は全件のまま)。DB・DOM非依存。
 */
import type { StatementImportReviewRecord } from '../../domain/statement-import/buildStatementImportReview'
import { rowGroup, rowStatus, type ImportRowState } from './importRowModel'

/** タブの内容(tabpanel)のid。タブの aria-controls と、内容側の id で共有する */
export const importTabPanelId = (key: ImportTabKey) => `import-tabpanel-${key}`

/** 行のあるタブ。「取り込まない行」のタブは行の一覧ではないので、ここには含めない */
export type RowTab = 'new' | 'duplicate'

/** タブの全種類(「取り込まない行」を含む) */
export type ImportTabKey = RowTab | 'unreadable'

/**
 * 1ページに描く行の数(タブごと)。400件規模でも操作が重くならない件数として実測して決める(計画Issue #263)。
 * 値の根拠は docs/decisions.md の同Issueの項に書く。
 */
export const IMPORT_PAGE_SIZE = 100

type RowRecord = Pick<StatementImportReviewRecord, 'isExactDuplicate' | 'approximateCandidates'>

/**
 * 行が出るタブ。取り込み済みと完全一致して取り込まない行(ステータスが「重複」)だけ「重複」、それ以外は「新規」。
 * 「取り込む」を選んだ重複の行は「新規」に移る。似た取引を「保存しない」にした行も、選び直せるよう「新規」に残す。
 */
export function tabOfRow(record: RowRecord, state: ImportRowState): RowTab {
  return rowStatus(record, state) === 'duplicate' ? 'duplicate' : 'new'
}

/**
 * 「新規」タブの中の並びの優先度。似た取引の行(0)を先頭に寄せ、ページが分かれても判断が必要な行が1ページ目に出るようにする。
 * ほかの行(「取り込む」を選んだ重複の行を含む)は後ろ(1)。取り込んだ内容で決まり、入力しても動かない。
 */
export function newTabRank(record: RowRecord): 0 | 1 {
  return rowGroup(record) === 'similar' ? 0 : 1
}

/**
 * 行の番号をタブに振り分け、タブの中の並びを決める。「新規」は似た取引の行(newTabRank=0)が先頭で、
 * 同じ優先度の中は`compare`(並び替えの比較。同じなら取り込んだ順)で並べる。「重複」は`compare`だけで並べる。
 * indicesには、確定済みを除いた表示対象の行の番号を渡す。
 */
export function buildTabIndices(
  indices: readonly number[],
  records: readonly RowRecord[],
  rows: readonly ImportRowState[],
  compare: (a: number, b: number) => number,
): Record<RowTab, number[]> {
  const tabs: Record<RowTab, number[]> = { new: [], duplicate: [] }
  for (const i of indices) tabs[tabOfRow(records[i], rows[i])].push(i)
  tabs.new.sort((a, b) => newTabRank(records[a]) - newTabRank(records[b]) || compare(a, b))
  tabs.duplicate.sort(compare)
  return tabs
}

/** ページ番号を1〜ページ数の範囲に収める。ページ数が0のときは1 */
export function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(page, 1), Math.max(pageCount, 1))
}

export interface PageRange {
  /** 範囲に収めたあとのページ番号(1始まり) */
  page: number
  pageCount: number
  /** 行の並びから切り出す範囲(startを含み、endを含まない) */
  start: number
  end: number
  /** 「1–50 / N件」に出す、1始まりで両端を含む番号。行が無いときは0・0 */
  from: number
  to: number
}

/** 全体の件数とページ番号から、そのページの範囲を求める。範囲外のページ番号(確定で行が減ったとき)は最終ページに収める */
export function pageRange(args: { total: number; page: number; pageSize: number }): PageRange {
  const { total, pageSize } = args
  const pageCount = Math.ceil(total / pageSize)
  const page = clampPage(args.page, pageCount)
  const start = pageCount === 0 ? 0 : (page - 1) * pageSize
  const end = Math.min(total, start + pageSize)
  return { page, pageCount, start, end, from: end === 0 ? 0 : start + 1, to: end }
}

/** ページ番号の並び。数字か、省略(…)を表す'gap' */
export type PageNumberItem = number | 'gap'

/**
 * ページ送りに並べる番号。先頭と最終ページは常に出し、いまのページの前後を添え、離れた所は'gap'(…)で省く。
 * 先頭(最終)に近いときは、その側の数ページをまとめて出す。ページが1つ以下なら並べない。
 */
export function pageNumbers(page: number, pageCount: number): PageNumberItem[] {
  if (pageCount <= 1) return []
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, i) => i + 1)
  if (page <= 3) return [1, 2, 3, 4, 'gap', pageCount]
  if (page >= pageCount - 2) return [1, 'gap', pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
  return [1, 'gap', page - 1, page, page + 1, 'gap', pageCount]
}

export interface TabSummary {
  newCount: number
  duplicateCount: number
  /** 「新規」タブにある、似た取引の行の数(「保存しない」にした行は数えない) */
  similarCount: number
  /** 「新規」タブにある、未入力(相手科目などが決まっていない=ステータスが「要確認」)の行の数 */
  uncheckedCount: number
}

/**
 * タブの見出しに出す件数と状態。indicesには、確定済みを除いた表示対象の行の番号を渡す。
 * ほかのタブの行は見えないので、見出しに件数と状態を出して、確認の漏れに気づけるようにする。
 */
export function summarizeTabs(
  indices: readonly number[],
  records: readonly RowRecord[],
  rows: readonly ImportRowState[],
): TabSummary {
  const summary: TabSummary = { newCount: 0, duplicateCount: 0, similarCount: 0, uncheckedCount: 0 }
  for (const i of indices) {
    const status = rowStatus(records[i], rows[i])
    if (status === 'duplicate') {
      summary.duplicateCount++
      continue
    }
    summary.newCount++
    if (status === 'skipped') continue
    if (rowGroup(records[i]) === 'similar') summary.similarCount++
    if (status === 'check') summary.uncheckedCount++
  }
  return summary
}
