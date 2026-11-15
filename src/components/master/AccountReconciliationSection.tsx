import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountBalanceRecordRepository } from '../../domain/reconciliation/AccountBalanceRecordRepository'
import type {
  AccountBalanceRecord,
  AccountReconciliation,
  BalanceRecordPreview,
} from '../../domain/reconciliation/AccountBalanceRecord'
import type { MaybeAsync } from './maybeAsync'
import './master.css'

export type ReconciliationRepository = MaybeAsync<
  Pick<
    AccountBalanceRecordRepository,
    'create' | 'update' | 'delete' | 'findByAccount' | 'describeReconciliation' | 'previewRecord'
  >
>

export interface AccountReconciliationSectionProps {
  account: Account
  repository: ReconciliationRepository
  busy: boolean
  /** 自動調整のオン・オフを科目に保存する。保存できたらtrue */
  onToggleAutoAdjust: (next: boolean) => Promise<boolean>
  /** 記録・調整仕訳が変わったあと、親が仕訳などを読み直す */
  onChanged: () => Promise<void>
  /** 記録欄の日付の初期値(YYYY-MM-DD)。省略時は今日 */
  today?: string
  /** 親が仕訳を読み直すたびに変わる値。変わったら照合表を取り直す */
  reloadToken: unknown
}

