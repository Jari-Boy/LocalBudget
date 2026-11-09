import type { Account } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './SplitSettleScreen.css'

export interface EntryDetailDialogProps {
  entry: JournalEntry
  accounts: readonly Pick<Account, 'id' | 'name'>[]
  members: readonly { id: number; name: string }[]
  counterparties: readonly { id: number; name: string }[]
  batches: readonly { id: number; name: string }[]
  onClose: () => void
}

/**
 * 仕訳の詳細ダイアログ(計画Issue #153)。割勘履歴・精算バッチの仕訳を、仕訳画面へ移動せずに
 * 読み取り専用で確認する。編集は仕訳画面で行う。
 */
export function EntryDetailDialog({ entry, accounts, members, counterparties, batches, onClose }: EntryDetailDialogProps) {
  const nameOf = (list: readonly { id: number; name: string }[], id: number | null) =>
    list.find((item) => item.id === id)?.name ?? ''

  return (
    <div className="split-settle__backdrop">
      <div role="dialog" aria-modal="true" aria-label="仕訳の詳細" className="split-settle__dialog">
        <h2 className="split-settle__h2">仕訳の詳細</h2>
        <dl className="split-settle__detail">
          <dt>日付</dt>
          <dd>{entry.entryDate}</dd>
          <dt>摘要</dt>
          <dd>{entry.memo === null || entry.memo === '' ? '(摘要なし)' : entry.memo}</dd>
          {entry.comment !== null && entry.comment !== '' && (
            <>
              <dt>コメント</dt>
              <dd>{entry.comment}</dd>
            </>
          )}
        </dl>
        <div className="split-settle__scroll">
          <table className="split-settle__table">
            <thead>
              <tr>
                <th>区分</th>
                <th>科目</th>
                <th className="split-settle__num">金額</th>
                <th>世帯メンバー</th>
                <th>取引先</th>
                <th>精算バッチ</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.side === 'debit' ? '借方' : '貸方'}</td>
                  <td>{nameOf(accounts, l.accountId)}</td>
                  <td className="split-settle__num">{formatCurrency(l.amount, 'JPY')}</td>
                  <td>{nameOf(members, l.householdMemberId)}</td>
                  <td>{nameOf(counterparties, l.counterpartyId)}</td>
                  <td>{nameOf(batches, l.settlementBatchId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="split-settle__dialog-actions">
          <button type="button" className="split-settle__btn" autoFocus onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
