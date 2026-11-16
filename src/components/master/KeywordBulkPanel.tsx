import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import type { BulkChoice } from './keywordRuleForm'
import './master.css'

export interface KeywordBulkPanelProps {
  /** チェックしたルール */
  rules: readonly KeywordRule[]
  counterparties: readonly Counterparty[]
  accounts: readonly Account[]
  busy: boolean
  error: string
  onApply: (change: { counterparty: BulkChoice; account: BulkChoice }) => void
  onDelete: () => void
  onClear: () => void
}

/** セレクトの値: 変更しない / 外す / ルールのid */
const KEEP = 'keep'
const CLEAR = 'clear'
const toChoice = (value: string): BulkChoice => (value === KEEP ? 'keep' : value === CLEAR ? null : Number(value))

/**
 * キーワードタブで2件以上チェックしたときに、編集パネルの代わりに右側へ出す「一括操作」パネル(計画Issue #219)。
 * 他のマスタ画面の一括操作パネル(BulkSelectionPanel)と同じ並び(件数・名称・操作・選択の解除)で、
 * 取引先と科目の一括変更(「変更しない」「外す」「このものにする」)と、2回押しの一括削除を持つ。
 * 変更の検証と適用は呼び出し側(planBulkChange)が行う。
 */
export function KeywordBulkPanel({ rules, counterparties, accounts, busy, error, onApply, onDelete, onClear }: KeywordBulkPanelProps) {
  const { t } = useTranslation('master')
  const [counterparty, setCounterparty] = useState(KEEP)
  const [account, setAccount] = useState(KEEP)
  const [armed, setArmed] = useState(false)

  return (
    <section className="master-panel" aria-label={t('bulk.region')}>
      <h2 className="master-panel__title">{t('bulk.title', { count: rules.length })}</h2>
      <p className="master-note">{rules.map((r) => r.pattern).join('、')}</p>

      <section className="master-subsection" aria-label={t('keywordTab.bulk.changeTitle')}>
        <h3 className="master-subsection__title">{t('keywordTab.bulk.changeTitle')}</h3>
        <div className="master-field">
          <label className="master-field__label" htmlFor="kw-bulk-counterparty">
            {t('keywordTab.colCounterparty')}
          </label>
          <select
            id="kw-bulk-counterparty"
            className="master-field__control"
            disabled={busy}
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
          >
            <option value={KEEP}>{t('keywordTab.bulk.keep')}</option>
            <option value={CLEAR}>{t('keywordTab.bulk.clearValue')}</option>
            {counterparties
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="master-field">
          <label className="master-field__label" htmlFor="kw-bulk-account">
            {t('keywordTab.colAccount')}
          </label>
          <select
            id="kw-bulk-account"
            className="master-field__control"
            disabled={busy}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value={KEEP}>{t('keywordTab.bulk.keep')}</option>
            <option value={CLEAR}>{t('keywordTab.bulk.clearValue')}</option>
            {accounts
              .filter((a) => a.isActive && !a.isSystemManaged)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
        <div className="master-actions">
          <button
            type="button"
            className="master-btn master-btn--primary"
            disabled={busy || (counterparty === KEEP && account === KEEP)}
            onClick={() => onApply({ counterparty: toChoice(counterparty), account: toChoice(account) })}
          >
            {t('keywordTab.bulk.apply')}
          </button>
        </div>
      </section>

      <section className="master-subsection" aria-label={t('keywordTab.bulk.deleteTitle')}>
        <h3 className="master-subsection__title">{t('keywordTab.bulk.deleteTitle')}</h3>
        <div className="master-actions">
          <button
            type="button"
            className="master-btn master-btn--danger"
            disabled={busy}
            onClick={() => (armed ? onDelete() : setArmed(true))}
          >
            {armed ? t('accountTab.deleteConfirm') : t('keywordTab.deleteSelected', { count: rules.length })}
          </button>
        </div>
      </section>

      {error && (
        <p role="alert" className="master-error">
          {error}
        </p>
      )}

      <div className="master-actions master-actions--divided">
        <button type="button" className="master-btn" onClick={onClear}>
          {t('bulk.clear')}
        </button>
      </div>
    </section>
  )
}
