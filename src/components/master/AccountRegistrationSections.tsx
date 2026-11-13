import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountRegistrationSummary } from '../../domain/account/summarizeAccountRegistration'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import { groupMappingDefinitionsByInstitution } from '../../domain/statement-import/groupMappingDefinitionsByInstitution'
import './master.css'

const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`

/**
 * 資産・負債科目の右パネルに出す「登録時の設定」(計画Issue #189)。表示のみで、変更手段は持たない。
 * 外部明細(CSV)の有無は、is_reconcilable=falseでは「あり・残高なし」と「なし」を区別できないため
 * 断定せず、trueのときだけ「あり」と表示する(docs/domain/accounts.md 4.2)。
 */
export function AccountRegistrationInfo({ summary }: { summary: AccountRegistrationSummary }) {
  const { t } = useTranslation('master')
  return (
    <section className="master-subsection" aria-label={t('accountTab.registrationTitle')}>
      <h3 className="master-subsection__title">
        {t('accountTab.registrationTitle')}
        <span className="master-note">{t('accountTab.registrationFixed')}</span>
      </h3>
      <dl className="master-field">
        {summary.hasBalanceInfo && (
          <>
            <dt className="master-field__label">{t('accountTab.registrationCsv')}</dt>
            <dd>{t('accountTab.registrationCsvOn')}</dd>
          </>
        )}
        <dt className="master-field__label">{t('accountTab.registrationBalance')}</dt>
        <dd>{t(summary.hasBalanceInfo ? 'accountTab.registrationBalanceOn' : 'accountTab.registrationBalanceOff')}</dd>
        <dt className="master-field__label">{t('accountTab.registrationInitialBalance')}</dt>
        <dd>
          {summary.initialBalance === null
            ? t('accountTab.registrationInitialBalanceNone')
            : `${yen(summary.initialBalance.amount)}(${summary.initialBalance.date})`}
        </dd>
      </dl>
      {!summary.hasBalanceInfo && <p className="master-note">{t('accountTab.registrationCsvUnknown')}</p>}
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
        <ul className="master-list">
          {linked.map((d) => (
            <li key={d.id} className="master-actions">
              <span>
                <strong>{d.formatGroupId}</strong> ・ {d.label}
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
        <div className="master-actions">
          <select
            aria-label={t('accountTab.mappingSelect')}
            className="master-field__control"
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
      <p className="master-note">{t('accountTab.mappingImmediate')}</p>
    </section>
  )
}
