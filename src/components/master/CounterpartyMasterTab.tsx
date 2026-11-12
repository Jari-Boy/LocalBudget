import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { Counterparty, CounterpartyPattern } from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
import type { JournalEntry } from '../../domain/journal/JournalEntry'
import type { JournalEntryRepository } from '../../domain/journal/JournalEntryRepository'
import { listDeletionBlocks, summarizeMasterUsage } from '../../domain/master/summarizeMasterUsage'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import { describeDeletionBlocks } from './describeDeletionBlocks'
import { GroupedMasterTab, type GroupedMasterActions } from './GroupedMasterTab'
import { buildCounterpartyTree, parseNodeId } from './masterTreeNodes'
import type { MaybeAsync } from './maybeAsync'
import { uniqueName } from './uniqueName'
import './master.css'

export interface CounterpartyMasterTabProps {
  counterpartyRepository: MaybeAsync<
    Pick<
      CounterpartyRepository,
      | 'findAll'
      | 'create'
      | 'update'
      | 'delete'
      | 'deactivate'
      | 'activate'
      | 'addPattern'
      | 'updatePattern'
      | 'deletePattern'
      | 'findPatternsByCounterparty'
      | 'merge'
    >
  >
  counterpartyGroupRepository: MaybeAsync<
    Pick<CounterpartyGroupRepository, 'findAll' | 'create' | 'update' | 'delete'>
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  journalEntryRepository: MaybeAsync<Pick<JournalEntryRepository, 'findAll'>>
  recurringTransactionRuleRepository: MaybeAsync<Pick<RecurringTransactionRuleRepository, 'findAll'>>
  settlementBatchRepository: MaybeAsync<Pick<SettlementBatchRepository, 'findAll'>>
}

interface LoadedData {
  counterparties: Counterparty[]
  groups: CounterpartyGroup[]
  accounts: Account[]
  entries: JournalEntry[]
  rules: RecurringTransactionRule[]
  batches: SettlementBatch[]
  patternsById: Map<number, CounterpartyPattern[]>
}

const LEAF_LABEL = '取引先'

/**
 * マスタ画面の「取引先」タブ(計画Issue #154)。グループと取引先をツリー表で表示し、右パネルで
 * 編集する(共通の画面はGroupedMasterTab)。取引先に固有の機能として、既定の科目の選択、
 * 登録済みパターンの追加・編集・削除、チェックした取引先の統合(いずれも現行の取引先管理画面から
 * 引き継ぐ)を持つ。仕訳・定期仕訳ルール・精算バッチの相手で使用中の取引先は削除できず、
 * 理由を表示する。パターンの削除は現行どおり確認なしで行う。
 */
