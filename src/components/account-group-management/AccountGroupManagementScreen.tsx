import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type {
  AccountGroup,
  CreateAccountGroupInput,
  UpdateAccountGroupInput,
} from '../../domain/account-group/AccountGroup'
import { flattenAccountGroupTree } from '../../domain/account-group/flattenAccountGroupTree'
import { isDescendantGroup } from '../../domain/account-group/isDescendantGroup'
import './AccountGroupManagementScreen.css'

interface AccountGroupFinder {
  findAll(): AccountGroup[] | Promise<AccountGroup[]>
}
interface AccountGroupCreator {
  create(input: CreateAccountGroupInput): AccountGroup | Promise<AccountGroup>
}
interface AccountGroupUpdater {
  update(id: number, input: UpdateAccountGroupInput): AccountGroup | Promise<AccountGroup>
}
interface AccountGroupDeleter {
  delete(id: number): void | Promise<void>
}
interface AccountGroupDeactivator {
  deactivate(id: number): AccountGroup | Promise<AccountGroup>
}
interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}

export interface AccountGroupManagementScreenProps {
  accountGroupRepository: AccountGroupFinder &
    AccountGroupCreator &
    AccountGroupUpdater &
    AccountGroupDeleter &
    AccountGroupDeactivator
  accountRepository: AccountFinder
  onBack: () => void
}

interface LoadedData {
  groups: AccountGroup[]
  /** docs/schema/accounts.sqlのprevent_delete_account_group_with_childrenと同じ判定基準 */
  childCountByGroupId: Map<number, number>
  /** docs/schema/accounts.sqlのprevent_delete_account_group_with_accountsと同じ判定基準 */
  accountCountByGroupId: Map<number, number>
}

/** null = 非表示、'create' = 新規作成フォーム、number(id) = 該当グループの編集フォーム */
type FormMode = 'create' | number | null

/**
 * 勘定科目グループ管理画面(計画Issue #112)。登録済みグループの一覧表示・新規作成
 * (名称・親グループ)・編集(名称・親グループ)・削除/非アクティブ化を、単一画面+
 * インラインフォームで提供する(docs/domain/accounts.md 3.3節)。入れ子構造は展開/
 * 折りたたみ式ツリーではなく、深さに応じたインデント付きフラットリスト(意図的な
 * スコープ限定、計画Issue #112)で表現する。物理削除は子グループ・所属科目がともに
 * 0件の場合のみ許可し、循環参照(親グループの変更で自分自身の子孫を親に指定する操作)は
 * Repository層(isDescendantGroupを用いたSqlJsAccountGroupRepository)で最終的に
 * 拒否されるが、UI側の親グループ選択欄でも編集対象の子孫を事前に選択肢から除外する。
 */
