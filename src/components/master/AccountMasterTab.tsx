import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGuardedAction, useUnsavedEditGuard } from '../common/unsaved-changes/useUnsavedEditGuard'
import type { Account, AccountCategory } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { BudgetRepository } from '../../domain/budget/BudgetRepository'
import type { Budget } from '../../domain/budget/Budget'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { listDeletionBlocks, summarizeMasterUsage } from '../../domain/master/summarizeMasterUsage'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import {
  summarizeAccountRegistration,
  type AccountRegistrationSummary,
} from '../../domain/account/summarizeAccountRegistration'
import type { ImportMappingDefinition } from '../../domain/statement-import/ImportMappingDefinition'
import type { ImportMappingDefinitionRepository } from '../../domain/statement-import/ImportMappingDefinitionRepository'
import { computeTreeNodeUpdates } from '../common/tree-table/computeTreeNodeUpdates'
import { TreeTable } from '../common/tree-table/TreeTable'
import {
  CATEGORY_ID_PREFIX,
  resolveTreeMove,
  type TreeTableNode,
} from '../common/tree-table/treeTableModel'
import { AccountCreateForm } from './AccountCreateForm'
import { AccountMergePanel } from './AccountMergePanel'
import { BulkSelectionPanel } from './BulkSelectionPanel'
import { AccountMappingSection, AccountRegistrationInfo } from './AccountRegistrationSections'
import { DefaultMemberChangeDialog } from './DefaultMemberChangeDialog'
import { buildAccountTree, groupNodeId, leafNodeId, parseNodeId } from './masterTreeNodes'
import type { MaybeAsync } from './maybeAsync'
import './master.css'

export interface AccountMasterTabProps {
  accountRepository: MaybeAsync<
    Pick<AccountRepository, 'findAll' | 'create' | 'update' | 'delete' | 'deactivate' | 'activate' | 'merge'>
  >
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll' | 'create' | 'update' | 'delete'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll' | 'create' | 'delete'>>
  budgetRepository: MaybeAsync<Pick<BudgetRepository, 'findAll'>>
  recurringTransactionRuleRepository: MaybeAsync<Pick<RecurringTransactionRuleRepository, 'findAll'>>
  /** 資産・負債科目の明細マッピングの紐づけ・解除(計画Issue #189) */
  importMappingDefinitionRepository: MaybeAsync<
    Pick<ImportMappingDefinitionRepository, 'findAll' | 'linkAccount' | 'unlinkAccount'>
  >
  /** 初期残高の仕訳の日付(YYYY-MM-DD)。省略時は今日 */
  today?: string
}

interface LoadedData {
  accounts: Account[]
  groups: AccountGroup[]
  members: HouseholdMember[]
  entries: JournalEntry[]
  budgets: Budget[]
  rules: RecurringTransactionRule[]
  definitions: ImportMappingDefinition[]
}

/** 親グループの選択肢。区分の最上位は`cat:区分`、グループは`g:id`(resolveTreeMoveのtarget.idと同じ) */
function parentOptions(
  nodes: readonly TreeTableNode[],
  category: string,
  excluded: ReadonlySet<string>,
): Array<{ value: string; label: string }> {
  const walk = (parentId: string | null, depth: number): Array<{ value: string; label: string }> =>
    nodes
      .filter((n) => n.category === category && n.parentId === parentId && n.kind === 'group' && !excluded.has(n.id))
      .flatMap((n) => [{ value: n.id, label: `${'　'.repeat(depth)}${n.name}` }, ...walk(n.id, depth + 1)])
  return walk(null, 0)
}

/** ノードとその配下のid */
function withDescendants(nodes: readonly TreeTableNode[], id: string): string[] {
  return [id, ...nodes.filter((n) => n.parentId === id).flatMap((n) => withDescendants(nodes, n.id))]
}

/**
 * マスタ画面の「勘定科目」タブ(計画Issue #154)。区分(資産・負債・費用・収益・資本)の見出しの下に
 * グループと科目をツリー表で表示し、選んだ行を右パネルで編集する。画面遷移なしで、名称・所属
 * グループ・名義・並び順の変更、グループの新設、科目の新規登録(AccountCreateForm)、有効/無効の
 * 切り替え、2回押しの削除ができる。ドラッグ・複数選択・右パネルのどの方法でも、区分をまたぐ移動と
 * 循環参照は拒否される(resolveTreeMove)。システム管理の科目も名称・グループ・並び順を変更できるが、
 * 区分の変更・削除・無効化はできない。削除は使われていない項目だけで、使用中は理由を表示する
 * (summarizeMasterUsage / listDeletionBlocks)。初期残高の仕訳だけが紐づく口座は、その仕訳と
 * 一緒に削除する。
 */
