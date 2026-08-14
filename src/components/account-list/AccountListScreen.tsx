import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account, AccountCategory } from '../../domain/account/Account'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Budget } from '../../domain/budget/Budget'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import { listAccountBalances, type AccountBalance } from '../../domain/financial-statement/listAccountBalances'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import './AccountListScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}

interface AccountUpdater {
  update(id: number, input: { name?: string; householdMemberId?: number | null }): Account | Promise<Account>
}

interface AccountDeleter {
  delete(id: number): void | Promise<void>
}

interface AccountDeactivator {
  deactivate(id: number): Account | Promise<Account>
}

interface JournalEntryFinder {
  findAll(): JournalEntry[] | Promise<JournalEntry[]>
}

interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}

interface BudgetFinder {
  findAll(): Budget[] | Promise<Budget[]>
}

interface RecurringTransactionRuleFinder {
  findAll(): RecurringTransactionRule[] | Promise<RecurringTransactionRule[]>
}

/** 一覧の区分表示ラベル(equityはisSystemManaged科目のみのため一覧には表示されないが、
 * Record<AccountCategory, string>を満たすためのキーとして用意する) */
const CATEGORY_LABEL_KEY: Record<AccountCategory, string> = {
  asset: 'listCategoryAsset',
  liability: 'listCategoryLiability',
  equity: 'listCategoryAsset',
  revenue: 'listCategoryRevenue',
  expense: 'listCategoryExpense',
}

export interface AccountListScreenProps {
  accountRepository: AccountFinder & AccountUpdater & AccountDeleter & AccountDeactivator
  journalEntryRepository: JournalEntryFinder
  householdMemberRepository: HouseholdMemberFinder
  budgetRepository: BudgetFinder
  recurringTransactionRuleRepository: RecurringTransactionRuleFinder
  onBack: () => void
}

interface LoadedData {
  accounts: Account[]
  balanceByAccountId: Map<number, AccountBalance>
  householdMembers: HouseholdMember[]
  householdMemberNameById: Map<number, string>
  /** 仕訳・予算・定期取引ルールのいずれかが紐づく科目id(docs/schema/accounts.sqlの
   * prevent_delete_account_with_referencesトリガーと同じ3種の参照を集計する) */
  accountIdsWithReference: Set<number>
}

/** null = 非表示、number(id) = 該当科目の編集フォーム */
type FormMode = number | null

/**
 * 登録済み科目一覧・管理画面(計画Issue #70で新設、計画Issue #95で編集・削除・
 * 非アクティブ化を追加)。isSystemManaged科目(初期残高科目等の内部管理用科目)を除いた
 * 登録済み全科目を、区分を問わずフラットな一覧として名称・残高とともに表示する。
 * householdMemberIdが設定された科目には世帯メンバー名を併記する。並び順は
 * AccountRepository.findAll()の返り順(登録順)をそのまま使い、UI層での独自ソートは行わない。
 * 各行から名称・名義の編集ができ、紐づく仕訳・予算・定期取引ルールがいずれも0件の科目のみ
 * 削除ボタンを表示する(docs/schema/accounts.sqlのprevent_delete_account_with_references
 * トリガーが最終防御線)。is_active = trueの科目には非アクティブ化ボタンを表示する。
 */
