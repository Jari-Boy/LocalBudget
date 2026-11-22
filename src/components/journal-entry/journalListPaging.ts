import type { JournalViewMode } from './journalViewMode'

/**
 * 仕訳一覧の分割表示(「さらにN件表示」、計画Issue #253)の表示件数を決める。
 * 絞り込みと並べ替えは全件に対して今までどおり行い、描画だけをページ分ずつに分ける。
 */

/**
 * 1回に表示する仕訳の件数(表示方式ごと)。仮の値で、計測の結果(計画Issue #253のコメント)と実際の
 * 操作感を見て決める。明細行単位は行クリックのたびに全行を描き直すため、仕訳単位より少なくする余地がある。
 */
export const JOURNAL_LIST_PAGE_SIZE: Record<JournalViewMode, number> = {
  entry: 200,
  line: 200,
}

/**
 * 実際に表示する件数。上限(`limit`)までだが、選択中の仕訳(`selectedIndex`、並べ替え後の0始まりの位置。
 * 選択が無ければ-1)が範囲の外にあるときは、その仕訳を含む最小のページ分まで広げる(選択中の仕訳が見えなくならないため)。
 * 全体件数(`total`)は超えない。
 */
export function resolveShownCount(args: { total: number; limit: number; pageSize: number; selectedIndex: number }): number {
  const { total, limit, pageSize, selectedIndex } = args
  const needed = selectedIndex < 0 ? 0 : Math.ceil((selectedIndex + 1) / pageSize) * pageSize
  return Math.min(total, Math.max(limit, needed))
}

/** 「さらに表示」を押した後の表示件数の上限 */
export function nextDisplayLimit(shown: number, pageSize: number): number {
  return shown + pageSize
}

/** 「さらにN件表示」のN。残りがページ分に満たなければ残りの件数。全件を表示済みなら0(ボタンを出さない) */
export function moreButtonCount(args: { total: number; shown: number; pageSize: number }): number {
  return Math.max(0, Math.min(args.pageSize, args.total - args.shown))
}