export function CounterpartyMasterTab({
  counterpartyRepository,
  counterpartyGroupRepository,
  accountRepository,
  journalEntryRepository,
  recurringTransactionRuleRepository,
  settlementBatchRepository,
}: CounterpartyMasterTabProps) {
  const { t } = useTranslation('master')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [mergeResult, setMergeResult] = useState('')

  const load = useCallback(async () => {
    const [counterparties, groups, accounts, entries, rules, batches] = await Promise.all([
      counterpartyRepository.findAll(),
      counterpartyGroupRepository.findAll(),
      accountRepository.findAll(),
      journalEntryRepository.findAll(),
      recurringTransactionRuleRepository.findAll(),
      settlementBatchRepository.findAll(),
    ])
    const patternLists = await Promise.all(
      counterparties.map((c) => counterpartyRepository.findPatternsByCounterparty(c.id)),
    )
    setData({
      counterparties,
      groups,
      accounts,
      entries,
      rules,
      batches,
      patternsById: new Map(counterparties.map((c, i) => [c.id, patternLists[i]])),
    })
  }, [
    counterpartyRepository,
    counterpartyGroupRepository,
    accountRepository,
    journalEntryRepository,
    recurringTransactionRuleRepository,
    settlementBatchRepository,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const tree = useMemo(
    () =>
      data
        ? buildCounterpartyTree({
            groups: data.groups,
            counterparties: data.counterparties,
            accountNameById: new Map(data.accounts.map((a) => [a.id, a.name])),
            patternCountById: new Map([...data.patternsById].map(([id, list]) => [id, list.length])),
          })
        : null,
    [data],
  )
  const usage = useMemo(
    () =>
      data
        ? summarizeMasterUsage({
            entries: data.entries,
            budgets: [],
            rules: data.rules,
            settlementBatches: data.batches,
            accounts: [],
          })
        : null,
    [data],
  )

  if (data === null || tree === null || usage === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const actions: GroupedMasterActions = {
    applyUpdate: async (update) => {
      const { kind, id } = parseNodeId(update.id)
      const parentId = update.parentId === null ? null : parseNodeId(update.parentId).id
      if (kind === 'group') {
        await counterpartyGroupRepository.update(id, { parentGroupId: parentId, sortOrder: update.sortOrder })
      } else {
        await counterpartyRepository.update(id, { counterpartyGroupId: parentId, sortOrder: update.sortOrder })
      }
    },
    createGroup: async (parentGroupId) =>
      (
        await counterpartyGroupRepository.create({
          name: uniqueName(t('accountTab.newGroupName'), data.groups.map((g) => g.name)),
          parentGroupId,
        })
      ).id,
    createLeaf: async (counterpartyGroupId) =>
      (
        await counterpartyRepository.create({
          name: uniqueName(t('groupedTab.newLeafName', { leaf: LEAF_LABEL }), data.counterparties.map((c) => c.name)),
          counterpartyGroupId,
        })
      ).id,
    rename: async (nodeId, name) => {
      const { kind, id } = parseNodeId(nodeId)
      if (kind === 'group') await counterpartyGroupRepository.update(id, { name })
      else await counterpartyRepository.update(id, { name })
    },
    setLeafActive: async (id, active) => {
      if (active) await counterpartyRepository.activate(id)
      else await counterpartyRepository.deactivate(id)
    },
    remove: async (nodeId) => {
      const { kind, id } = parseNodeId(nodeId)
      if (kind === 'group') await counterpartyGroupRepository.delete(id)
      else await counterpartyRepository.delete(id)
    },
  }

  return (
    <GroupedMasterTab
      tree={tree}
      columns={['既定の科目', '状態']}
      leafLabel={LEAF_LABEL}
      actions={actions}
      isLeafActive={(id) => data.counterparties.find((c) => c.id === id)?.isActive ?? true}
      leafBlockedText={(id) =>
        describeDeletionBlocks(listDeletionBlocks('counterparty', usage.get('counterparty', id)), t)
      }
      onChanged={load}
      renderLeafExtra={(id, { reload, busy }) => {
        const counterparty = data.counterparties.find((c) => c.id === id)
        if (!counterparty) return null
        return (
          <CounterpartyExtra
            counterparty={counterparty}
            accounts={data.accounts}
            patterns={data.patternsById.get(id) ?? []}
            repository={counterpartyRepository}
            reload={reload}
            busy={busy}
          />
        )
      }}
      renderSelection={(checkedIds, { reload }) => (
        <>
          {mergeResult !== '' && (
            <p role="status" className="master-flash">
              {mergeResult}
            </p>
          )}
          <MergePanel
            counterparties={data.counterparties.filter((c) => checkedIds.includes(c.id))}
            repository={counterpartyRepository}
            onMerged={async (message) => {
              setMergeResult(message)
              await reload()
            }}
          />
        </>
      )}
    />
  )
}

interface CounterpartyExtraProps {
  counterparty: Counterparty
  accounts: readonly Account[]
  patterns: readonly CounterpartyPattern[]
  repository: CounterpartyMasterTabProps['counterpartyRepository']
  reload: () => Promise<void>
  busy: boolean
}

/** 取引先の右パネルに足す欄: 既定の科目(選ぶとすぐ保存)と、登録済みパターンの管理 */
function CounterpartyExtra({ counterparty, accounts, patterns, repository, reload, busy }: CounterpartyExtraProps) {
  const { t } = useTranslation('master')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [newPattern, setNewPattern] = useState('')
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  const options = accounts.filter(
    (a) =>
      (a.category === 'expense' || a.category === 'revenue') && (a.isActive || a.id === counterparty.defaultAccountId),
  )
  const trimmedNew = newPattern.trim()
  const trimmedEdit = editDraft.trim()

  const run = async (action: () => unknown) => {
    setWorking(true)
    setError('')
    try {
      await action()
      await reload()
    } catch {
      setError(t('counterpartyTab.patternError'))
    } finally {
      setWorking(false)
    }
  }
  const disabled = busy || working

  return (
    <>
      <div className="master-field">
        <label className="master-field__label" htmlFor="counterparty-default-account">
          {t('counterpartyTab.defaultAccount')}
        </label>
        <select
          id="counterparty-default-account"
          className="master-field__control"
          disabled={disabled}
          value={counterparty.defaultAccountId === null ? '' : String(counterparty.defaultAccountId)}
          onChange={(event) =>
            void run(() =>
              repository.update(counterparty.id, {
                defaultAccountId: event.target.value === '' ? null : Number(event.target.value),
              }),
            )
          }
        >
          <option value="">{t('counterpartyTab.defaultAccountNone')}</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <section className="master-subsection" aria-label={t('counterpartyTab.patternsTitle', { count: patterns.length })}>
        <h3 className="master-subsection__title">{t('counterpartyTab.patternsTitle', { count: patterns.length })}</h3>
        <p className="master-note">{t('counterpartyTab.patternsNote')}</p>
        {patterns.length === 0 && <p className="master-note">{t('counterpartyTab.patternsEmpty')}</p>}
        <ul className="master-list">
          {patterns.map((p) =>
            editingId === p.id ? (
              <li key={p.id} className="master-list__item">
                <input
                  className="master-field__control"
                  aria-label={t('counterpartyTab.patternInput')}
                  value={editDraft}
                  onChange={(event) => setEditDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="master-btn master-btn--primary"
                  disabled={disabled || trimmedEdit === ''}
                  onClick={() =>
                    void run(async () => {
                      await repository.updatePattern(p.id, trimmedEdit)
                      setEditingId(null)
                    })
                  }
                >
                  {t('counterpartyTab.patternSave')}
                </button>
                <button type="button" className="master-btn" onClick={() => setEditingId(null)}>
                  {t('counterpartyTab.patternCancel')}
                </button>
              </li>
            ) : (
              <li key={p.id} className="master-list__item">
                <span className="master-list__text">{p.pattern}</span>
                <button
                  type="button"
                  className="master-btn"
                  disabled={disabled}
                  aria-label={t('counterpartyTab.patternEditLabel', { pattern: p.pattern })}
                  onClick={() => {
                    setEditingId(p.id)
                    setEditDraft(p.pattern)
                  }}
                >
                  {t('counterpartyTab.patternEdit')}
                </button>
                <button
                  type="button"
                  className="master-btn"
                  disabled={disabled}
                  aria-label={t('counterpartyTab.patternDeleteLabel', { pattern: p.pattern })}
                  onClick={() => void run(() => repository.deletePattern(p.id))}
                >
                  {t('counterpartyTab.patternDelete')}
                </button>
              </li>
            ),
          )}
        </ul>
        <div className="master-list__item">
          <input
            className="master-field__control"
            aria-label={t('counterpartyTab.patternNewInput')}
            placeholder={t('counterpartyTab.patternPlaceholder')}
            value={newPattern}
            onChange={(event) => setNewPattern(event.target.value)}
          />
          <button
            type="button"
            className="master-btn"
            disabled={disabled || trimmedNew === '' || patterns.some((p) => p.pattern === trimmedNew)}
            onClick={() =>
              void run(async () => {
                await repository.addPattern(counterparty.id, trimmedNew)
                setNewPattern('')
              })
            }
          >
            {t('counterpartyTab.patternAdd')}
          </button>
        </div>
        {error && (
          <p role="alert" className="master-error">
            {error}
          </p>
        )}
      </section>
    </>
  )
}

interface MergePanelProps {
  counterparties: readonly Counterparty[]
  repository: CounterpartyMasterTabProps['counterpartyRepository']
  onMerged: (message: string) => Promise<void>
}

/** チェックした取引先(2件以上)を1つに統合する。統合先を選び、確認を経て実行する(現行画面と同じ流れ) */
function MergePanel({ counterparties, repository, onMerged }: MergePanelProps) {
  const { t } = useTranslation('master')
  const [targetId, setTargetId] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  if (counterparties.length < 2) return null
  const target = counterparties.find((c) => String(c.id) === targetId)
  const sources = counterparties.filter((c) => c.id !== target?.id)

  const execute = async () => {
    if (!target) return
    setWorking(true)
    setError('')
    try {
      await repository.merge(target.id, sources.map((s) => s.id))
      setConfirming(false)
      setTargetId('')
      await onMerged(
        t('counterpartyTab.mergeDone', { sources: sources.map((s) => s.name).join('、'), target: target.name }),
      )
    } catch {
      setConfirming(false)
      setError(t('counterpartyTab.mergeError'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="master-panel" aria-label={t('counterpartyTab.mergeRegion')}>
      <h2 className="master-panel__title">{t('counterpartyTab.mergeTitle', { count: counterparties.length })}</h2>
      <div className="master-field">
        <label className="master-field__label" htmlFor="counterparty-merge-target">
          {t('counterpartyTab.mergeTarget')}
        </label>
        <select
          id="counterparty-merge-target"
          className="master-field__control"
          value={targetId}
          onChange={(event) => {
            setTargetId(event.target.value)
            setConfirming(false)
          }}
        >
          <option value="">{t('counterpartyTab.mergeChoose')}</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {confirming && target ? (
        <>
          <p className="master-note">
            {t('counterpartyTab.mergeConfirm', { sources: sources.map((s) => s.name).join('、'), target: target.name })}
          </p>
          <div className="master-actions">
            <button type="button" className="master-btn master-btn--danger" disabled={working} onClick={() => void execute()}>
              {t('counterpartyTab.mergeRun')}
            </button>
            <button type="button" className="master-btn" onClick={() => setConfirming(false)}>
              {t('counterpartyTab.patternCancel')}
            </button>
          </div>
        </>
      ) : (
        <div className="master-actions">
          <button type="button" className="master-btn" disabled={!target} onClick={() => setConfirming(true)}>
            {t('counterpartyTab.mergeStart')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="master-error">
          {error}
        </p>
      )}
    </section>
  )
}
