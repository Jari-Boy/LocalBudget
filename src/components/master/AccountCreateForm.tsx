import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, AccountCategory } from '../../domain/account/Account'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'
import { groupMappingDefinitionsByInstitution } from '../../domain/statement-import/groupMappingDefinitionsByInstitution'
import { reconciliationAnswerToIsReconcilable } from '../account-registration/reconciliationQuestion'
import { registerAccount, type AccountCreator, type JournalEntryCreator } from '../account-registration/registerAccount'
import { registerRevenueOrExpenseAccount } from '../account-registration/registerRevenueOrExpenseAccount'
import { resolveDefaultAccountGroupId } from '../account-registration/resolveDefaultAccountGroupId'
import './master.css'

export type CreatableAccountCategory = 'asset' | 'liability' | 'revenue' | 'expense'

const CATEGORIES: readonly CreatableAccountCategory[] = ['asset', 'liability', 'revenue', 'expense']

/**
 * 資産・負債の登録時に、明細マッピングを任意で紐づける設定(計画Issue #189)。渡さない使い方では
 * 「明細マッピング」の欄を出さない。紐づけは制限ではなく優先順位なので、選ばなくても登録できる。
 */
export interface AccountMappingLinking {
  definitions: readonly ImportMappingDefinition[]
  repository: Pick<ImportMappingDefinitionRepository, 'linkAccount'>
  /** 最初からチェックしておく定義(取込画面では、いま取り込んでいる定義) */
  defaultDefinitionIds?: readonly number[]
}

export interface AccountCreateFormProps {
  accountRepository: AccountCreator
  journalEntryRepository: JournalEntryCreator
  groups: readonly AccountGroup[]
  householdMembers: readonly HouseholdMember[]
  /** 右パネルを開いた区分の見出しに合わせた初期の区分(equityは作成できないため資産にする) */
  initialCategory: AccountCategory
  /** 初期仕訳の日付(YYYY-MM-DD)。省略時は今日 */
  today?: string
  mappingLinking?: AccountMappingLinking
  onCreated: (account: Account) => void
  onCancel: () => void
}

/**
 * 科目の新規登録フォーム(計画Issue #154)。マスタ画面の右パネルに置き、既存の統合登録フロー
 * (AccountRegistrationFlow、最大7ステップ)と同じ内容を1つのフォームで登録する。
 * 区分(資産・負債・収益・費用)→名称→所属グループ→[資産・負債のみ]外部明細(CSV)の有無→
 * [CSVありのみ]残高情報の有無→名義(CSVありは必須、なしは「全員」も可)→初期残高(任意)。
 * 照合可否は外部明細と残高情報の回答から決まり(docs/domain/accounts.md 4.2)、「照合可否」
 * 「純資産」の語は見せず、結果を補足の文言で伝える。所属グループは区分と外部明細の有無から
 * 標準グループを初期選択し(resolveDefaultAccountGroupId)、利用者が変更できる。
 */