export function AccountGroupManagementScreen({
  accountGroupRepository,
  accountRepository,
  onBack,
}: AccountGroupManagementScreenProps) {
  const { t } = useTranslation('accountGroup')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [nameInput, setNameInput] = useState('')
  const [parentGroupIdInput, setParentGroupIdInput] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 作成・編集・削除・非アクティブ化のいずれか進行中は全操作ボタンを無効化する(連打による二重実行防止) */
  const [isSubmitting, setIsSubmitting] = useState(false)

  const load = () => {
    void Promise.all([
      Promise.resolve(accountGroupRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
    ]).then(([groups, accounts]) => {
      const childCountByGroupId = new Map<number, number>()
      for (const group of groups) {
        if (group.parentGroupId === null) continue
        childCountByGroupId.set(group.parentGroupId, (childCountByGroupId.get(group.parentGroupId) ?? 0) + 1)
      }
      const accountCountByGroupId = new Map<number, number>()
      for (const account of accounts) {
        if (account.accountGroupId === null) continue
        accountCountByGroupId.set(
          account.accountGroupId,
          (accountCountByGroupId.get(account.accountGroupId) ?? 0) + 1,
        )
      }
      setData({ groups, childCountByGroupId, accountCountByGroupId })
    })
  }

  useEffect(load, [accountGroupRepository, accountRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const openCreateForm = () => {
    setNameInput('')
    setParentGroupIdInput(null)
    setError(null)
    setFormMode('create')
  }

  const openEditForm = (group: AccountGroup) => {
    setNameInput(group.name)
    setParentGroupIdInput(group.parentGroupId)
    setError(null)
    setFormMode(group.id)
  }

  const closeForm = () => {
    setFormMode(null)
    setError(null)
  }

  const submitForm = () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    const request =
      formMode === 'create'
        ? Promise.resolve(
            accountGroupRepository.create({ name: nameInput, parentGroupId: parentGroupIdInput }),
          )
        : Promise.resolve(
            accountGroupRepository.update(formMode as number, {
              name: nameInput,
              parentGroupId: parentGroupIdInput,
            }),
          )

    void request
      .then(() => {
        closeForm()
        load()
      })
      .catch(() => setError(t('saveError')))
      .finally(() => setIsSubmitting(false))
  }

  const deleteGroup = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(accountGroupRepository.delete(id))
      .then(load)
      .catch(() => setError(t('deleteError')))
      .finally(() => setIsSubmitting(false))
  }

  const deactivateGroup = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve(accountGroupRepository.deactivate(id))
      .then(load)
      .catch(() => setError(t('deactivateError')))
      .finally(() => setIsSubmitting(false))
  }

  const parentOptions = data.groups.filter((group) => {
    if (group.id === formMode) return false
    if (typeof formMode === 'number' && isDescendantGroup(data.groups, formMode, group.id)) return false
    return group.isActive || group.id === parentGroupIdInput
  })

  return (
    <div className="account-group-management-screen">
      <h2>{t('groupListTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {data.groups.length === 0 ? (
        <p>{t('groupListEmpty')}</p>
      ) : (
        <ul>
          {flattenAccountGroupTree(data.groups).map(({ group, depth }) => {
            const canDelete =
              (data.childCountByGroupId.get(group.id) ?? 0) === 0 &&
              (data.accountCountByGroupId.get(group.id) ?? 0) === 0
            return (
              <li key={group.id} data-depth={depth} style={{ marginLeft: `${depth * 1.5}rem` }}>
                <div className="account-group-list-row">
                  <span className="account-group-list-name">
                    {group.name}
                    {!group.isActive && (
                      <span className="account-group-list-inactive">{t('inactiveLabel')}</span>
                    )}
                  </span>
                  <span className="account-group-list-actions">
                    <button type="button" onClick={() => openEditForm(group)} disabled={isSubmitting}>
                      {t('editButton')}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        data-action="delete"
                        onClick={() => deleteGroup(group.id)}
                        disabled={isSubmitting}
                      >
                        {t('deleteButton')}
                      </button>
                    )}
                    {group.isActive && (
                      <button
                        type="button"
                        data-action="deactivate"
                        onClick={() => deactivateGroup(group.id)}
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

      {formMode === null ? (
        <button type="button" onClick={openCreateForm} disabled={isSubmitting}>
          {t('addButton')}
        </button>
      ) : (
        <div className="account-group-form">
          <label htmlFor="account-group-name">{t('nameLabel')}</label>
          <input
            id="account-group-name"
            type="text"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
          />

          <label htmlFor="account-group-parent">{t('parentLabel')}</label>
          <select
            id="account-group-parent"
            value={parentGroupIdInput ?? ''}
            onChange={(event) =>
              setParentGroupIdInput(event.target.value === '' ? null : Number(event.target.value))
            }
          >
            <option value="">{t('parentUnspecified')}</option>
            {parentOptions.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>

          <div className="account-group-form-actions">
            <button type="button" onClick={submitForm} disabled={nameInput.trim() === '' || isSubmitting}>
              {formMode === 'create' ? t('createSubmit') : t('saveSubmit')}
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
