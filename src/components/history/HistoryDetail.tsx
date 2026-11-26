import { useTranslation } from 'react-i18next'
import type { HistoryOperation } from '../../infrastructure/history/OperationHistory'
import {
  changedFields,
  diffRows,
  entrySubjectParts,
  operationKind,
  sampleAccounts,
  summarizeAccountUsage,
  type DiffLabel,
} from './historyDisplay'

/** 使った科目として並べる上位の件数。残りは「ほかN科目」にまとめる */
const TOP_ACCOUNTS = 4

/** 取込先の科目の名前。取込の操作でだけ付く(使った科目からは外す) */
function targetOf(operation: HistoryOperation): string | null {
  return operation.meta?.kind === 'statementImport' ? operation.meta.targetAccountName : null
}

/**
 * 一覧の行の、操作名の下に出す対象(計画Issue #295)。どの仕訳か(摘要・日付・金額)、編集なら変えた項目、
 * CSV取込なら金融機関・ファイル・仕訳の件数と日付の範囲。仕訳に触れない操作には何も出さない。
 */
export function OperationSubject({ operation }: { operation: HistoryOperation }) {
  const { t } = useTranslation('history')
  const { detail, meta } = operation
  if (!detail) return null

  const range =
    detail.dateRange.from === detail.dateRange.to
      ? t('list.subjectDate', { date: detail.dateRange.from })
      : t('list.subjectRange', { from: detail.dateRange.from, to: detail.dateRange.to })
  const many = `${t('list.subjectMany', { count: detail.entryTotal, verb: t(`list.verb.${operationKind(detail)}`) })}${range}`

  if (meta?.kind === 'statementImport') {
    const first = meta.files[0]?.name ?? ''
    const files = meta.files.length > 1 ? t('list.fileMore', { name: first, count: meta.files.length - 1 }) : first
    return (
      <>
        <span className="history__row-sub">{[meta.institution, files].filter((s) => s).join(' ・ ')}</span>
        <span className="history__row-sub">{many}</span>
      </>
    )
  }

  if (detail.entryTotal === 1 && detail.entries[0]) {
    const change = detail.entries[0]
    const parts = entrySubjectParts(change)
    const fields = changedFields(change)
    return (
      <>
        <span className="history__row-sub">
          {[parts.memo ?? t('list.noMemo'), parts.date, parts.amount].join(' ・ ')}
        </span>
        {fields.length > 0 && (
          <span className="history__changed">
            {t('list.changed')}
            {fields.map((field) => (
              <span key={field} className="history__tag history__tag--neutral">
                {t(`list.field.${field}`)}
              </span>
            ))}
          </span>
        )}
      </>
    )
  }

  return <span className="history__row-sub">{many}</span>
}

function labelText(label: DiffLabel, t: (key: string) => string): string {
  if ('field' in label) return t(`diff.field.${label.field}`)
  return label.account ? `${t(`diff.side.${label.side}`)} ${label.account}` : t(`diff.side.${label.side}`)
}

/** 右パネルの、1つの操作の内容。仕訳1件は前→後(作成・削除は内容の一覧)、複数は概要と先頭の数件 */
export function OperationDetailBlock({ operation }: { operation: HistoryOperation }) {
  const { t } = useTranslation('history')
  const { detail, meta } = operation
  if (!detail) return null

  const single = detail.entryTotal === 1 ? detail.entries[0] : undefined
  if (single) {
    return (
      <div className="history__diff">
        <p className="history__diff-caption">{t(`panel.diff.${single.kind}`)}</p>
        <ul className="history__diff-rows">
          {diffRows(single).map((row, index) => (
            <li key={index}>
              <span className="history__diff-label">{labelText(row.label, t)}</span>
              {single.kind === 'updated' ? (
                <span className="history__diff-value history__diff-change">
                  <span className="history__old">{row.before ?? t('diff.none')}</span>
                  <span className="history__diff-arrow">→</span>
                  <span className="history__new">{row.after ?? t('diff.none')}</span>
                </span>
              ) : (
                <span className="history__diff-value">{row.after ?? row.before}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const target = targetOf(operation)
  const usage = summarizeAccountUsage(detail.accountUsage, { exclude: target, top: TOP_ACCOUNTS })
  const kind = operationKind(detail)
  return (
    <div className="history__diff">
      <p className="history__diff-caption">{t(`panel.diff.many.${kind}`, { count: detail.entryTotal })}</p>
      <ul className="history__diff-rows">
        {meta?.kind === 'statementImport' && (
          <>
            {meta.institution && (
              <li>
                <span className="history__diff-label">{t('panel.diff.institution')}</span>
                <span className="history__diff-value">{meta.institution}</span>
              </li>
            )}
            <li>
              <span className="history__diff-label">{t('panel.diff.target')}</span>
              <span className="history__diff-value">{meta.targetAccountName}</span>
            </li>
            <li>
              <span className="history__diff-label">{t('panel.diff.files')}</span>
              <span className="history__diff-value">
                {meta.files.map((file) => (
                  <span key={file.name} className="history__diff-block">
                    {file.name} <span className="history__diff-count">{t('panel.diff.count', { count: file.count })}</span>
                  </span>
                ))}
              </span>
            </li>
          </>
        )}
        {usage.shown.length > 0 && (
          <li>
            <span className="history__diff-label">{t('panel.diff.accounts')}</span>
            <span className="history__diff-value">
              {usage.shown.map((u, index) => (
                <span key={u.name}>
                  {index > 0 && ' ・ '}
                  {u.name} <span className="history__diff-count">{t('panel.diff.count', { count: u.count })}</span>
                </span>
              ))}
              {usage.rest && (
                <span>
                  {' ・ '}
                  {t('panel.diff.restAccounts', { accounts: usage.rest.accounts })}{' '}
                  <span className="history__diff-count">{t('panel.diff.count', { count: usage.rest.count })}</span>
                </span>
              )}
            </span>
          </li>
        )}
      </ul>
      {detail.entries.length > 0 && (
        <>
          <p className="history__diff-subhead">{t('panel.diff.sampleHead', { count: detail.entries.length })}</p>
          <ul className="history__diff-rows history__diff-rows--four">
            {detail.entries.map((change) => {
              const parts = entrySubjectParts(change)
              return (
                <li key={change.entryId}>
                  <span className="history__diff-label">{parts.date}</span>
                  <span className="history__diff-value">{parts.memo ?? t('list.noMemo')}</span>
                  <span className="history__diff-value">{sampleAccounts(change, target).join(' ・ ')}</span>
                  <span className="history__diff-amount">{parts.amount}</span>
                </li>
              )
            })}
          </ul>
          {detail.entryTotal > detail.entries.length && (
            <p className="history__diff-more">{t('panel.diff.more', { count: detail.entryTotal - detail.entries.length })}</p>
          )}
        </>
      )}
    </div>
  )
}
