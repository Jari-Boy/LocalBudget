import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { AutoBalanceAdjustmentDescription } from '../../domain/journal/describeAutoBalanceAdjustment'

export interface AutoBalanceAdjustmentDetailProps {
  entry: JournalEntry
  description: AutoBalanceAdjustmentDescription
  accountNameOf: (accountId: number) => string
  /** ずれた期間の、その科目の仕訳を一覧で見る */
  onShowPeriod: () => void
  /** 科目の「残高の照合」欄を開く。省略時は導線を出さない */
  onOpenReconciliation?: () => void
}

const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`

/**
 * 自動調整仕訳(計画Issue #205)の詳細パネル。計算で導出されるデータなので読み取り専用にし、
 * 「自動で作られた仕訳であること」「ずれた期間と内容」と、その期間の仕訳・科目の照合への導線だけを出す。
 * 編集・削除・関連付けの操作は出さない。
 */
export function AutoBalanceAdjustmentDetail({
  entry,
  description,
  accountNameOf,
  onShowPeriod,
  onOpenReconciliation,
}: AutoBalanceAdjustmentDetailProps) {
  const accountName = accountNameOf(description.accountId)
  const isCapital = description.kind === 'capital'

  return (
    <div className="journal-screen__auto" role="group" aria-label="自動調整の内容">
      <p className="journal-screen__note">
        この仕訳は、{accountName}の残高の基準点に合わせて自動で作られました。編集・削除・関連付けはできません。
        {isCapital ? '基準点の日の残高に合わせた、最初の残高(元手)の仕訳です。' : '原因を直すと、この仕訳は消えるか金額が変わります。'}
      </p>
      <dl className="journal-screen__auto-facts">
        <div>
          <dt>科目</dt>
          <dd>{accountName}</dd>
        </div>
        <div>
          <dt>種類</dt>
          <dd>{isCapital ? '初期残高(最初の基準点)' : '残高の自動調整'}</dd>
        </div>
        <div>
          <dt>{isCapital ? '基準点の日' : 'ずれた期間'}</dt>
          <dd>{isCapital ? description.periodEnd : `${description.periodStart}〜${description.periodEnd}`}</dd>
        </div>
        <div>
          <dt>摘要</dt>
          <dd>{entry.memo}</dd>
        </div>
      </dl>
      <table className="journal-screen__auto-lines">
        <caption>仕訳の内容</caption>
        <thead>
          <tr>
            <th scope="col">借方・貸方</th>
            <th scope="col">科目</th>
            <th scope="col">金額</th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.side === 'debit' ? '借方' : '貸方'}</td>
              <td>{accountNameOf(line.accountId)}</td>
              <td>{yen(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="journal-screen__actions">
        {!isCapital && (
          <button type="button" className="journal-screen__button" onClick={onShowPeriod}>
            この期間の仕訳を見る
          </button>
        )}
        {onOpenReconciliation && (
          <button type="button" className="journal-screen__button" onClick={onOpenReconciliation}>
            科目の照合を見る
          </button>
        )}
      </div>
    </div>
  )
}
