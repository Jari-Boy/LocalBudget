import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type {
  AccountGroup,
  AccountGroupCategory,
  CreateAccountGroupInput,
  UpdateAccountGroupInput,
} from '../../domain/account-group/AccountGroup'
import { buildAccountGroupForest, type AccountGroupForestNode } from '../../domain/account-group/buildAccountGroupForest'
import { buildAccountGroupPathLabels } from '../../domain/account-group/buildAccountGroupPathLabels'
import { isDescendantGroup } from '../../domain/account-group/isDescendantGroup'
import {
  resolveAccountGroupDrop,
  type AccountGroupNodeRef,
} from '../../domain/account-group/resolveAccountGroupDrop'
import { EyeIcon, TrashIcon } from '../icons/ActionIcons'
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
  update(id: number, input: { accountGroupId?: number | null; sortOrder?: number }): Account | Promise<Account>
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
  childCountByGroupId: Map<number, number>
  accountCountByGroupId: Map<number, number>
}

const CATEGORY_ORDER: AccountGroupCategory[] = ['asset', 'liability', 'revenue', 'expense']
const CATEGORY_LABEL_KEY: Record<AccountGroupCategory, string> = {
  asset: 'listCategoryAsset',
  liability: 'listCategoryLiability',
  revenue: 'listCategoryRevenue',
  expense: 'listCategoryExpense',
}

type RowDescriptor =
  | { kind: 'group'; prefix: string; group: AccountGroup; hasChildren: boolean }
  | { kind: 'account'; prefix: string; account: Account }

function flattenForest(
  nodes: AccountGroupForestNode[],
  continuation: string,
  expandedGroupIds: Set<number>,
  rows: RowDescriptor[],
) {
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1
    const connector = isLast ? '└─ ' : '├─ '
    const prefix = continuation + connector
    const nextContinuation = continuation + (isLast ? '   ' : '│  ')
    if (node.kind === 'account') {
      rows.push({ kind: 'account', prefix, account: node.account })
    } else {
      rows.push({ kind: 'group', prefix, group: node.group, hasChildren: node.children.length > 0 })
      if (expandedGroupIds.has(node.group.id)) {
        flattenForest(node.children, nextContinuation, expandedGroupIds, rows)
      }
    }
  })
}

type DragZone = 'before' | 'after' | 'inside'

function computeDragZone(event: { currentTarget: EventTarget; clientY: number }, allowInside: boolean): DragZone {
  const rect = (event.currentTarget as Element).getBoundingClientRect()
  const relativeY = rect.height === 0 ? 0.5 : (event.clientY - rect.top) / rect.height
  if (allowInside) {
    if (relativeY < 0.25) return 'before'
    if (relativeY > 0.75) return 'after'
    return 'inside'
  }
  return relativeY < 0.5 ? 'before' : 'after'
}

/**
 * 勘定科目グループ管理画面(計画Issue #129)。「資産/負債/収益/費用」の4セクション見出しの
 * 直下に、そのcategoryに属する最上位グループをツリー表示する(buildAccountGroupForestで
 * サブグループ+直属科目を1つの表示順に混在させ、展開済みのグループのみ子を描画する)。
 * 各セクション見出しの「+グループを追加」から作成したグループのcategoryはそのセクションで
 * 自動的に確定し、以後変更できない(作成フォームにcategory選択欄は無い)。
 * グループ・科目の行はドラッグ可能で、ドロップ先の行の上端/下端(兄弟として挿入、階層は
 * 変えない)・中央(グループの場合のみ、子としてネスト)で挙動が変わる
 * (resolveAccountGroupDropが判定、categoryをまたぐ・循環参照になる操作は拒否しエラー表示)。
 * キーボード操作・スクリーンリーダー向けに、各行のチェックボックスで1件以上選択すると
 * 上部に移動先選択(プルダウン)が現れ、選んだ瞬間に確定する(単体移動も複数選択での
 * まとめて移動も同じ経路)。選択項目のcategoryが揃っていなければ移動先は出さず、
 * その旨をメッセージで示す。グループ名はダブルクリックまたはフォーカス+Enter/Spaceで
 * インライン編集できる。削除(子グループ・所属科目がともに0件のみ)・非アクティブ化は
 * 既存のルールを維持する。
 */
