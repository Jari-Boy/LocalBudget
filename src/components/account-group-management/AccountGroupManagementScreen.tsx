import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type {
  AccountGroup,
  CreateAccountGroupInput,
  UpdateAccountGroupInput,
} from '../../domain/account-group/AccountGroup'
import { buildAccountGroupPathLabels } from '../../domain/account-group/buildAccountGroupPathLabels'
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
interface AccountUpdater {
  update(id: number, input: { accountGroupId: number | null }): Account | Promise<Account>
}

export interface AccountGroupManagementScreenProps {
  accountGroupRepository: AccountGroupFinder &
    AccountGroupCreator &
    AccountGroupUpdater &
    AccountGroupDeleter &
    AccountGroupDeactivator
  accountRepository: AccountFinder & AccountUpdater
  onBack: () => void
}

interface LoadedData {
  groups: AccountGroup[]
  accounts: Account[]
  /** docs/schema/accounts.sqlのprevent_delete_account_group_with_childrenと同じ判定基準 */
  childCountByGroupId: Map<number, number>
  /** docs/schema/accounts.sqlのprevent_delete_account_group_with_accountsと同じ判定基準 */
  accountCountByGroupId: Map<number, number>
}

/** null = 非表示、'create' = 新規作成フォーム、number(id) = 該当グループの編集フォーム */
type FormMode = 'create' | number | null

/**
 * 一括割り当てパネルの対象科目の判定(ユーザー指摘への対応)。他グループに属する科目を
 * この画面から選んでこのグループへ"奪う"ことはできないよう、未分類の科目とこのグループに
 * 既に属する科目のみを対象とする。他グループへの再分類は科目側(AccountListScreen)の
 * 編集フォームから行う。is_system_managed科目は常に対象外。
 */
function isEligibleForAssignmentPanel(account: Account, groupId: number): boolean {
  if (account.isSystemManaged) return false
  return account.accountGroupId === null || account.accountGroupId === groupId
}

