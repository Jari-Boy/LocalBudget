import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import { findAccountMergeBlock } from '../../domain/account/findAccountMergeBlock'
import type { MaybeAsync } from './maybeAsync'
import './master.css'

export interface AccountMergePanelProps {
  /** チェックされた科目(2件以上のときだけ表示する) */
  accounts: readonly Account[]
  /** 統合元の科目に紐づく明細行の件数(確認の文言用) */
  lineCountOf: (accountId: number) => number
  repository: MaybeAsync<Pick<AccountRepository, 'merge'>>
  onMerged: (message: string) => Promise<void>
}

/**
 * チェックした勘定科目(2件以上)を1つに統合する(計画Issue #97)。取引先の統合と同じ流れで、
 * 統合先を選び、付け替える明細行の件数を示す確認を経て実行する。統合できない組み合わせ
 * (システム管理・区分違い・照合可否違い、findAccountMergeBlock)は理由だけを表示する。
 * 統合先に選べるのは有効な科目だけ。
 */
export function AccountMergePanel({ accounts, lineCountOf, repository, onMerged }: AccountMergePanelProps) {
  const { t } = useTranslation('master')
  const [targetId, setTargetId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  if (accounts.length < 2) return null

  const block = findAccountMergeBlock(accounts)
  const title = t('accountTab.mergeTitle', { count: accounts.length })
  const region = t('accountTab.mergeRegion')

  if (block !== null) {
    return (
      <section className="master-panel" aria-label={region}>
        <h2 className="master-panel__title">{title}</h2>
        <p className="master-note">{t(`accountTab.mergeBlock${block[0].toUpperCase()}${block.slice(1)}`)}</p>
      </section>
    )
  }

  const target = accounts.find((a) => String(a.id) === targetId)
  const sources = accounts.filter((a) => a.id !== target?.id)
  const sourceNames = sources.map((s) => s.name).join('、')

  const execute = async () => {
    if (!target) return
    setWorking(true)
    setError('')
    try {
      await repository.merge(target.id, sources.map((s) => s.id))
      setConfirming(false)
      setTargetId('')
      await onMerged(t('accountTab.mergeDone', { sources: sourceNames, target: target.name }))
    } catch {
      setConfirming(false)
      setError(t('accountTab.mergeError'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="master-panel" aria-label={region}>
      <h2 className="master-panel__title">{title}</h2>
      <div className="master-field">
        <label className="master-field__label" htmlFor="account-merge-target">
          {t('accountTab.mergeTarget')}
        </label>
        <select
          id="account-merge-target"
          className="master-field__control"
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value)
            setConfirming(false)
          }}
        >
          <option value="">{t('accountTab.mergeChoose')}</option>
          {accounts
            .filter((a) => a.isActive)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </div>
      {confirming && target ? (
        <>
          <p className="master-note">
            {t('accountTab.mergeConfirm', {
              sources: sourceNames,
              target: target.name,
              count: sources.reduce((sum, s) => sum + lineCountOf(s.id), 0),
            })}
          </p>
          <div className="master-actions">
            <button type="button" className="master-btn master-btn--danger" disabled={working} onClick={() => void execute()}>
              {t('accountTab.mergeRun')}
            </button>
            <button type="button" className="master-btn" onClick={() => setConfirming(false)}>
              {t('accountTab.mergeCancel')}
            </button>
          </div>
        </>
      ) : (
        <div className="master-actions">
          <button type="button" className="master-btn" disabled={!target} onClick={() => setConfirming(true)}>
            {t('accountTab.mergeStart')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="master-error">
          {error}
        </p>
      )}
    </section>
  )
}