const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`
/** 符号付き(正は+、負は−)。0は「—」 */
const signedYen = (amount: number) => (amount === 0 ? '—' : `${amount > 0 ? '+' : '−'}${yen(Math.abs(amount))}`)

/**
 * 資産・負債の科目の右パネルの「残高の照合」欄(計画Issue #205、docs/domain/reconciliation.md 1.5・1.6)。
 * 自動調整のオン・オフ、手で記録する科目の「残高を記録する」フォーム(金額を入れるとその日の帳簿との差と
 * 記録すると入る調整額をその場で表示)、基準点ごとの表(最後の行が元手=初期残高)と
 * 自動調整の合計(初期残高を除く)を出す。取引後残高のあるCSVの科目は記録欄・編集・削除を出さない。
 */
export function AccountReconciliationSection(props: AccountReconciliationSectionProps) {
  const { account, repository, busy } = props
  const { t } = useTranslation('master')
  const tooltipId = useId()
  const [data, setData] = useState<AccountReconciliation | null>(null)
  const [records, setRecords] = useState<AccountBalanceRecord[]>([])
  const [date, setDate] = useState(() => props.today ?? new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [preview, setPreview] = useState<BalanceRecordPreview | null>(null)
  const [editing, setEditing] = useState<{ id: number; date: string; balance: string } | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  const reload = useCallback(async () => {
    const [reconciliation, recorded] = await Promise.all([
      Promise.resolve(repository.describeReconciliation(account.id)),
      Promise.resolve(repository.findByAccount(account.id)),
    ])
    setData(reconciliation)
    setRecords(recorded)
  }, [repository, account.id])

  useEffect(() => {
    void reload()
  }, [reload, props.reloadToken])

  const amountValue = amount.trim() === '' ? null : Number(amount)
  const amountValid = amountValue !== null && Number.isFinite(amountValue) && amountValue >= 0 && date !== ''
  useEffect(() => {
    if (!amountValid) {
      setPreview(null)
      return
    }
    let cancelled = false
    void Promise.resolve(repository.previewRecord(account.id, date, amountValue)).then((result) => {
      if (!cancelled) setPreview(result)
    })
    return () => {
      cancelled = true
    }
  }, [repository, account.id, date, amountValue, amountValid, props.reloadToken])

  if (!data) return null

  const usesStatement = data.usesStatement
  const rowsNewestFirst = [...data.rows].reverse()
  const recordByDate = new Map(records.map((r) => [r.recordDate, r]))
  const adjustmentTotal = data.rows.filter((r) => !r.isCapital).reduce((sum, r) => sum + r.adjustment, 0)
  const disabled = busy || working

  const perform = async (action: () => Promise<unknown>): Promise<boolean> => {
    setWorking(true)
    setError('')
    try {
      await action()
      await props.onChanged()
      await reload()
      return true
    } catch {
      setError(t('reconcile.error'))
      return false
    } finally {
      setWorking(false)
    }
  }

  const submit = async () => {
    if (!amountValid) return
    const saved = await perform(() =>
      Promise.resolve(repository.create({ accountId: account.id, recordDate: date, balance: amountValue })),
    )
    if (saved) setAmount('')
  }

  const saveEdit = async () => {
    if (!editing) return
    const balance = Number(editing.balance)
    if (editing.balance.trim() === '' || !Number.isFinite(balance) || balance < 0 || editing.date === '') return
    const saved = await perform(() =>
      Promise.resolve(repository.update(editing.id, { recordDate: editing.date, balance })),
    )
    if (saved) setEditing(null)
  }

  const previewText = (p: BalanceRecordPreview) =>
    p.adjustment === 0
      ? t('reconcile.previewMatch', { book: yen(p.bookBalance) })
      : t('reconcile.previewDiff', {
          book: yen(p.bookBalance),
          diff: signedYen(p.adjustment),
          adjustment: signedYen(p.adjustment),
        })

  const balanceHeader = t(usesStatement ? 'reconcile.colStatementBalance' : 'reconcile.colRecordedBalance')

  return (
    <section className="master-subsection" aria-label={t('reconcile.title')}>
      <h3 className="master-subsection__title">{t('reconcile.title')}</h3>

      {/* 説明はマウスオーバー(またはフォーカス)で出す角丸のツールチップ。標準のtitleは枠の形を変えられない */}
      <div className="master-tooltip">
        <label className="master-check">
          <input
            type="checkbox"
            aria-describedby={tooltipId}
            checked={account.autoBalanceAdjustment}
            disabled={disabled}
            onChange={(event) => void perform(() => props.onToggleAutoAdjust(event.target.checked))}
          />
          {t('reconcile.autoAdjust')}
          <span className="master-hint" aria-hidden="true">
            ⓘ
          </span>
        </label>
        <span id={tooltipId} role="tooltip" className="master-tooltip__bubble">
          {t('reconcile.autoAdjustNote')}
        </span>
      </div>

      {usesStatement ? (
        <p className="master-note">{t('reconcile.statementOnly')}</p>
      ) : (
        <fieldset className="master-checklist" aria-label={t('reconcile.formTitle')}>
          <legend className="master-checklist__legend">{t('reconcile.formTitle')}</legend>
          <p className="master-note">{t('reconcile.formNote')}</p>
          <div className="master-reconcile__form">
            <div className="master-field">
              <label className="master-field__label" htmlFor="reconcile-date">
                {t('reconcile.date')}
              </label>
              <input
                id="reconcile-date"
                type="date"
                className="master-field__control"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="master-field">
              <label className="master-field__label" htmlFor="reconcile-amount">
                {t('reconcile.amount')}
              </label>
              <input
                id="reconcile-amount"
                className="master-field__control"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="master-btn master-btn--primary"
              disabled={disabled || !amountValid}
              onClick={() => void submit()}
            >
              {t('reconcile.record')}
            </button>
          </div>
          {preview && <p className="master-note">{previewText(preview)}</p>}
        </fieldset>
      )}

      {error && (
        <p role="alert" className="master-error">
          {error}
        </p>
      )}

      {rowsNewestFirst.length === 0 ? (
        <p className="master-note">{t('reconcile.empty')}</p>
      ) : (
        <table className="master-reconcile__table">
          <thead>
            <tr>
              <th scope="col">{t('reconcile.colDate')}</th>
              <th scope="col">{t('reconcile.colPeriod')}</th>
              <th scope="col">{balanceHeader}</th>
              <th scope="col">{t('reconcile.colBook')}</th>
              <th scope="col">{t('reconcile.colAdjustment')}</th>
              {!usesStatement && <th scope="col" aria-label={t('reconcile.colActions')} />}
            </tr>
          </thead>
          <tbody>
            {rowsNewestFirst.map((row) => {
              const record = recordByDate.get(row.date)
              const isEditing = editing !== null && record !== undefined && editing.id === record.id
              return (
                <tr key={row.date} aria-label={row.date}>
                  <td>
                    {isEditing ? (
                      <input
                        type="date"
                        aria-label={t('reconcile.date')}
                        value={editing.date}
                        onChange={(event) => setEditing({ ...editing, date: event.target.value })}
                      />
                    ) : (
                      row.date
                    )}
                  </td>
                  <td>
                    {row.isCapital ? (
                      <span className="master-reconcile__capital">{t('reconcile.capital')}</span>
                    ) : (
                      `${row.periodStart}〜${row.date}`
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        aria-label={t('reconcile.recordedBalance')}
                        inputMode="numeric"
                        value={editing.balance}
                        onChange={(event) => setEditing({ ...editing, balance: event.target.value })}
                      />
                    ) : (
                      yen(row.anchorBalance)
                    )}
                  </td>
                  <td>{yen(row.bookBalance)}</td>
                  <td>
                    {row.discrepancy !== 0
                      ? t('reconcile.discrepancy', { amount: signedYen(row.discrepancy) })
                      : signedYen(row.adjustment)}
                  </td>
                  {!usesStatement && (
                    <td className="master-reconcile__actions">
                      {record &&
                        (isEditing ? (
                          <>
                            <button type="button" className="master-btn master-btn--small" disabled={disabled} onClick={() => void saveEdit()}>
                              {t('reconcile.update')}
                            </button>
                            <button type="button" className="master-btn master-btn--small" onClick={() => setEditing(null)}>
                              {t('reconcile.cancel')}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="master-btn master-btn--small"
                              disabled={disabled}
                              aria-label={t('reconcile.editRecord', { date: row.date })}
                              onClick={() => setEditing({ id: record.id, date: record.recordDate, balance: String(record.balance) })}
                            >
                              {t('reconcile.edit')}
                            </button>
                            <button
                              type="button"
                              className="master-btn master-btn--small"
                              disabled={disabled}
                              aria-label={t('reconcile.deleteRecord', { date: row.date })}
                              onClick={() => void perform(() => Promise.resolve(repository.delete(record.id)))}
                            >
                              {t('reconcile.delete')}
                            </button>
                          </>
                        ))}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr aria-label={t('reconcile.total')}>
              <th scope="row" colSpan={4}>
                {t('reconcile.total')}
              </th>
              <td>{signedYen(adjustmentTotal)}</td>
              {!usesStatement && <td />}
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}