/**
 * 勘定科目グループ管理画面(計画Issue #112)。登録済みグループの一覧表示・新規作成
 * (名称・親グループ)・編集(名称・親グループ)・削除/非アクティブ化を、単一画面+
 * インラインフォームで提供する(docs/domain/accounts.md 3.3節)。入れ子構造は展開/
 * 折りたたみ式ツリーではなく、深さに応じたインデント付きフラットリスト(意図的な
 * スコープ限定、計画Issue #112)で表現する。物理削除は子グループ・所属科目がともに
 * 0件の場合のみ許可し、循環参照(親グループの変更で自分自身の子孫を親に指定する操作)は
 * Repository層(isDescendantGroupを用いたSqlJsAccountGroupRepository)で最終的に
 * 拒否されるが、UI側の親グループ選択欄でも編集対象の子孫を事前に選択肢から除外する。
 * 親グループ・科目選択欄には、異なる親配下の同名グループを区別できるよう
 * buildAccountGroupPathLabelsによる「親 > 子」形式のパス表示ラベルを用いる
 * (ユーザー指摘への対応)。各グループ行から「科目を割り当てる」を開くと、
 * 未分類の科目とこのグループに既に属する科目のチェックリストが表示され、複数科目を
 * まとめてこのグループへ割り当てる(または外して未分類に戻す)ことができる
 * (グループ側からの一括割り当て、ユーザー指摘への対応)。他グループに属する科目は
 * この画面からは選択肢に表示されず、この画面から他グループの科目を"奪う"操作はできない
 * (isEligibleForAssignmentPanel参照、ユーザー指摘への対応)。他グループへの再分類は
 * 科目側(AccountListScreen)の編集フォームから行う。is_system_managed科目は常に対象外。
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
  /** 新規作成時のみ使用。既存の最上位・アクティブなグループから、このグループの子にする
   * ものを選択する(ユーザー指摘への対応: 親を指定して子を作るのではなく、グループ追加時に
   * 既存グループを子として指定できるようにする)。編集時は空のまま使わない。 */
  const [childGroupIdsInput, setChildGroupIdsInput] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  /** 作成・編集・削除・非アクティブ化のいずれか進行中は全操作ボタンを無効化する(連打による二重実行防止) */
  const [isSubmitting, setIsSubmitting] = useState(false)
  /** 科目の一括割り当てパネルを開いているグループ(null = 全パネル非表示、計画Issue #112後続対応) */
  const [assignPanelGroupId, setAssignPanelGroupId] = useState<number | null>(null)
  /** 一括割り当てパネルでチェックが入っている科目id(パネルを開いた時点の所属状況で初期化する) */
  const [assignSelections, setAssignSelections] = useState<Set<number>>(new Set())

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
      setData({ groups, accounts, childCountByGroupId, accountCountByGroupId })
    })
  }

  useEffect(load, [accountGroupRepository, accountRepository])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const openCreateForm = () => {
    setNameInput('')
    setParentGroupIdInput(null)
    setChildGroupIdsInput(new Set())
    setError(null)
    setFormMode('create')
  }

  const toggleChildGroupSelection = (groupId: number) => {
    setChildGroupIdsInput((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
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
    // Repository呼び出しはPromise.resolve(fn())ではなくPromise.resolve().then(() => fn())で
    // 開始する。sql.js実装は同期的に例外を投げるため、前者だとfnの同期例外が.catch()に
    // 届かない(docs/guides/patterns.md参照)。
    void Promise.resolve()
      .then(() =>
        formMode === 'create'
          ? accountGroupRepository.create({ name: nameInput, parentGroupId: parentGroupIdInput })
          : accountGroupRepository.update(formMode as number, {
              name: nameInput,
              parentGroupId: parentGroupIdInput,
            }),
      )
      .then((savedGroup) => {
        if (formMode !== 'create' || childGroupIdsInput.size === 0) return undefined
        // 新規作成したグループを親として、選択された既存の最上位グループを子にする。
        // 作成直後のグループは他のどのグループの子孫にもなり得ないため、循環参照は起こり得ない。
        return Promise.all(
          [...childGroupIdsInput].map((childId) =>
            Promise.resolve().then(() =>
              accountGroupRepository.update(childId, { parentGroupId: savedGroup.id }),
            ),
          ),
        )
      })
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
    void Promise.resolve()
      .then(() => accountGroupRepository.delete(id))
      .then(load)
      .catch(() => setError(t('deleteError')))
      .finally(() => setIsSubmitting(false))
  }

  const deactivateGroup = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => accountGroupRepository.deactivate(id))
      .then(load)
      .catch(() => setError(t('deactivateError')))
      .finally(() => setIsSubmitting(false))
  }

  const toggleAssignPanel = (group: AccountGroup) => {
    if (assignPanelGroupId === group.id) {
      setAssignPanelGroupId(null)
      return
    }
    setAssignSelections(
      new Set(
        data.accounts.filter((account) => account.accountGroupId === group.id).map((account) => account.id),
      ),
    )
    setError(null)
    setAssignPanelGroupId(group.id)
  }

  const toggleAccountSelection = (accountId: number) => {
    setAssignSelections((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) {
        next.delete(accountId)
      } else {
        next.add(accountId)
      }
      return next
    })
  }

  const applyAssignments = (groupId: number) => {
    if (isSubmitting) return
    const changes = data.accounts
      .filter((account) => isEligibleForAssignmentPanel(account, groupId))
      .filter((account) => (account.accountGroupId === groupId) !== assignSelections.has(account.id))
      .map((account) => ({
        id: account.id,
        accountGroupId: assignSelections.has(account.id) ? groupId : null,
      }))

    if (changes.length === 0) {
      setAssignPanelGroupId(null)
      return
    }

    setIsSubmitting(true)
    setError(null)
    void Promise.all(
      changes.map((change) =>
        Promise.resolve().then(() =>
          accountRepository.update(change.id, { accountGroupId: change.accountGroupId }),
        ),
      ),
    )
      .then(() => {
        setAssignPanelGroupId(null)
        load()
      })
      .catch(() => setError(t('assignAccountsError')))
      .finally(() => setIsSubmitting(false))
  }

  const pathLabelByGroupId = buildAccountGroupPathLabels(data.groups)

  const parentOptions = data.groups.filter((group) => {
    if (group.id === formMode) return false
    if (typeof formMode === 'number' && isDescendantGroup(data.groups, formMode, group.id)) return false
    return group.isActive || group.id === parentGroupIdInput
  })

  /** 新規作成時のみ「既存のグループを子にする」候補として提示する、既存の最上位・アクティブな
   * グループ(既に親を持つグループ・非アクティブなグループは対象外)。 */
  const childGroupCandidates = data.groups.filter(
    (group) => group.parentGroupId === null && group.isActive,
  )

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
                    <button
                      type="button"
                      onClick={() => toggleAssignPanel(group)}
                      aria-expanded={assignPanelGroupId === group.id}
                      disabled={isSubmitting}
                    >
                      {assignPanelGroupId === group.id
                        ? t('assignAccountsToggleCollapse')
                        : t('assignAccountsButton')}
                    </button>
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

                {assignPanelGroupId === group.id && (
                  <div className="account-group-assign-panel">
                    <ul className="account-group-assign-list">
                      {data.accounts
                        .filter((account) => isEligibleForAssignmentPanel(account, group.id))
                        .map((account) => {
                          const currentLabel =
                            account.accountGroupId === null
                              ? t('assignAccountsUnclassifiedLabel')
                              : (pathLabelByGroupId.get(account.accountGroupId) ?? '')
                          return (
                            <li key={account.id}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={assignSelections.has(account.id)}
                                  onChange={() => toggleAccountSelection(account.id)}
                                  disabled={isSubmitting}
                                />
                                {account.name}({currentLabel})
                              </label>
                            </li>
                          )
                        })}
                    </ul>
                    <button type="button" onClick={() => applyAssignments(group.id)} disabled={isSubmitting}>
                      {t('assignAccountsApplyButton')}
                    </button>
                  </div>
                )}
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
                {pathLabelByGroupId.get(group.id) ?? group.name}
              </option>
            ))}
          </select>

          {formMode === 'create' && childGroupCandidates.length > 0 && (
            <div className="account-group-children-select">
              <span>{t('childGroupsLabel')}</span>
              <ul>
                {childGroupCandidates.map((group) => (
                  <li key={group.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={childGroupIdsInput.has(group.id)}
                        onChange={() => toggleChildGroupSelection(group.id)}
                      />
                      {group.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
