import { moreButtonCount } from './listPaging'
import './ListLoadMore.css'

export interface ListLoadMoreProps {
  /** 絞り込み後の全体件数 */
  total: number
  /** 今表示している件数 */
  shown: number
  /** 1回に増やす件数 */
  pageSize: number
  onMore: () => void
}

/**
 * 一覧(仕訳一覧の仕訳単位・明細行単位、割勘画面の候補・履歴)の末尾に出す、表示件数と「さらにN件表示」ボタン
 * (計画Issue #253、共通部品化は計画Issue #268)。全件を表示済みなら何も出さない。
 */
export function ListLoadMore({ total, shown, pageSize, onMore }: ListLoadMoreProps) {
  const more = moreButtonCount({ total, shown, pageSize })
  if (more === 0) return null
  return (
    <div className="list-load-more">
      <p role="status" className="list-load-more__note">
        {`${shown.toLocaleString('ja-JP')} / ${total.toLocaleString('ja-JP')}件を表示中`}
      </p>
      <button type="button" className="list-load-more__button" onClick={onMore}>
        {`さらに${more.toLocaleString('ja-JP')}件表示`}
      </button>
    </div>
  )
}
