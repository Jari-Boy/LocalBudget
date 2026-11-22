import { moreButtonCount } from './journalListPaging'

export interface JournalListLoadMoreProps {
  /** 絞り込み後の全体件数 */
  total: number
  /** 今表示している件数 */
  shown: number
  /** 1回に増やす件数 */
  pageSize: number
  onMore: () => void
}

/**
 * 仕訳一覧(仕訳単位・明細行単位)の末尾に出す、表示件数と「さらにN件表示」ボタン(計画Issue #253)。
 * 全件を表示済みなら何も出さない。
 */
export function JournalListLoadMore({ total, shown, pageSize, onMore }: JournalListLoadMoreProps) {
  const more = moreButtonCount({ total, shown, pageSize })
  if (more === 0) return null
  return (
    <div className="journal-screen__more">
      <p role="status" className="journal-screen__note">
        {`${shown.toLocaleString('ja-JP')} / ${total.toLocaleString('ja-JP')}件を表示中`}
      </p>
      <button type="button" className="journal-screen__button" onClick={onMore}>
        {`さらに${more.toLocaleString('ja-JP')}件表示`}
      </button>
    </div>
  )
}
