import type { JournalViewMode } from './journalViewMode'

/**
 * 仕訳一覧の分割表示(「さらにN件表示」、計画Issue #253)の1回の表示件数。
 * 表示件数を決める関数と「さらに表示」の部品は、割勘画面(計画Issue #268)と共通で
 * `common/list-paging/` にある。
 */

/**
 * 1回に表示する仕訳の件数(表示方式ごと)。計測の結果(計画Issue #253のコメント。2000件のデータで、100件・150件・200件の
 * 順に明細行の行クリックが約170ms・約300ms・約430ms)から150件にした。明細行単位は行クリックのたびに全行を描き直すため、
 * 重くなったら仕訳単位より少なくできる。
 */
export const JOURNAL_LIST_PAGE_SIZE: Record<JournalViewMode, number> = {
  entry: 150,
  line: 150,
}
