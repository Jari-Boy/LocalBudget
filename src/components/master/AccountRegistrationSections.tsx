import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountRegistrationSummary } from '../../domain/account/summarizeAccountRegistration'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import { groupMappingDefinitionsByInstitution } from '../../domain/statement-import/groupMappingDefinitionsByInstitution'
import './master.css'

const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`

/**
 * 資産・負債科目の右パネルに出す「外部明細の情報」(計画Issue #189)。登録時の回答(外部明細の有無・
 * 残高情報の有無)と初期残高を、外部明細・残高情報・初期残高の順で横に並べる。表示のみで、変更手段は持たない。
 */
export function AccountRegistrationInfo({ summary }: { summary: AccountRegistrationSummary }) {
  const { t } = useTranslation('master')
  const yesNo = (value: boolean) => t(value ? 'accountTab.registrationYes' : 'accountTab.registrationNo')
  const items = [
    { label: t('accountTab.registrationCsv'), value: yesNo(summary.hasExternalStatement) },
    { label: t('accountTab.registrationBalance'), value: yesNo(summary.hasBalanceInfo) },
    {
      label: t('accountTab.registrationInitialBalance'),
      value:
        summary.initialBalance === null
          ? t('accountTab.registrationNo')
          : `${yen(summary.initialBalance.amount)}(${summary.initialBalance.date})`,
    },
  ]
  return (
    <section className="master-subsection" aria-label={t('accountTab.registrationTitle')}>
      <h3 className="master-subsection__title">{t('accountTab.registrationTitle')}</h3>
      <dl className="master-facts">
        {items.map((item) => (
          <div key={item.label} className="master-facts__item">
            <dt className="master-facts__label">{item.label}</dt>
            <dd className="master-facts__value">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export interface AccountMappingSectionProps {
  accountId: number
  definitions: readonly ImportMappingDefinition[]
  busy: boolean
  onLink: (definitionId: number) => void
  onUnlink: (definitionId: number) => void
}

/**
 * 資産・負債科目の右パネルの「明細マッピング」(計画Issue #189)。この科目に紐づく定義の一覧と解除、
 * 未紐づけの定義の選択と紐づけを行う。紐づけ・解除は押した時点で中間テーブルに反映する(「保存」とは別)。
 * 紐づけは制限ではなく優先順位であることを文言で伝える(計画Issue #151)。
 */
export function AccountMappingSection({ accountId, definitions, busy, onLink, onUnlink }: AccountMappingSectionProps) {
  const { t } = useTranslation('master')
  const [choice, setChoice] = useState('')
  const linked = definitions.filter((d) => d.accountIds.includes(accountId))
  const candidates = groupMappingDefinitionsByInstitution(definitions.filter((d) => !d.accountIds.includes(accountId)))
  const hasCandidates = candidates.length > 0

  return (
    <section className="master-subsection" aria-label={t('accountTab.mappingTitle')}>
      <h3 className="master-subsection__title">{t('accountTab.mappingTitle')}</h3>
      <p className="master-note">{t('accountTab.mappingNote')}</p>

      {linked.length === 0 ? (
        <p className="master-note">{t('accountTab.mappingNone')}</p>
      ) : (
        <ul className="master-list master-list--tight">
          {linked.map((d) => (
            <li key={d.id} className="master-link-row">
              <span className="master-link-row__text">
                <span className="master-link-row__institution">{d.formatGroupId}</span>
                <span className="master-link-row__label">{d.label}</span>
              </span>
              <button
                type="button"
                className="master-btn master-btn--small"
                aria-label={t('accountTab.mappingUnlinkLabel', { label: d.label })}
                disabled={busy}
                onClick={() => onUnlink(d.id)}
              >
                {t('accountTab.mappingUnlink')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasCandidates ? (
        <div className="master-link-add">
          <select
            aria-label={t('accountTab.mappingSelect')}
            className="master-field__control master-link-add__select"
            value={choice}
            disabled={busy}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">{t('accountTab.mappingSelectPlaceholder')}</option>
            {candidates.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            className="master-btn master-btn--primary"
            disabled={busy || choice === ''}
            onClick={() => {
              onLink(Number(choice))
              setChoice('')
            }}
          >
            {t('accountTab.mappingLink')}
          </button>
        </div>
      ) : (
        <p className="master-note">{t('accountTab.mappingNoCandidates')}</p>
      )}
    </section>
  )
}
