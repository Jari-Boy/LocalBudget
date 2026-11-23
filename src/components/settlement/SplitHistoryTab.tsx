import { useMemo, useState } from 'react'
import { buildRelatedEntryIdsByEntryId } from '../../domain/journal-link-group/buildRelatedEntryIdsByEntryId'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import { ListLoadMore } from '../common/list-paging/ListLoadMore'
import { nextDisplayLimit } from '../common/list-paging/listPaging'
import { StickyHeaderTable } from '../common/sticky/StickyHeaderTable'
import { EntryDetailDialog } from './EntryDetailDialog'
import type { SplitSettleData, SplitSettleRepositories } from './splitSettleData'
import { SPLIT_LIST_PAGE_SIZE } from './splitListPaging'
import { buildSplitHistoryRows } from './splitSettleModel'
import './SplitSettleScreen.css'

export interface SplitHistoryTabProps {
  data: SplitSettleData
  repositories: SplitSettleRepositories
  /** 書き込みのあとにデータを読み直す */
  onChanged: () => Promise<void>
}

/**
 * 履歴タブ(計画Issue #268)。割勘タブの最下部にあった「過去の割勘」を、画面最上位のタブに移したもの。
 * これまでの割勘を相手・負担額・状態つきで出し、「未精算」「精算済み」で分ける。精算が進んでいない割勘は
 * 2回押して取り消せる(取り消した結果、紐づく仕訳が0件になった精算バッチは残さずに削除する)。
 * 摘要を押すと、仕訳画面へ移動せず詳細をダイアログで見られる。件数が多いときは150件ずつ「さらにN件表示」で出す。
 * 取り消しの確認と詳細ダイアログの状態は、このタブが持つ(割勘タブと行き来すると、確認中の状態は戻る)。
 */
export function SplitHistoryTab({ data, repositories, onChanged }: SplitHistoryTabProps) {
  const [historyStatus, setHistoryStatus] = useState<'open' | 'settled'>('open')
  /** 「さらに表示」で増やした表示件数の上限。未精算/精算済みを切り替えると先頭の1ページ分に戻す */
  const [displayLimit, setDisplayLimit] = useState<number>(SPLIT_LIST_PAGE_SIZE.history)
  const [confirmingCancelId, setConfirmingCancelId] = useState<number | null>(null)
  const [detailEntryId, setDetailEntryId] = useState<number | null>(null)

  const relatedIds = useMemo(() => buildRelatedEntryIdsByEntryId(data.memberships), [data.memberships])
  const historyRows = useMemo(
    () => buildSplitHistoryRows(data.entries, data.accounts, relatedIds, data.members, data.counterparties),
    [data.entries, data.accounts, relatedIds, data.members, data.counterparties],
  )

  const openCount = historyRows.filter((r) => !r.isSettled).length
  const settledCount = historyRows.length - openCount
  const matchedHistory = historyRows.filter((r) => r.isSettled === (historyStatus === 'settled'))
  const shownCount = Math.min(matchedHistory.length, displayLimit)
  const shownHistory = matchedHistory.slice(0, shownCount)
  const detailEntry = data.entries.find((e) => e.id === detailEntryId)

  const cancelSplit = async (splitEntryId: number) => {
    setConfirmingCancelId(null)
    const splitEntry = data.entries.find((e) => e.id === splitEntryId)
    await repositories.journalEntryRepository.delete(splitEntryId)
    // 取り消した結果、紐づく仕訳が0件になった精算バッチは残さずに削除する
    const batchIds = new Set(
      (splitEntry?.lines ?? []).flatMap((l) => (l.settlementBatchId === null ? [] : [l.settlementBatchId])),
    )
    for (const batchId of batchIds) {
      const stillUsed = data.entries.some(
        (e) => e.id !== splitEntryId && e.lines.some((l) => l.settlementBatchId === batchId),
      )
      if (!stillUsed) await repositories.settlementBatchRepository.delete(batchId)
    }
    await onChanged()
  }

  return (
    <>
      <section aria-label="割勘履歴" className="split-settle__card split-settle__card--table">
        <div className="split-settle__history-head">
          <h2 className="split-settle__h2">過去の割勘</h2>
          <div role="group" aria-label="精算状況で絞り込む" className="split-settle__filters">
            {(
              [
                { key: 'open', label: '未精算', count: openCount },
                { key: 'settled', label: '精算済み', count: settledCount },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={historyStatus === item.key}
                className={`split-settle__btn split-settle__btn--small${historyStatus === item.key ? ' split-settle__btn--pressed' : ''}`}
                onClick={() => {
                  setHistoryStatus(item.key)
                  setDisplayLimit(SPLIT_LIST_PAGE_SIZE.history)
                  setConfirmingCancelId(null)
                }}
              >
                {item.label} {item.count}
              </button>
            ))}
          </div>
        </div>
        {matchedHistory.length === 0 && (
          <p className="split-settle__empty">
            {historyStatus === 'open' ? '未精算の割勘はありません' : '精算済みの割勘はありません'}
          </p>
        )}
        <StickyHeaderTable
          frameClassName="split-settle__scroll"
          tableClassName="split-settle__table"
          floatingClassName="floating-table-header--bare"
          head={
            <thead>
              <tr>
                <th>日付</th>
                <th>摘要</th>
                <th>相手</th>
                <th className="split-settle__num">相手の負担額</th>
                <th>状態</th>
                <th>取り消し</th>
              </tr>
            </thead>
          }
        >
          <tbody>
            {shownHistory.map((row) => (
              <tr key={row.splitEntryId}>
                <td className="split-settle__nowrap">{row.date}</td>
                <td>
                  <button type="button" className="split-settle__link" onClick={() => setDetailEntryId(row.splitEntryId)}>
                    {row.memo === '' ? '(摘要なし)' : row.memo}
                  </button>
                </td>
                <td>{row.partner}</td>
                <td className="split-settle__num">{formatCurrency(row.amount, 'JPY')}</td>
                <td>{row.isSettled ? '精算済み' : '未精算'}</td>
                <td>
                  {!row.canCancel ? (
                    <span className="split-settle__note">精算が進んでいるため取り消せません</span>
                  ) : confirmingCancelId === row.splitEntryId ? (
                    <span className="split-settle__confirm">
                      <button
                        type="button"
                        className="split-settle__btn split-settle__btn--small"
                        onClick={() => setConfirmingCancelId(null)}
                      >
                        やめる
                      </button>
                      <button
                        type="button"
                        className="split-settle__btn split-settle__btn--small split-settle__btn--danger"
                        onClick={() => void cancelSplit(row.splitEntryId)}
                      >
                        本当に取り消す
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="split-settle__btn split-settle__btn--small"
                      onClick={() => setConfirmingCancelId(row.splitEntryId)}
                    >
                      この割勘を取り消す
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </StickyHeaderTable>
        <ListLoadMore
          total={matchedHistory.length}
          shown={shownCount}
          pageSize={SPLIT_LIST_PAGE_SIZE.history}
          onMore={() => setDisplayLimit(nextDisplayLimit(shownCount, SPLIT_LIST_PAGE_SIZE.history))}
        />
      </section>

      {detailEntry !== undefined && (
        <EntryDetailDialog
          entry={detailEntry}
          accounts={data.accounts}
          members={data.members}
          counterparties={data.counterparties}
          batches={data.batches}
          onClose={() => setDetailEntryId(null)}
        />
      )}
    </>
  )
}
