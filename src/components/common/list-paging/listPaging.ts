/**
 * 一覧の分割表示(「さらにN件表示」)の表示件数を決める。仕訳一覧(計画Issue #253)から共通部品に切り出し、
 * 割勘画面(計画Issue #268)も使う。絞り込みと並べ替えは全件に対して今までどおり行い、描画だけをページ分ずつに分ける。
 */

/**
 * 実際に表示する件数。上限(`limit`)までだが、選択中の行(`selectedIndex`、並べ替え後の0始まりの位置。
 * 選択が無ければ-1。複数選択なら表示順でいちばん後ろの位置)が範囲の外にあるときは、その行を含む最小のページ分まで広げる
 * (選択中の行が見えなくならないため)。全体件数(`total`)は超えない。
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