export function AccountCreateForm({
  accountRepository,
  journalEntryRepository,
  groups,
  householdMembers,
  initialCategory,
  today,
  mappingLinking,
  onCreated,
  onCancel,
}: AccountCreateFormProps) {
  const { t } = useTranslation('master')
  const [category, setCategory] = useState<CreatableAccountCategory>(
    CATEGORIES.includes(initialCategory as CreatableAccountCategory)
      ? (initialCategory as CreatableAccountCategory)
      : 'asset',
  )
  const [name, setName] = useState('')
  const [groupOverride, setGroupOverride] = useState<string | null>(null)
  const [hasCsv, setHasCsv] = useState<'yes' | 'no'>('yes')
  const [hasBalance, setHasBalance] = useState<'yes' | 'no'>(initialCategory === 'liability' ? 'no' : 'yes')
  const [memberInput, setMemberInput] = useState('')
  const [opening, setOpening] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)
  const [checkedDefinitionIds, setCheckedDefinitionIds] = useState<ReadonlySet<number>>(
    () => new Set(mappingLinking?.defaultDefinitionIds ?? []),
  )
  /** 科目は登録できたが、明細マッピングの紐づけに失敗したときの、登録済みの科目 */
  const [linkFailedAccount, setLinkFailedAccount] = useState<Account | null>(null)

  const isBalanceSheet = category === 'asset' || category === 'liability'
  const csvExists = hasCsv === 'yes'
  // 明細マッピングの紐づけ先は外部明細(CSV)がある資産・負債だけ(計画Issue #189)
  const showMappingLinking = isBalanceSheet && csvExists
  const members = householdMembers.filter((m) => m.isActive)
  const showMember = isBalanceSheet && members.length > 0
  // 外部明細ありのときは名義が必須。「全員」は選べないので、未選択は先頭のメンバーとみなす
  const memberId = memberInput !== '' ? Number(memberInput) : csvExists ? (members[0]?.id ?? null) : null
  const categoryGroups = groups.filter((g) => g.category === category && g.isActive)
  const defaultGroupId = resolveDefaultAccountGroupId({ category, hasExternalStatement: csvExists }, groups)
  const groupValue = groupOverride ?? (defaultGroupId === null ? '' : String(defaultGroupId))
  const openingAmount = opening.trim() === '' ? null : Number(opening)

  const changeCategory = (next: CreatableAccountCategory) => {
    setCategory(next)
    setGroupOverride(null)
    setHasBalance(next === 'liability' ? 'no' : 'yes')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '' || submitting) return
    setSubmitting(true)
    setError(false)
    let account: Account
    try {
      const accountGroupId = groupValue === '' ? null : Number(groupValue)
      account = isBalanceSheet
        ? await registerAccount(accountRepository, journalEntryRepository, {
            category: category as 'asset' | 'liability',
            isReconcilable: reconciliationAnswerToIsReconcilable({
              hasExternalStatement: csvExists,
              hasBalanceInStatement: csvExists ? hasBalance === 'yes' : null,
            }),
            hasExternalStatement: csvExists,
            name: name.trim(),
            householdMemberId: memberId,
            accountGroupId,
            initialBalanceLines: [{ householdMemberId: null, amount: openingAmount }],
            entryDate: today ?? new Date().toISOString().slice(0, 10),
            journalEntryHouseholdMemberId: (memberId ?? members[0]?.id) as number,
          })
        : await registerRevenueOrExpenseAccount(accountRepository, {
            category: category as 'revenue' | 'expense',
            name: name.trim(),
            accountGroupId,
          })
    } catch {
      setError(true)
      setSubmitting(false)
      return
    }

    // 登録できた科目に、チェックした明細マッピングを紐づける。失敗しても科目は残るので、再送信で
    // 二重登録にならないよう、登録済みであることを伝えて閉じてもらう
    if (showMappingLinking && mappingLinking && checkedDefinitionIds.size > 0) {
      try {
        for (const definitionId of checkedDefinitionIds) {
          await Promise.resolve(mappingLinking.repository.linkAccount(definitionId, account.id))
        }
      } catch {
        setLinkFailedAccount(account)
        setSubmitting(false)
        return
      }
    }
    onCreated(account)
  }

  const toggleDefinition = (id: number) =>
    setCheckedDefinitionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const reconcileText = `${csvExists && hasBalance === 'yes' ? t('createForm.reconcileOn') : t('createForm.reconcileOff')}${
    openingAmount !== null && openingAmount > 0 ? t('createForm.initialBalanceNote') : ''
  }`

  return (
    <form className="master-panel" aria-label={t('createForm.title')} onSubmit={handleSubmit}>
      <h2 className="master-panel__title">{t('createForm.title')}</h2>

      <div className="master-field">
        <label className="master-field__label" htmlFor="account-create-category">
          {t('createForm.category')}
        </label>
        <select
          id="account-create-category"
          className="master-field__control"
          value={category}
          onChange={(event) => changeCategory(event.target.value as CreatableAccountCategory)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`createForm.category${c[0].toUpperCase()}${c.slice(1)}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="master-field">
        <label className="master-field__label" htmlFor="account-create-name">
          {t('createForm.name')}
        </label>
        <input
          id="account-create-name"
          className="master-field__control"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="master-field">
        <label className="master-field__label" htmlFor="account-create-group">
          {t('createForm.group')}
        </label>
        <select
          id="account-create-group"
          className="master-field__control"
          value={groupValue}
          onChange={(event) => setGroupOverride(event.target.value)}
        >
          <option value="">{t('createForm.groupNone')}</option>
          {categoryGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>

      {isBalanceSheet && (
        <div className="master-field">
          <label className="master-field__label" htmlFor="account-create-csv">
            {t('createForm.hasExternalStatement')}
          </label>
          <select
            id="account-create-csv"
            className="master-field__control"
            value={hasCsv}
            onChange={(event) => {
              setHasCsv(event.target.value as 'yes' | 'no')
              setGroupOverride(null)
            }}
          >
            <option value="yes">{t('createForm.yes')}</option>
            <option value="no">{t('createForm.no')}</option>
          </select>
        </div>
      )}

      {isBalanceSheet && csvExists && (
        <div className="master-field">
          <label className="master-field__label" htmlFor="account-create-balance">
            {t('createForm.hasBalance')}
          </label>
          <select
            id="account-create-balance"
            className="master-field__control"
            value={hasBalance}
            onChange={(event) => setHasBalance(event.target.value as 'yes' | 'no')}
          >
            <option value="yes">{t('createForm.yes')}</option>
            <option value="no">{t('createForm.no')}</option>
          </select>
        </div>
      )}

      {showMember && (
        <div className="master-field">
          <label className="master-field__label" htmlFor="account-create-member">
            {t('createForm.member')}
          </label>
          <select
            id="account-create-member"
            className="master-field__control"
            value={memberId === null ? '' : String(memberId)}
            onChange={(event) => setMemberInput(event.target.value)}
          >
            {!csvExists && <option value="">{t('createForm.memberAll')}</option>}
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isBalanceSheet && (
        <div className="master-field">
          <label className="master-field__label" htmlFor="account-create-opening">
            {t('createForm.initialBalance')}
          </label>
          <input
            id="account-create-opening"
            className="master-field__control"
            inputMode="numeric"
            value={opening}
            onChange={(event) => setOpening(event.target.value)}
          />
        </div>
      )}

      {isBalanceSheet && <p className="master-note">{reconcileText}</p>}

      {showMappingLinking && mappingLinking && mappingLinking.definitions.length > 0 && (
        <fieldset className="master-checklist" aria-label={t('createForm.mappingTitle')} disabled={linkFailedAccount !== null}>
          <legend className="master-checklist__legend">
            {t('createForm.mappingTitle')}
            <span className="master-note">{t('createForm.mappingOptional')}</span>
          </legend>
          <p className="master-note">{t('createForm.mappingNote')}</p>
          {groupMappingDefinitionsByInstitution(mappingLinking.definitions).map((group) => (
            <div key={group.name} className="master-checklist__group">
              <h3 className="master-checklist__group-title">{group.name}</h3>
              {group.definitions.map((d) => (
                <label key={d.id} className="master-checklist__item">
                  <input
                    type="checkbox"
                    checked={checkedDefinitionIds.has(d.id)}
                    onChange={() => toggleDefinition(d.id)}
                  />
                  <span className="master-checklist__label">{d.label}</span>
                  {mappingLinking.defaultDefinitionIds?.includes(d.id) && (
                    <span className="master-checklist__badge">{t('createForm.mappingCurrent')}</span>
                  )}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      )}

      {error && (
        <p role="alert" className="master-error">
          {t('createForm.error')}
        </p>
      )}
      {linkFailedAccount && (
        <p role="alert" className="master-error">
          {t('createForm.linkFailed')}
        </p>
      )}

      <div className="master-actions">
        {linkFailedAccount ? (
          <button type="button" className="master-btn master-btn--primary" onClick={() => onCreated(linkFailedAccount)}>
            {t('createForm.close')}
          </button>
        ) : (
          <>
            <button
              type="submit"
              className="master-btn master-btn--primary"
              disabled={name.trim() === '' || submitting}
            >
              {t('createForm.submit')}
            </button>
            <button type="button" className="master-btn" onClick={onCancel}>
              {t('createForm.cancel')}
            </button>
          </>
        )}
      </div>
    </form>
  )
}