export function AccountMasterTab({
  accountRepository,
  accountGroupRepository,
  householdMemberRepository,
  journalEntryRepository,
  budgetRepository,
  recurringTransactionRuleRepository,
  importMappingDefinitionRepository,
  today,
}: AccountMasterTabProps) {
  const { t } = useTranslation('master')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<readonly string[]>([])
  const [creating, setCreating] = useState<AccountCategory | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [flash, setFlash] = useState('')
  const [mergeResult, setMergeResult] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 既定の世帯メンバーを変えるときの、過去の明細行の扱いの確認待ち(計画Issue #169) */
  const [memberChange, setMemberChange] = useState<MemberChangePlan | null>(null)
  /** 未保存の編集があれば、行の選択・新規作成の開始の前に確認を通す(計画Issue #190) */
  const guarded = useGuardedAction()

  const load = useCallback(async () => {
    const [accounts, groups, members, entries, budgets, rules, definitions] = await Promise.all([
      accountRepository.findAll(),
      accountGroupRepository.findAll(),
      householdMemberRepository.findAll(),
      journalEntryRepository.findAll(),
      budgetRepository.findAll(),
      recurringTransactionRuleRepository.findAll(),
      importMappingDefinitionRepository.findAll(),
    ])
    setData({ accounts, groups, members, entries, budgets, rules, definitions })
  }, [
    accountRepository,
    accountGroupRepository,
    householdMemberRepository,
    journalEntryRepository,
    budgetRepository,
    recurringTransactionRuleRepository,
    importMappingDefinitionRepository,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const tree = useMemo(
    () =>
      data
        ? buildAccountTree({
            groups: data.groups,
            accounts: data.accounts,
            memberNameById: new Map(data.members.map((m) => [m.id, m.name])),
          })
        : null,
    [data],
  )
  const usage = useMemo(
    () =>
      data
        ? summarizeMasterUsage({
            entries: data.entries,
            budgets: data.budgets,
            rules: data.rules,
            settlementBatches: [],
            accounts: data.accounts,
          })
        : null,
    [data],
  )

  if (data === null || tree === null || usage === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  /** 操作を実行し、成功したら再読み込みする。失敗時はエラー文言を出す */
  /** 操作を実行する。成功したらtrue、失敗してエラー文言を出したらfalse */
  const run = async (action: () => Promise<void>, errorMessage: string, successMessage = ''): Promise<boolean> => {
    setBusy(true)
    setError('')
    setFlash('')
    try {
      await action()
      await load()
      setFlash(successMessage)
      return true
    } catch {
      setError(errorMessage)
      return false
    } finally {
      setBusy(false)
    }
  }

  const select = (id: string | null) => {
    setSelectedId(id)
    setCreating(null)
    setArmedId(null)
    setFlash('')
    setError('')
    setMergeResult('')
  }

  /** ツリー表で組み立てた移動後のノード配列を、DBの親グループと並び順に書き戻す */
  const applyMove = (next: TreeTableNode[]) =>
    run(async () => {
      for (const update of computeTreeNodeUpdates(tree.nodes, next, tree.sortOrders)) {
        const { kind, id } = parseNodeId(update.id)
        const parentId = update.parentId === null ? null : parseNodeId(update.parentId).id
        if (kind === 'group') {
          await accountGroupRepository.update(id, { parentGroupId: parentId, sortOrder: update.sortOrder })
        } else {
          await accountRepository.update(id, { accountGroupId: parentId, sortOrder: update.sortOrder })
        }
      }
    }, t('accountTab.moveError'))

  const moveInto = (id: string, targetId: string) => {
    const result = resolveTreeMove(tree.nodes, [id], { id: targetId, zone: 'inside' })
    if (!result.ok) {
      setError(result.reason)
      return
    }
    void applyMove(result.nodes)
  }

  const shift = (node: TreeTableNode, delta: -1 | 1) => {
    const siblings = tree.nodes.filter((n) => n.category === node.category && n.parentId === node.parentId)
    const other = siblings[siblings.indexOf(node) + delta]
    if (!other) return
    const next = tree.nodes.map((n) => (n === node ? other : n === other ? node : n))
    void applyMove(next)
  }

  const addGroup = (category: AccountCategory, parentGroupId: number | null) =>
    run(async () => {
      const group = await accountGroupRepository.create({
        name: t('accountTab.newGroupName'),
        category,
        parentGroupId,
      })
      select(groupNodeId(group.id))
    }, t('accountTab.createError'))

  // 消えた行のチェックは捨てる
  const liveCheckedIds = checkedIds.filter((id) => tree.nodes.some((n) => n.id === id))
  const selected = selectedId ? tree.nodes.find((n) => n.id === selectedId) : undefined
  const selectedAccount =
    selected?.kind === 'leaf' ? data.accounts.find((a) => a.id === parseNodeId(selected.id).id) : undefined
  const categoryName = (key: string) => tree.categories.find((c) => c.key === key)?.name ?? key

  return (
    <div className="master-split">
      <div className="master-split__main">
        <TreeTable
          categories={tree.categories}
          nodes={tree.nodes}
          columns={['名義', '状態']}
          checkedIds={liveCheckedIds}
          selectedId={selectedId}
          onSelect={(id) => guarded(() => select(id))}
          // 2件以上のチェックは右パネルを一括操作パネルに差し替えるため、未保存の編集があれば確認を通す
          onCheckedChange={(ids) => (ids.length >= 2 ? guarded(() => setCheckedIds(ids)) : setCheckedIds(ids))}
          onMove={(next) => {
            setCheckedIds([])
            void applyMove(next)
          }}
          onMoveRejected={setError}
          renderCategoryActions={(key) => (
            <>
              <button
                type="button"
                className="master-btn master-btn--small"
                aria-label={t('accountTab.addGroupLabel', { category: categoryName(key) })}
                onClick={() => guarded(() => void addGroup(key as AccountCategory, null))}
              >
                {t('accountTab.addGroup')}
              </button>
              {key !== 'equity' && (
                <button
                  type="button"
                  className="master-btn master-btn--small"
                  aria-label={t('accountTab.addAccountLabel', { category: categoryName(key) })}
                  onClick={() =>
                    guarded(() => {
                      setSelectedId(null)
                      setCreating(key as AccountCategory)
                    })
                  }
                >
                  {t('accountTab.addAccount')}
                </button>
              )}
            </>
          )}
        />
        <p className="master-note">{t('accountTab.dragHint')}</p>
        {mergeResult !== '' && (
          <p role="status" className="master-flash">
            {mergeResult}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="master-error master-split__alert">
          {error}
        </p>
      )}

      {liveCheckedIds.length >= 2 && (
        <BulkSelectionPanel
          nodes={tree.nodes}
          categories={tree.categories}
          checkedIds={liveCheckedIds}
          busy={busy}
          onMove={(next) => {
            setCheckedIds([])
            void applyMove(next)
          }}
          onMoveRejected={setError}
          onClear={() => setCheckedIds([])}
        >
          <AccountMergePanel
            accounts={data.accounts.filter((a) => liveCheckedIds.includes(leafNodeId(a.id)))}
            lineCountOf={(accountId) =>
              data.entries.flatMap((e) => e.lines).filter((l) => l.accountId === accountId).length
            }
            repository={accountRepository}
            onMerged={async (message) => {
              setMergeResult(message)
              setCheckedIds([])
              await load()
            }}
          />
        </BulkSelectionPanel>
      )}

      {liveCheckedIds.length < 2 && creating !== null && (
        <AccountCreateForm
          key={creating}
          accountRepository={accountRepository}
          journalEntryRepository={journalEntryRepository}
          groups={data.groups}
          householdMembers={data.members}
          initialCategory={creating}
          today={today}
          mappingLinking={{ definitions: data.definitions, repository: importMappingDefinitionRepository }}
          onCreated={(account, options) => {
            // 未保存の確認の「保存して移動」で登録したときは、移動先を優先して、登録した科目を選び直さない
            if (options?.leaving) void load()
            else void load().then(() => select(leafNodeId(account.id)))
          }}
          onCancel={() => setCreating(null)}
        />
      )}

      {liveCheckedIds.length < 2 && creating === null && selected && (
        <EditPanel
          key={selected.id}
          node={selected}
          account={selected.kind === 'leaf' ? data.accounts.find((a) => a.id === parseNodeId(selected.id).id) : undefined}
          nodes={tree.nodes}
          members={data.members}
          categoryName={categoryName(selected.category)}
          busy={busy}
          flash={flash}
          armed={armedId === selected.id}
          deleteBlockedText={deleteBlockedText(selected, tree.nodes, data, usage, t)}
          hasInitialBalanceEntries={
            selected.kind === 'leaf' &&
            usage.get('account', parseNodeId(selected.id).id).initialBalanceEntryIds.length > 0
          }
          registration={
            selected.kind === 'leaf' && selectedAccount
              ? summarizeAccountRegistration(selectedAccount, data.entries)
              : null
          }
          definitions={data.definitions}
          onLinkDefinition={(definitionId) =>
            run(
              async () => {
                await importMappingDefinitionRepository.linkAccount(definitionId, selectedAccount!.id)
              },
              t('accountTab.mappingError'),
              t('accountTab.mappingLinked'),
            )
          }
          onUnlinkDefinition={(definitionId) =>
            run(
              async () => {
                await importMappingDefinitionRepository.unlinkAccount(definitionId, selectedAccount!.id)
              },
              t('accountTab.mappingError'),
              t('accountTab.mappingUnlinked'),
            )
          }
          onMoveInto={(targetId) => moveInto(selected.id, targetId)}
          onShift={(delta) => shift(selected, delta)}
          onSave={async (patch) => {
            const { kind, id } = parseNodeId(selected.id)
            if (kind === 'leaf') {
              const change = planMemberChange(data, id, patch)
              if (change !== null) {
                // 過去の明細行に影響するときは、更新するか残すかを選んでもらってから保存する
                // 「保存して移動」のときは、確認が済むまで移動を止める
                setMemberChange(change)
                return false
              }
            }
            return run(
              async () => {
                if (kind === 'group') {
                  await accountGroupRepository.update(id, { name: patch.name })
                } else {
                  await accountRepository.update(id, patch.householdMemberId === undefined
                    ? { name: patch.name }
                    : { name: patch.name, householdMemberId: patch.householdMemberId })
                }
              },
              t('accountTab.saveError'),
              t('accountTab.saved'),
            )
          }}
          onToggleActive={() =>
            run(async () => {
              const account = data.accounts.find((a) => a.id === parseNodeId(selected.id).id)!
              if (account.isActive) await accountRepository.deactivate(account.id)
              else await accountRepository.activate(account.id)
            }, t('accountTab.toggleError'))
          }
          onAddSubgroup={() =>
            guarded(() => void addGroup(selected.category as AccountCategory, parseNodeId(selected.id).id))
          }
          onAddAccount={() => guarded(() => setCreating(selected.category as AccountCategory))}
          onDelete={() => {
            if (armedId !== selected.id) {
              setArmedId(selected.id)
              return
            }
            void run(async () => {
              const { kind, id } = parseNodeId(selected.id)
              if (kind === 'group') {
                await accountGroupRepository.delete(id)
              } else {
                for (const entryId of usage.get('account', id).initialBalanceEntryIds) {
                  await journalEntryRepository.delete(entryId)
                }
                await accountRepository.delete(id)
              }
              setSelectedId(null)
              setArmedId(null)
            }, t('accountTab.deleteError'))
          }}
        />
      )}

      {memberChange !== null && (
        <DefaultMemberChangeDialog
          accountName={memberChange.accountName}
          fromName={memberChange.fromName}
          toName={memberChange.toName}
          lineCount={memberChange.lineCount}
          busy={busy}
          onCancel={() => setMemberChange(null)}
          onConfirm={(updateExistingLines) => {
            const change = memberChange
            setMemberChange(null)
            void run(
              async () => {
                await accountRepository.update(
                  change.accountId,
                  { name: change.name, householdMemberId: change.toId },
                  { updateExistingLines },
                )
              },
              t('accountTab.saveError'),
              t('accountTab.saved'),
            )
          }}
        />
      )}
    </div>
  )
}

/** 既定の世帯メンバーの変更で、過去の明細行の扱いを選んでもらう必要があるときの内容 */
interface MemberChangePlan {
  accountId: number
  accountName: string
  name: string
  fromName: string
  toId: number
  toName: string
  lineCount: number
}

/**
 * 既定の世帯メンバーを非nullの別のメンバーへ変えるとき、新しい既定メンバーと異なる世帯メンバーを持つ
 * この科目の明細行が1行でもあれば、確認の内容を返す。確認が要らなければ(変更なし・解除・対象の行なし)null
 */
function planMemberChange(
  data: LoadedData,
  accountId: number,
  patch: { name: string; householdMemberId?: number | null },
): MemberChangePlan | null {
  const account = data.accounts.find((a) => a.id === accountId)
  const nextMemberId = patch.householdMemberId
  if (account === undefined || nextMemberId === undefined || nextMemberId === null) return null
  if (nextMemberId === account.householdMemberId) return null
  const lineCount = data.entries
    .flatMap((e) => e.lines)
    .filter((l) => l.accountId === accountId && l.householdMemberId !== nextMemberId).length
  if (lineCount === 0) return null
  const nameOf = (memberId: number | null) =>
    memberId === null ? 'なし' : (data.members.find((m) => m.id === memberId)?.name ?? '')
  return {
    accountId,
    accountName: account.name,
    name: patch.name,
    fromName: nameOf(account.householdMemberId),
    toId: nextMemberId,
    toName: nameOf(nextMemberId),
    lineCount,
  }
}

/** 削除できない理由の文言。削除できるときは空文字 */
function deleteBlockedText(
  node: TreeTableNode,
  nodes: readonly TreeTableNode[],
  data: LoadedData,
  usage: ReturnType<typeof summarizeMasterUsage>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (node.kind === 'group') {
    return nodes.some((n) => n.parentId === node.id) ? t('accountTab.groupNotEmpty') : ''
  }
  const account = data.accounts.find((a) => a.id === parseNodeId(node.id).id)
  if (!account || account.isSystemManaged) return ''
  const blocks = listDeletionBlocks('account', usage.get('account', account.id))
  if (blocks.length === 0) return ''
  const reasons = blocks
    .map((b) => t(`accountTab.block${b.source[0].toUpperCase()}${b.source.slice(1)}`, { count: b.count }))
    .join('、')
  return t('accountTab.deleteBlocked', { reasons })
}

interface EditPanelProps {
  node: TreeTableNode
  account: Account | undefined
  nodes: readonly TreeTableNode[]
  members: readonly HouseholdMember[]
  categoryName: string
  busy: boolean
  flash: string
  armed: boolean
  deleteBlockedText: string
  hasInitialBalanceEntries: boolean
  /** 資産・負債科目の登録時の設定。それ以外(収益・費用・資本・グループ)はnull */
  registration: AccountRegistrationSummary | null
  definitions: readonly ImportMappingDefinition[]
  onLinkDefinition: (definitionId: number) => void
  onUnlinkDefinition: (definitionId: number) => void
  onMoveInto: (targetId: string) => void
  onShift: (delta: -1 | 1) => void
  onSave: (patch: { name: string; householdMemberId?: number | null }) => Promise<boolean>
  onToggleActive: () => void
  onAddSubgroup: () => void
  onAddAccount: () => void
  onDelete: () => void
}

/** 選んだグループ・科目の右パネル。名称・名義は下書きを持ち、「保存」で確定する */
function EditPanel(props: EditPanelProps) {
  const { node, account, nodes, members, busy } = props
  const { t } = useTranslation('master')
  const isGroup = node.kind === 'group'
  const isSystem = account?.isSystemManaged === true
  const [name, setName] = useState(node.name)
  const [memberInput, setMemberInput] = useState(account?.householdMemberId?.toString() ?? '')
  const memberEditable = !isGroup && account !== undefined && !isSystem
  const buildPatch = () => ({
    name: name.trim(),
    ...(memberEditable ? { householdMemberId: memberInput === '' ? null : Number(memberInput) } : {}),
  })
  // 名称・名義が保存済みの値と違う間は、画面を離れる前に確認する。所属グループ・並び順・有効/無効・
  // 明細マッピングの紐づけは選んだ時点で即時に反映されるため、対象外(計画Issue #190)
  const unsavedDialog = useUnsavedEditGuard({
    dirty:
      name.trim() !== node.name ||
      (memberEditable && memberInput !== (account?.householdMemberId?.toString() ?? '')),
    save: () => (name.trim() === '' ? Promise.resolve(false) : props.onSave(buildPatch())),
  })
  const siblings = nodes.filter((n) => n.category === node.category && n.parentId === node.parentId)
  const index = siblings.findIndex((n) => n.id === node.id)
  const options = parentOptions(nodes, node.category, new Set(isGroup ? withDescendants(nodes, node.id) : []))
  const blocked = props.deleteBlockedText !== ''
  const title = t(isGroup ? 'accountTab.editGroup' : 'accountTab.editAccount')

  return (
    <section className="master-panel" aria-label={title}>
      <h2 className="master-panel__title">{title}</h2>

      <div className="master-field">
        <label className="master-field__label" htmlFor="master-edit-name">
          {t('accountTab.name')}
        </label>
        <input
          id="master-edit-name"
          className="master-field__control"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="master-field">
        <span className="master-field__label">{t('accountTab.categoryFixed')}</span>
        <span>{props.categoryName}</span>
      </div>

      <div className="master-field">
        <label className="master-field__label" htmlFor="master-edit-parent">
          {t(isGroup ? 'accountTab.parentGroup' : 'accountTab.group')}
        </label>
        <select
          id="master-edit-parent"
          className="master-field__control"
          value={node.parentId ?? `${CATEGORY_ID_PREFIX}${node.category}`}
          disabled={busy}
          onChange={(event) => props.onMoveInto(event.target.value)}
        >
          <option value={`${CATEGORY_ID_PREFIX}${node.category}`}>
            {t(isGroup ? 'accountTab.top' : 'accountTab.groupNone')}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="master-actions">
        <span className="master-field__label">{t('accountTab.order')}</span>
        <button type="button" className="master-btn" disabled={busy || index <= 0} onClick={() => props.onShift(-1)}>
          {t('accountTab.up')}
        </button>
        <button
          type="button"
          className="master-btn"
          disabled={busy || index >= siblings.length - 1}
          onClick={() => props.onShift(1)}
        >
          {t('accountTab.down')}
        </button>
      </div>

      {isSystem && <p className="master-note">{t('accountTab.systemNote')}</p>}

      {!isGroup && account && !isSystem && (
        <div className="master-field">
          <label className="master-field__label" htmlFor="master-edit-member">
            {t('accountTab.member')}
          </label>
          <select
            id="master-edit-member"
            className="master-field__control"
            value={memberInput}
            onChange={(event) => setMemberInput(event.target.value)}
          >
            <option value="">{t('accountTab.memberAll')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {isGroup && (
        <div className="master-actions">
          <button type="button" className="master-btn" disabled={busy} onClick={props.onAddSubgroup}>
            {t('accountTab.addSubgroup')}
          </button>
          {node.category !== 'equity' && (
            <button type="button" className="master-btn" disabled={busy} onClick={props.onAddAccount}>
              {t('accountTab.addAccount')}
            </button>
          )}
        </div>
      )}

      {account && props.registration && (
        <>
          <AccountRegistrationInfo summary={props.registration} />
          {/* 取込先になれるのは外部明細がある科目だけなので、紐づけも外部明細ありの科目にだけ出す */}
          {props.registration.hasExternalStatement && (
            <AccountMappingSection
              accountId={account.id}
              definitions={props.definitions}
              busy={busy}
              onLink={props.onLinkDefinition}
              onUnlink={props.onUnlinkDefinition}
            />
          )}
        </>
      )}

      <div className="master-actions">
        <button
          type="button"
          className="master-btn master-btn--primary"
          disabled={busy || name.trim() === ''}
          onClick={() => void props.onSave(buildPatch())}
        >
          {t('accountTab.save')}
        </button>
        {!isSystem && (
          <button
            type="button"
            className={`master-btn${props.armed ? ' master-btn--danger' : ''}`}
            disabled={busy || blocked}
            onClick={props.onDelete}
          >
            {props.armed ? t('accountTab.deleteConfirm') : t(isGroup ? 'accountTab.deleteGroup' : 'accountTab.delete')}
          </button>
        )}
        {account && !isSystem && (
          <button type="button" className="master-btn" disabled={busy} onClick={props.onToggleActive}>
            {t(account.isActive ? 'accountTab.deactivate' : 'accountTab.activate')}
          </button>
        )}
        <span role="status" className="master-flash">
          {props.flash}
        </span>
      </div>

      {blocked && <p className="master-note">{props.deleteBlockedText}</p>}
      {props.armed && props.hasInitialBalanceEntries && (
        <p className="master-note">{t('accountTab.deleteInitialBalanceNote')}</p>
      )}
      {unsavedDialog}
    </section>
  )
}