export function AccountListScreen({
  accountRepository,
  journalEntryRepository,
  householdMemberRepository,
  budgetRepository,
  recurringTransactionRuleRepository,
  onBack,
}: AccountListScreenProps) {
  const { t } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [nameInput, setNameInput] = useState('')
  const [householdMemberIdInput, setHouseholdMemberIdInput] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 編集・削除・非アクティブ化のいずれか進行中は全操作ボタンを無効化する(連打による二重実行防止) */
  const [isSubmitting, setIsSubmitting] = useState(false)

  const load = () => {
    void Promise.all([
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(journalEntryRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(budgetRepository.findAll()),
      Promise.resolve(recurringTransactionRuleRepository.findAll()),
    ]).then(([accounts, entries, householdMembers, budgets, recurringRules]) => {
      const visibleAccounts = accounts.filter((account) => !account.isSystemManaged)
      const accountIdsWithReference = new Set<number>()
      for (const entry of entries) {
        for (const line of entry.lines) {
          accountIdsWithReference.add(line.accountId)
        }
      }
      for (const budget of budgets) {
        accountIdsWithReference.add(budget.accountId)
      }
      for (const rule of recurringRules) {
        accountIdsWithReference.add(rule.debitAccountId)
        accountIdsWithReference.add(rule.creditAccountId)
      }

      setData({
        accounts: visibleAccounts,
        balanceByAccountId: new Map(
          listAccountBalances(entries, visibleAccounts).map((balance) => [balance.accountId, balance]),
        ),
        householdMembers,
        householdMemberNameById: new Map(householdMembers.map((member) => [member.id, member.name])),
        accountIdsWithReference,
      })
    })
  }

  useEffect(
    load,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accountRepository, journalEntryRepository, householdMemberRepository, budgetRepository, recurringTransactionRuleRepository],
  )

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const openEditForm = (account: Account) => {
    setNameInput(account.name)
    setHouseholdMemberIdInput(account.householdMemberId)
    setError(null)
    setFormMode(account.id)
  }

  const closeForm = () => {
    setFormMode(null)
    setError(null)
  }

  const submitEdit = () => {
    if (isSubmitting || formMode === null) return
    setIsSubmitting(true)
    setError(null)
    // Repository呼び出しはPromise.resolve(fn())ではなくPromise.resolve().then(() => fn())で
    // 開始する。sql.js実装は同期的に例外を投げるため、前者だとfnの同期例外が.catch()に
    // 届かない(docs/guides/patterns.md参照)。
    void Promise.resolve()
      .then(() =>
        accountRepository.update(formMode, { name: nameInput, householdMemberId: householdMemberIdInput }),
      )
      .then(() => {
        closeForm()
        load()
      })
      .catch(() => setError(t('saveError')))
      .finally(() => setIsSubmitting(false))
  }

  const deleteAccount = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => accountRepository.delete(id))
      .then(load)
      .catch(() => setError(t('deleteError')))
      .finally(() => setIsSubmitting(false))
  }

  const deactivateAccount = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => accountRepository.deactivate(id))
      .then(load)
      .catch(() => setError(t('deactivateError')))
      .finally(() => setIsSubmitting(false))
  }

  return (
    <div className="account-list-screen">
      <h2>{t('accountListTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {data.accounts.length === 0 ? (
        <p>{t('accountListEmpty')}</p>
      ) : (
        <ul>
          {data.accounts.map((account) => {
            const balance = data.balanceByAccountId.get(account.id)
            const canDelete = !data.accountIdsWithReference.has(account.id)
            return (
              <li key={account.id}>
                <div className="account-list-row">
                  <span className="account-list-name">
                    {account.name}
                    <span className="account-list-category">{t(CATEGORY_LABEL_KEY[account.category])}</span>
                    {!account.isActive && (
                      <span className="account-list-inactive">{t('inactiveLabel')}</span>
                    )}
                  </span>
                  <span className="account-list-amount">{formatCurrency(balance?.amount ?? 0, 'JPY')}</span>
                </div>
                <div className="account-list-row">
                  <span className="account-list-member">
                    {t('memberSelectLabel')}:{' '}
                    {account.householdMemberId !== null
                      ? data.householdMemberNameById.get(account.householdMemberId)
                      : t('memberUnspecified')}
                  </span>
                  <span className="account-list-actions">
                    <button type="button" onClick={() => openEditForm(account)} disabled={isSubmitting}>
                      {t('editButton')}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        data-action="delete"
                        onClick={() => deleteAccount(account.id)}
                        disabled={isSubmitting}
                      >
                        {t('deleteButton')}
                      </button>
                    )}
                    {account.isActive && (
                      <button
                        type="button"
                        data-action="deactivate"
                        onClick={() => deactivateAccount(account.id)}
                        disabled={isSubmitting}
                      >
                        {t('deactivateButton')}
                      </button>
                    )}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {formMode !== null && (
        <div className="account-edit-form">
          <label htmlFor="account-edit-name">{t('nameEditLabel')}</label>
          <input
            id="account-edit-name"
            type="text"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />

          <label htmlFor="account-edit-member">{t('memberSelectLabel')}</label>
          <select
            id="account-edit-member"
            value={householdMemberIdInput ?? ''}
            onChange={(event) =>
              setHouseholdMemberIdInput(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">{t('memberUnspecified')}</option>
            {data.householdMembers
              .filter((member) => member.isActive || member.id === householdMemberIdInput)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </select>

          <div className="account-edit-form-actions">
            <button type="button" onClick={submitEdit} disabled={nameInput.trim() === '' || isSubmitting}>
              {t('saveSubmit')}
            </button>
            <button type="button" onClick={closeForm} disabled={isSubmitting}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      <button type="button" onClick={onBack} disabled={isSubmitting}>
        {t('back')}
      </button>
    </div>
  )
}
