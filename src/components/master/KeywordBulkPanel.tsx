import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { KeywordRule } from '../../domain/keyword-rule/KeywordRule'
import { AccountSelect } from './AccountSelect'
import { CounterpartySelect } from './CounterpartySelect'
import type { BulkChoice } from './keywordRuleForm'
import './master.css'

export interface KeywordBulkPanelProps {
  /** チェックしたルール */
  rules: readonly KeywordRule[]
  counterparties: readonly Counterparty[]
  /** 取引先の選択欄で、取引先をグループの階層で見せるための取引先グループ */
  counterpartyGroups: readonly CounterpartyGroup[]
  accounts: readonly Account[]
  /** 科目の選択欄で、科目をグループの階層で見せるための科目グループ */
  accountGroups: readonly AccountGroup[]
  busy: boolean
  error: string
  onApply: (change: { counterparty: BulkChoice; account: BulkChoice }) => void
  onDelete: () => void
  onClear: () => void
}

/** 取引先の一括変更に選べるのは、有効な取引先だけ */
const isActiveCounterparty = (counterparty: Counterparty) => counterparty.isActive

/** 科目の一括変更に選べるのは、有効で、システム管理ではない科目 */
const isSelectableAccount = (account: Account) => account.isActive && !account.isSystemManaged

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
export function KeywordBulkPanel({ rules, counterparties, counterpartyGroups, accounts, accountGroups, busy, error, onApply, onDelete, onClear }: KeywordBulkPanelProps) {
  const { t } = useTranslation('master')
  const [counterparty, setCounterparty] = useState(KEEP)
  const [account, setAccount] = useState(KEEP)
  const [armed, setArmed] = useState(false)
  /** 「変更しない」「未設定にする」の特別な項目(取引先・科目の選択欄で共通。参照を安定させる) */
  const leadingOptions = useMemo(
    () => [
      { value: KEEP, label: t('keywordTab.bulk.keep') },
      { value: CLEAR, label: t('keywordTab.bulk.clearValue') },
    ],
    [t],
  )

  return (
    <section className="master-panel" aria-label={t('bulk.region')}>
      <h2 className="master-panel__title">{t('bulk.title', { count: rules.length })}</h2>
      <p className="master-note">{rules.map((r) => r.pattern).join('、')}</p>

      <section className="master-subsection" aria-label={t('keywordTab.bulk.changeTitle')}>
        <h3 className="master-subsection__title">{t('keywordTab.bulk.changeTitle')}</h3>
        <div className="master-field">
          <span className="master-field__label">{t('keywordTab.colCounterparty')}</span>
          <CounterpartySelect
            label={t('keywordTab.colCounterparty')}
            counterparties={counterparties}
            counterpartyGroups={counterpartyGroups}
            filter={isActiveCounterparty}
            value={counterparty}
            disabled={busy}
            leadingOptions={leadingOptions}
            onChange={setCounterparty}
          />
        </div>
        <div className="master-field">
          <span className="master-field__label">{t('keywordTab.colAccount')}</span>
          <AccountSelect
            label={t('keywordTab.colAccount')}
            accounts={accounts}
            accountGroups={accountGroups}
            filter={isSelectableAccount}
            value={account}
            disabled={busy}
            leadingOptions={leadingOptions}
            onChange={setAccount}
          />
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