export function AccountGroupManagementScreen({
  accountGroupRepository,
  accountRepository,
  onBack,
}: AccountGroupManagementScreenProps) {
  const { t } = useTranslation('accountGroup')
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')

  const [data, setData] = useState<LoadedData | null>(null)
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<number>>(new Set())
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set())
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<number>>(new Set())
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [createFormCategory, setCreateFormCategory] = useState<AccountGroupCategory | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draggingNode, setDraggingNode] = useState<AccountGroupNodeRef | null>(null)
  const [dragOverRowKey, setDragOverRowKey] = useState<string | null>(null)

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
        accountCountByGroupId.set(account.accountGroupId, (accountCountByGroupId.get(account.accountGroupId) ?? 0) + 1)
      }
      setData({ groups, accounts, childCountByGroupId, accountCountByGroupId })
    })
  }

  useEffect(load, [accountGroupRepository, accountRepository])

  const forest = useMemo(() => (data ? buildAccountGroupForest(data.groups, data.accounts) : []), [data])
  const pathLabelByGroupId = useMemo(() => (data ? buildAccountGroupPathLabels(data.groups) : new Map()), [data])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const toggleExpand = (groupId: number) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const expandAll = () => setExpandedGroupIds(new Set(data.groups.map((g) => g.id)))
  const collapseAll = () => setExpandedGroupIds(new Set())

  const openCreateForm = (category: AccountGroupCategory) => {
    setCreateFormCategory(category)
    setNewGroupName('')
    setError(null)
  }
  const closeCreateForm = () => {
    setCreateFormCategory(null)
    setNewGroupName('')
  }

  const submitCreate = () => {
    const name = newGroupName.trim()
    if (!name || createFormCategory === null || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => accountGroupRepository.create({ name, category: createFormCategory }))
      .then(() => {
        closeCreateForm()
        load()
      })
      .catch(() => setError(t('createError')))
      .finally(() => setIsSubmitting(false))
  }

  const startEditName = (group: AccountGroup) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
    setError(null)
  }
  const cancelEditName = () => {
    setEditingGroupId(null)
    setEditingGroupName('')
  }
  const saveEditName = (groupId: number) => {
    const name = editingGroupName.trim()
    if (!name || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => accountGroupRepository.update(groupId, { name }))
      .then(() => {
        setEditingGroupId(null)
        setEditingGroupName('')
        load()
      })
      .catch(() => setError(t('renameError')))
      .finally(() => setIsSubmitting(false))
  }

  const toggleGroupSelect = (id: number) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleAccountSelect = (id: number) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearSelection = () => {
    setSelectedGroupIds(new Set())
    setSelectedAccountIds(new Set())
  }

  const selectedGroups = data.groups.filter((g) => selectedGroupIds.has(g.id))
  const selectedAccounts = data.accounts.filter((a) => selectedAccountIds.has(a.id))
  const selectionCount = selectedGroups.length + selectedAccounts.length
  const selectionCategories = new Set([
    ...selectedGroups.map((g) => g.category),
    ...selectedAccounts.map((a) => a.category),
  ])
  const selectionMixedCategory = selectionCategories.size > 1
  const bulkMoveOptions: { value: string; label: string }[] = []
  if (selectionCount > 0 && !selectionMixedCategory) {
    const category = [...selectionCategories][0]
    const blockedGroupIds = new Set<number>()
    for (const group of selectedGroups) {
      for (const candidate of data.groups) {
        if (candidate.id === group.id || isDescendantGroup(data.groups, group.id, candidate.id)) {
          blockedGroupIds.add(candidate.id)
        }
      }
    }
    for (const group of data.groups) {
      if (group.category !== category || blockedGroupIds.has(group.id)) continue
      bulkMoveOptions.push({ value: 'group:' + group.id, label: pathLabelByGroupId.get(group.id) ?? group.name })
    }
    if (selectedAccounts.length === selectionCount) {
      bulkMoveOptions.push({ value: 'unclassified', label: t('moveTargetUnclassified') })
    }
    if (selectedGroups.length === selectionCount && selectedGroups.some((g) => g.parentGroupId !== null)) {
      bulkMoveOptions.push({ value: 'root', label: t('moveTargetRoot') })
    }
  }

  const applyBulkMove = (value: string) => {
    if (!value || isSubmitting) return
    setIsSubmitting(true)
    setError(null)

    const groupIds = selectedGroups.map((g) => g.id)
    const accountIds = selectedAccounts.map((a) => a.id)

    const buildUpdates = (): Promise<unknown>[] => {
      if (value === 'unclassified') {
        return accountIds.map((id) =>
          Promise.resolve().then(() => accountRepository.update(id, { accountGroupId: null })),
        )
      }
      if (value === 'root') {
        return groupIds.map((id) =>
          Promise.resolve().then(() => accountGroupRepository.update(id, { parentGroupId: null })),
        )
      }
      const targetId = Number(value.slice('group:'.length))
      return [
        ...accountIds.map((id) =>
          Promise.resolve().then(() => accountRepository.update(id, { accountGroupId: targetId })),
        ),
        ...groupIds.map((id) =>
          Promise.resolve().then(() => accountGroupRepository.update(id, { parentGroupId: targetId })),
        ),
      ]
    }

    void Promise.all(buildUpdates())
      .then(() => {
        clearSelection()
        load()
      })
      .catch(() => setError(t('bulkMoveError')))
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

  const handleDragStart = (node: AccountGroupNodeRef) => (event: React.DragEvent) => {
    event.dataTransfer.setData('text/plain', node.kind + ':' + node.id)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingNode(node)
  }
  const handleDragEnd = () => {
    setDraggingNode(null)
    setDragOverRowKey(null)
  }
  const handleRowDragOver = (event: React.DragEvent) => {
    if (draggingNode) event.preventDefault()
  }
  const handleRowDragEnter = (key: string) => () => {
    if (draggingNode) setDragOverRowKey(key)
  }
  const handleRowDragLeave = (key: string) => () => {
    setDragOverRowKey((prev) => (prev === key ? null : prev))
  }

  const applyDropResult = (groupUpdates: Map<number, UpdateAccountGroupInput>, accountUpdates: Map<number, { accountGroupId?: number | null; sortOrder?: number }>) => {
    if (groupUpdates.size === 0 && accountUpdates.size === 0) return
    setIsSubmitting(true)
    setError(null)
    const updates: Promise<unknown>[] = [
      ...[...groupUpdates.entries()].map(([id, patch]) =>
        Promise.resolve().then(() => accountGroupRepository.update(id, patch)),
      ),
      ...[...accountUpdates.entries()].map(([id, patch]) =>
        Promise.resolve().then(() => accountRepository.update(id, patch)),
      ),
    ]
    void Promise.all(updates)
      .then(load)
      .catch(() => setError(t('dropError')))
      .finally(() => setIsSubmitting(false))
  }

  const handleDropOnRow = (target: AccountGroupNodeRef, allowInside: boolean) => (event: React.DragEvent) => {
    event.preventDefault()
    setDragOverRowKey(null)
    const dragged = draggingNode
    setDraggingNode(null)
    if (!dragged) return

    const zone = computeDragZone(event, allowInside)
    const result = resolveAccountGroupDrop(data.groups, data.accounts, dragged, { ...target, zone })
    if (!result) {
      setError(t('dropCategoryMismatchError'))
      return
    }
    applyDropResult(result.groupUpdates, result.accountUpdates)
  }

  const handleDropOnSection = (category: AccountGroupCategory) => (event: React.DragEvent) => {
    event.preventDefault()
    setDragOverRowKey(null)
    const dragged = draggingNode
    setDraggingNode(null)
    if (!dragged || dragged.kind !== 'group') return
    const group = data.groups.find((g) => g.id === dragged.id)
    if (!group) return
    if (group.category !== category) {
      setError(t('dropCategoryMismatchError'))
      return
    }
    if (group.parentGroupId === null) return
    applyDropResult(new Map([[group.id, { parentGroupId: null }]]), new Map())
  }

  return (
    <div className="account-group-management-screen">
      <h2>{t('groupListTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {selectionCount > 0 && (
        <div className="account-group-selection-toolbar">
          <strong>{t('selectionCountLabel', { count: selectionCount })}</strong>
          {selectionMixedCategory ? (
            <span>{t('selectionMixedCategoryMessage')}</span>
          ) : (
            <label>
              {t('moveTargetSelectLabel')}
              <select
                aria-label={t('moveTargetSelectLabel')}
                onChange={(event) => applyBulkMove(event.target.value)}
                defaultValue=""
                disabled={isSubmitting}
              >
                <option value="">{t('moveTargetPlaceholder')}</option>
                {bulkMoveOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={clearSelection} disabled={isSubmitting}>
            {t('clearSelectionButton')}
          </button>
        </div>
      )}

      <div className="account-group-tree-actions">
        <button type="button" onClick={expandAll}>
          {t('expandAllButton')}
        </button>
        <button type="button" onClick={collapseAll}>
          {t('collapseAllButton')}
        </button>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const rootGroups = forest.filter((node) => node.group.category === category)
        const unclassifiedAccounts = data.accounts.filter(
          (a) => a.category === category && a.accountGroupId === null,
        )
        const rootNodes: AccountGroupForestNode[] = [
          ...rootGroups,
          ...unclassifiedAccounts.map((account): AccountGroupForestNode => ({ kind: 'account', account })),
        ].sort(
          (a, b) =>
            (a.kind === 'group' ? a.group.sortOrder : a.account.sortOrder) -
            (b.kind === 'group' ? b.group.sortOrder : b.account.sortOrder),
        )
        const rows: RowDescriptor[] = []
        flattenForest(rootNodes, '', expandedGroupIds, rows)
        const sectionKey = 'section-' + category

        return (
          <section key={category} data-section>
            <div
              className="account-group-section-heading"
              onDragOver={handleRowDragOver}
              onDragEnter={handleRowDragEnter(sectionKey)}
              onDragLeave={handleRowDragLeave(sectionKey)}
              onDrop={handleDropOnSection(category)}
              data-drag-over={dragOverRowKey === sectionKey || undefined}
            >
              <h3>{tAccount(CATEGORY_LABEL_KEY[category])}</h3>
              <button type="button" onClick={() => openCreateForm(category)} disabled={isSubmitting}>
                {t('addGroupButton')}
              </button>
              {rootNodes.length === 0 && (
                <span className="account-group-section-empty">{t('emptyGroupsInSection')}</span>
              )}
            </div>

            {createFormCategory === category && (
              <div className="account-group-create-form">
                <label htmlFor={'new-group-name-' + category}>
                  {t('newGroupNameInSectionLabel', { section: tAccount(CATEGORY_LABEL_KEY[category]) })}
                </label>
                <input
                  id={'new-group-name-' + category}
                  aria-label={t('newGroupNameLabel')}
                  type="text"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                />
                <div className="account-group-create-form-actions">
                  <button type="button" onClick={submitCreate} disabled={newGroupName.trim() === '' || isSubmitting}>
                    {t('createSubmit')}
                  </button>
                  <button type="button" onClick={closeCreateForm} disabled={isSubmitting}>
                    {t('cancel')}
                  </button>
                </div>
              </div>
            )}

            <ul className="account-group-tree">
              {rows.map((row) => {
                if (row.kind === 'account') {
                  const account = row.account
                  const rowKey = 'account-' + account.id
                  const node: AccountGroupNodeRef = { kind: 'account', id: account.id }
                  return (
                    <li
                      key={rowKey}
                      data-row-id={rowKey}
                      className="account-group-row"
                      draggable
                      onDragStart={handleDragStart(node)}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleRowDragOver}
                      onDragEnter={handleRowDragEnter(rowKey)}
                      onDragLeave={handleRowDragLeave(rowKey)}
                      onDrop={handleDropOnRow(node, false)}
                      data-drag-over={dragOverRowKey === rowKey || undefined}
                    >
                      <span aria-hidden="true" className="account-group-row-prefix">
                        {row.prefix}
                      </span>
                      <input
                        type="checkbox"
                        aria-label={t('selectCheckboxLabel', { name: account.name })}
                        checked={selectedAccountIds.has(account.id)}
                        onChange={() => toggleAccountSelect(account.id)}
                      />
                      <span className="account-group-row-spacer" aria-hidden="true" />
                      <span className="account-group-row-name account-group-row-name-account">{account.name}</span>
                    </li>
                  )
                }

                const group = row.group
                const rowKey = 'group-' + group.id
                const node: AccountGroupNodeRef = { kind: 'group', id: group.id }
                const isEditing = editingGroupId === group.id
                const canDelete =
                  (data.childCountByGroupId.get(group.id) ?? 0) === 0 &&
                  (data.accountCountByGroupId.get(group.id) ?? 0) === 0

                return (
                  <li
                    key={rowKey}
                    data-row-id={rowKey}
                    className="account-group-row"
                    draggable
                    onDragStart={handleDragStart(node)}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleRowDragOver}
                    onDragEnter={handleRowDragEnter(rowKey)}
                    onDragLeave={handleRowDragLeave(rowKey)}
                    onDrop={handleDropOnRow(node, true)}
                    data-drag-over={dragOverRowKey === rowKey || undefined}
                  >
                    <span aria-hidden="true" className="account-group-row-prefix">
                      {row.prefix}
                    </span>
                    <input
                      type="checkbox"
                      aria-label={t('selectCheckboxLabel', { name: group.name })}
                      checked={selectedGroupIds.has(group.id)}
                      onChange={() => toggleGroupSelect(group.id)}
                    />
                    {row.hasChildren ? (
                      <button
                        type="button"
                        className="account-group-toggle"
                        aria-expanded={expandedGroupIds.has(group.id)}
                        aria-label={
                          expandedGroupIds.has(group.id)
                            ? t('toggleCollapse', { name: group.name })
                            : t('toggleExpand', { name: group.name })
                        }
                        onClick={() => toggleExpand(group.id)}
                      >
                        {expandedGroupIds.has(group.id) ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="account-group-row-spacer" aria-hidden="true" />
                    )}

                    {isEditing ? (
                      <>
                        <input
                          type="text"
                          aria-label={t('editNameAriaLabel', { name: group.name })}
                          value={editingGroupName}
                          onChange={(event) => setEditingGroupName(event.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => saveEditName(group.id)}
                          disabled={editingGroupName.trim() === '' || isSubmitting}
                        >
                          {t('saveNameButton')}
                        </button>
                        <button type="button" onClick={cancelEditName} disabled={isSubmitting}>
                          {t('cancel')}
                        </button>
                      </>
                    ) : (
                      <span
                        role="button"
                        tabIndex={0}
                        className="account-group-row-name"
                        aria-label={t('editNameHint', { name: group.name })}
                        onDoubleClick={() => startEditName(group)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            startEditName(group)
                          }
                        }}
                      >
                        {group.name}
                        {!group.isActive && <span className="account-group-inactive-label">{t('inactiveLabel')}</span>}
                      </span>
                    )}

                    <span className="account-group-row-icon-actions">
                      {canDelete && (
                        <button
                          type="button"
                          className="icon-action-button icon-action-danger"
                          title={t('deleteButton')}
                          aria-label={t('deleteButton')}
                          onClick={() => deleteGroup(group.id)}
                          disabled={isSubmitting}
                        >
                          <TrashIcon />
                        </button>
                      )}
                      {group.isActive && (
                        <button
                          type="button"
                          className="icon-action-button"
                          title={t('deactivateButton')}
                          aria-label={t('deactivateButton')}
                          onClick={() => deactivateGroup(group.id)}
                          disabled={isSubmitting}
                        >
                          <EyeIcon />
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <button type="button" onClick={onBack} disabled={isSubmitting}>
        {t('back')}
      </button>
    </div>
  )
}
