import { useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, AccountCategory } from '../../domain/account/Account'
import type { AccountGroup, CreateAccountGroupInput } from '../../domain/account-group/AccountGroup'
import { QuickCreateDialog } from '../statement-import/QuickCreateDialog'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'
import { EntitySelect } from '../common/entity-select/EntitySelect'
import { MemberSelect } from './MemberSelect'
import { useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import { reconciliationAnswerToIsReconcilable } from '../account-registration/reconciliationQuestion'
import { registerAccount, type AccountCreator, type BalanceRecordCreator } from '../account-registration/registerAccount'
import { registerRevenueOrExpenseAccount } from '../account-registration/registerRevenueOrExpenseAccount'
import { resolveDefaultAccountGroupId } from '../account-registration/resolveDefaultAccountGroupId'
import { DefinitionLinkPicker } from './DefinitionLinkPicker'
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
  /** 最初の残高の記録の保存先(計画Issue #205)。渡さない使い方では「最初の残高の記録」欄を出さない */
  balanceRecordRepository?: BalanceRecordCreator
  groups: readonly AccountGroup[]
  householdMembers: readonly HouseholdMember[]
  /** 右パネルを開いた区分の見出しに合わせた初期の区分(equityは作成できないため資産にする) */
  initialCategory: AccountCategory
  /**
   * 所属グループの初期値(計画Issue #257。グループの右パネルの「+ 科目」で、選んでいたグループを入れる)。
   * 初期の区分のアクティブなグループでなければ無視する。区分を変えると外れ、区分の既定に戻る
   */
  initialGroupId?: number | null
  /** 最初の残高の記録の日付の初期値(YYYY-MM-DD)。省略時は今日 */
  today?: string
  mappingLinking?: AccountMappingLinking
  /**
   * 渡すと、所属グループの選択欄に「+ グループを新規追加」を出す(計画Issue #290)。名前・登録中の区分・親グループ(null=最上位)で
   * 科目グループを作って返す。呼び出し側は作ったグループを groups に加えて渡し直す。作ったグループはそのまま選ばれる
   */
  onCreateGroup?: (input: CreateAccountGroupInput) => Promise<AccountGroup>
  /** 登録できたとき。leavingは、未保存の確認の「保存して移動」で登録したとき(呼び出し側が別の移動を続けるため、登録した科目を選び直さない) */
  onCreated: (account: Account, options?: { leaving?: boolean }) => void
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
  balanceRecordRepository,
  groups,
  householdMembers,
  initialCategory,
  initialGroupId = null,
  today,
  mappingLinking,
  onCreateGroup,
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
  /** 渡された初期のグループ(初期の区分のアクティブなグループのときだけ有効) */
  const initialGroupValue =
    initialGroupId !== null && groups.some((g) => g.id === initialGroupId && g.category === initialCategory && g.isActive)
      ? String(initialGroupId)
      : null
  const [groupOverride, setGroupOverride] = useState<string | null>(initialGroupValue)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [hasCsv, setHasCsv] = useState<'yes' | 'no'>('yes')
  const [hasBalance, setHasBalance] = useState<'yes' | 'no'>(initialCategory === 'liability' ? 'no' : 'yes')
  const [memberInput, setMemberInput] = useState('')
  const [opening, setOpening] = useState('')
  const [openingDate, setOpeningDate] = useState(() => today ?? new Date().toISOString().slice(0, 10))
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
  const isGroupOfCategory = useCallback((g: AccountGroup) => g.category === category && g.isActive, [category])
  const defaultGroupId = resolveDefaultAccountGroupId({ category, hasExternalStatement: csvExists }, groups)
  const groupValue = groupOverride ?? (defaultGroupId === null ? '' : String(defaultGroupId))
  const openingAmount = opening.trim() === '' ? null : Number(opening)
  // 取引後残高のあるCSVの科目は、最初の明細の残高から基準点が決まるので、手で記録する欄は出さない(計画Issue #205)
  const statementBalance = csvExists && hasBalance === 'yes'
  const showFirstBalance = isBalanceSheet && !statementBalance && balanceRecordRepository !== undefined

  const changeCategory = (next: CreatableAccountCategory) => {
    setCategory(next)
    setGroupOverride(null)
    setHasBalance(next === 'liability' ? 'no' : 'yes')
  }

  /** 登録する。登録できたらtrue(明細マッピングの紐づけに失敗したときはfalse) */
  const submit = async (leaving: boolean): Promise<boolean> => {
    if (name.trim() === '' || submitting) return false
    setSubmitting(true)
    setError(false)
    let account: Account
    try {
      const accountGroupId = groupValue === '' ? null : Number(groupValue)
      account = isBalanceSheet
        ? await registerAccount(accountRepository, balanceRecordRepository ?? null, {
            category: category as 'asset' | 'liability',
            isReconcilable: reconciliationAnswerToIsReconcilable({
              hasExternalStatement: csvExists,
              hasBalanceInStatement: csvExists ? hasBalance === 'yes' : null,
            }),
            hasExternalStatement: csvExists,
            name: name.trim(),
            householdMemberId: memberId,
            accountGroupId,
            firstBalance: showFirstBalance && openingAmount !== null ? { date: openingDate, balance: openingAmount } : null,
          })
        : await registerRevenueOrExpenseAccount(accountRepository, {
            category: category as 'revenue' | 'expense',
            name: name.trim(),
            accountGroupId,
          })
    } catch {
      setError(true)
      setSubmitting(false)
      return false
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
        return false
      }
    }
    onCreated(account, leaving ? { leaving: true } : undefined)
    return true
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit(false)
  }

  // 名称か初期残高を入力している間は、画面を離れる前に確認する(区分などの選択は初期値があり、
  // 名称なしでは登録できないため、入力の有無だけで判定する。計画Issue #190)
  const unsavedDialog = useUnsavedEditGuard({
    dirty: linkFailedAccount === null && (name.trim() !== '' || (showFirstBalance && opening.trim() !== '')),
    save: () => submit(true),
  })

  const reconcileText = statementBalance
    ? `${t('createForm.reconcileOn')}${t('createForm.statementBalanceNote')}`
    : t('createForm.reconcileOff')

  return (
    <>
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
        <span className="master-field__label">{t('createForm.group')}</span>
        {/* 階層をインデントで示す共通の選択欄(計画Issue #233)。同じ区分・アクティブなグループだけを候補にする */}
        <EntitySelect
         
          label={t('createForm.group')}
          groups={groups}
          filter={isGroupOfCategory}
          value={groupValue === '' ? null : Number(groupValue)}
          onChange={(id) => setGroupOverride(id === null ? '' : String(id))}
          emptyLabel={t('createForm.groupNone')}
          onCreate={onCreateGroup ? () => setGroupDialogOpen(true) : undefined}
          createLabel={t('createForm.groupCreate')}
        />
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
              // 外部明細の有無で既定のグループが変わるが、グループの「+ 科目」で入れた親は残す
              setGroupOverride(category === initialCategory ? initialGroupValue : null)
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
          <span className="master-field__label">{t('createForm.member')}</span>
          {/* 外部明細があるときは名義が必須なので、「全員」は出さない */}
          <MemberSelect
            label={t('createForm.member')}
            members={members}
            value={memberId === null ? '' : String(memberId)}
            onChange={setMemberInput}
            emptyLabel={csvExists ? undefined : t('createForm.memberAll')}
          />
        </div>
      )}

      {showFirstBalance && (
        <fieldset className="master-checklist" aria-label={t('createForm.firstBalance')}>
          <legend className="master-checklist__legend">{t('createForm.firstBalance')}</legend>
          <div className="master-field">
            <label className="master-field__label" htmlFor="account-create-opening-date">
              {t('createForm.firstBalanceDate')}
            </label>
            <input
              id="account-create-opening-date"
              type="date"
              className="master-field__control"
              value={openingDate}
              onChange={(event) => setOpeningDate(event.target.value)}
            />
          </div>
          <div className="master-field">
            <label className="master-field__label" htmlFor="account-create-opening">
              {t('createForm.firstBalanceAmount')}
            </label>
            <input
              id="account-create-opening"
              className="master-field__control"
              inputMode="numeric"
              value={opening}
              onChange={(event) => setOpening(event.target.value)}
            />
          </div>
          <p className="master-note">{t('createForm.firstBalanceNote')}</p>
        </fieldset>
      )}

      {isBalanceSheet && <p className="master-note">{reconcileText}</p>}

      {showMappingLinking && mappingLinking && mappingLinking.definitions.length > 0 && (
        <fieldset className="master-checklist" aria-label={t('createForm.mappingTitle')} disabled={linkFailedAccount !== null}>
          <legend className="master-checklist__legend">
            {t('createForm.mappingTitle')}
            <span className="master-note">{t('createForm.mappingOptional')}</span>
          </legend>
          <DefinitionLinkPicker
            definitions={mappingLinking.definitions}
            selectedIds={checkedDefinitionIds}
            disabled={linkFailedAccount !== null}
            onAdd={(id) => setCheckedDefinitionIds((prev) => new Set(prev).add(id))}
            onRemove={(id) =>
              setCheckedDefinitionIds((prev) => {
                const next = new Set(prev)
                next.delete(id)
                return next
              })
            }
          />
          <p className="master-note">{t('createForm.mappingNote')}</p>
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
      {unsavedDialog}
    </form>
    {onCreateGroup && groupDialogOpen && (
      // グループの追加は、この登録フォームの外に重ねて出す(submitがこのフォームに伝わらないよう、フォームの子にしない)
      <QuickCreateDialog
        nested
        title={t('createForm.groupCreateTitle')}
        nameLabel={t('createForm.groupCreateName')}
        groupField={{
          label: t('createForm.groupParent'),
          // 親は登録中の区分のグループだけ(区分をまたぐ親は選べない)
          groups: groups.filter(isGroupOfCategory),
          emptyLabel: t('createForm.groupParentTop'),
        }}
        onSubmit={async (groupName, parentGroupId) => {
          const created = await onCreateGroup({ name: groupName, category, parentGroupId })
          setGroupOverride(String(created.id))
          setGroupDialogOpen(false)
        }}
        onCancel={() => setGroupDialogOpen(false)}
      />
    )}
    </>
  )
}
