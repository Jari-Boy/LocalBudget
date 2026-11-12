import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Account } from '../../domain/account/Account'
import type { AccountRepository } from '../../domain/account/AccountRepository'
import type { AccountGroup } from '../../domain/account-group/AccountGroup'
import type { AccountGroupRepository } from '../../domain/account-group/AccountGroupRepository'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { CounterpartyRepository } from '../../domain/counterparty/CounterpartyRepository'
import type { CounterpartyGroup } from '../../domain/counterparty-group/CounterpartyGroup'
import type { CounterpartyGroupRepository } from '../../domain/counterparty-group/CounterpartyGroupRepository'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { HouseholdMemberRepository } from '../../domain/household-member/HouseholdMemberRepository'
import { listDeletionBlocks, type MasterUsageCount } from '../../domain/master/summarizeMasterUsage'
import type { Project } from '../../domain/project/Project'
import type { ProjectRepository } from '../../domain/project/ProjectRepository'
import type { ProjectGroup } from '../../domain/project-group/ProjectGroup'
import type { ProjectGroupRepository } from '../../domain/project-group/ProjectGroupRepository'
import { scheduleAmountsForRound } from '../../domain/recurring-transaction/recurringAmountSchedule'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import type { SettlementBatchRepository } from '../../domain/settlement-batch/SettlementBatchRepository'
import { isRecurringRuleEnded } from '../../domain/recurring-transaction/isRecurringRuleEnded'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import {
  describeRecurringSchedule,
  describeRecurringScheduleNotes,
} from '../recurring-transaction-management/describeRecurringSchedule'
import { buildTreeSelectCategories } from './buildTreeSelectCategories'
import { describeDeletionBlocks } from './describeDeletionBlocks'
import { buildAccountTree, buildCounterpartyTree, buildProjectTree } from './masterTreeNodes'
import type { MaybeAsync } from './maybeAsync'
import { nextRuleDate } from './nextRuleDate'
import {
  buildRuleInput,
  emptyRuleForm,
  ruleFormFromRule,
} from './recurringRuleForm'
import { QuickCreateDialog } from '../statement-import/QuickCreateDialog'
import { RuleEditForm, type RuleStatus } from './RuleEditForm'
import '../journal-entry/JournalEntryEditor.css'
import './master.css'

export interface RuleMasterTabProps {
  recurringTransactionRuleRepository: MaybeAsync<
    Pick<
      RecurringTransactionRuleRepository,
      | 'findAll'
      | 'create'
      | 'update'
      | 'delete'
      | 'deactivate'
      | 'activate'
      | 'countGeneratedJournalEntries'
    >
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll' | 'create'>>
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll' | 'create'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  /** 行の精算バッチの選択肢(計画Issue #180)。省略時は選択肢なし */
  settlementBatchRepository?: MaybeAsync<Pick<SettlementBatchRepository, 'findAll' | 'create'>>
  /** 「次回」・終了の判定・再開日の既定・開始日の既定の基準日(YYYY-MM-DD)。省略時は今日 */
  today?: string
}

interface LoadedData {
  rules: RecurringTransactionRule[]
  generatedCounts: Map<number, number>
  accounts: Account[]
  accountGroups: AccountGroup[]
  counterparties: Counterparty[]
  counterpartyGroups: CounterpartyGroup[]
  projects: Project[]
  projectGroups: ProjectGroup[]
  members: HouseholdMember[]
  batches: SettlementBatch[]
}

/** 'create'は作成フォーム、数値は該当ルールの編集フォーム */
type PanelMode = 'create' | number | null



/**
 * 一覧の金額の欄(計画Issue #180)。借方の合計。金額の初期値が金額表のルールは、次の回(生成済みの件数+1回目。
 * 最後の回まで生成済みなら最後の回)の借方の合計
 */
function listAmountOf(rule: RecurringTransactionRule, generatedCount: number): number {
  const amounts =
    rule.amountMode === 'schedule'
      ? scheduleAmountsForRound(rule.schedule, Math.min(generatedCount + 1, rule.schedule.length))
      : null
  return rule.lines
    .filter((l) => l.side === 'debit')
    .reduce((total, l) => total + (amounts?.get(l.lineNo) ?? l.amount), 0)
}

const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`
const slashDate = (date: string) => date.replaceAll('-', '/')

function statusOf(rule: RecurringTransactionRule, generatedCount: number, today: string): RuleStatus {
  if (isRecurringRuleEnded(rule, generatedCount, today)) return 'ended'
  return rule.isActive ? 'active' : 'inactive'
}

/** 終了した理由。終了日の経過を優先し、なければ回数の上限への到達 */
function describeEnded(rule: RecurringTransactionRule, today: string, t: TFunction<'master'>): string {
  if (rule.endsOn !== null && today > rule.endsOn) return t('ruleTab.endedByDate', { date: slashDate(rule.endsOn) })
  return t('ruleTab.endedByCount', { times: rule.maxOccurrences ?? 0 })
}

/**
 * マスタ画面の「定期仕訳」タブ(計画Issue #154、#164)。ルールの一覧(名称・繰り返し・金額・次回・状態。
 * 科目は出さない)と、右パネルの作成・編集フォームを持つ。右パネルは仕訳エディタ(JournalEntryEditor)と
 * 同じ見た目の借方・貸方の2列に、スケジュール(間隔・開始日・終了日・土日の調整・回数の上限)と金額の初期値を
 * 加えたもので、繰り返し(毎週・毎月の日付または第N曜日・毎年)に応じて入力欄が切り替わり、これからの期日を
 * プレビューする。無効化と、無効なルールの再有効化(再開日を選ぶ。終了したルールは対象外)、生成済みの仕訳が
 * 無いルールの2回押しの削除ができ、生成済みの仕訳があるルールは削除できず理由を表示する。
 */
export function RuleMasterTab(props: RuleMasterTabProps) {
  const { t } = useTranslation('master')
  const { t: tRule } = useTranslation('recurringTransaction')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [mode, setMode] = useState<PanelMode>(null)
  const [armed, setArmed] = useState(false)
  /** 操作の失敗。右パネルの操作ボタンの直上に出す。reasonは失敗の原因(例外のメッセージ) */
  const [error, setError] = useState<{ message: string; reason: string } | null>(null)
  const [busy, setBusy] = useState(false)
  /** 行の取引先・プロジェクトをその場で追加するダイアログ(選択ツリーの「+ 新規追加」、計画Issue #180) */
  const [counterpartyDialog, setCounterpartyDialog] = useState<{ apply: (id: number) => void } | null>(null)
  const [projectDialog, setProjectDialog] = useState<{ apply: (id: number) => void } | null>(null)

  const {
    recurringTransactionRuleRepository: ruleRepo,
    accountRepository,
    accountGroupRepository,
    counterpartyRepository,
    counterpartyGroupRepository,
    projectRepository,
    projectGroupRepository,
    householdMemberRepository,
    settlementBatchRepository,
  } = props
  const today = props.today ?? new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    const [rules, accounts, accountGroups, counterparties, counterpartyGroups, projects, projectGroups, members, batches] =
      await Promise.all([
        ruleRepo.findAll(),
        accountRepository.findAll(),
        accountGroupRepository.findAll(),
        counterpartyRepository.findAll(),
        counterpartyGroupRepository.findAll(),
        projectRepository.findAll(),
        projectGroupRepository.findAll(),
        householdMemberRepository.findAll(),
        settlementBatchRepository === undefined ? [] : settlementBatchRepository.findAll(),
      ])
    const counts = await Promise.all(rules.map((r) => ruleRepo.countGeneratedJournalEntries(r.id)))
    setData({
      rules,
      generatedCounts: new Map(rules.map((r, i) => [r.id, counts[i]])),
      accounts,
      accountGroups,
      counterparties,
      counterpartyGroups,
      projects,
      projectGroups,
      members,
      batches,
    })
  }, [
    ruleRepo,
    accountRepository,
    accountGroupRepository,
    counterpartyRepository,
    counterpartyGroupRepository,
    projectRepository,
    projectGroupRepository,
    householdMemberRepository,
    settlementBatchRepository,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const pickers = useMemo(() => {
    if (!data) return null
    const accountTree = buildAccountTree({ groups: data.accountGroups, accounts: data.accounts, memberNameById: new Map() })
    const counterpartyTree = buildCounterpartyTree({
      groups: data.counterpartyGroups,
      counterparties: data.counterparties,
      accountNameById: new Map(),
      patternCountById: new Map(),
    })
    const projectTree = buildProjectTree({ groups: data.projectGroups, projects: data.projects })
    const inactive = (items: ReadonlyArray<{ id: number; isActive: boolean }>) =>
      new Set(items.filter((i) => !i.isActive).map((i) => i.id))
    return {
      accounts: buildTreeSelectCategories(accountTree, inactive(data.accounts)).filter((c) => c.key !== 'equity'),
      counterparties: buildTreeSelectCategories(counterpartyTree, inactive(data.counterparties)),
      projects: buildTreeSelectCategories(projectTree, inactive(data.projects)),
    }
  }, [data])

  if (data === null || pickers === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const run = async (action: () => unknown, errorMessage: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError({ message: errorMessage, reason: err instanceof Error ? err.message : '' })
    } finally {
      setBusy(false)
    }
  }

  const selectedRule = typeof mode === 'number' ? data.rules.find((r) => r.id === mode) : undefined
  const generated = selectedRule ? (data.generatedCounts.get(selectedRule.id) ?? 0) : 0
  const generatedUsage = { generatedEntries: generated } as MasterUsageCount

  return (
    <div className="master-split master-split--rule">
      <div className="master-split__main">
        <div className="master-actions">
          <button
            type="button"
            className="master-btn master-btn--primary"
            onClick={() => {
              setMode('create')
              setArmed(false)
              setError(null)
            }}
          >
            {t('ruleTab.add')}
          </button>
        </div>
        <div className="master-table-wrap">
          <table className="master-table">
            <thead>
              <tr>
                <th>{t('ruleTab.colName')}</th>
                <th>{t('ruleTab.colRepeat')}</th>
                <th>{t('ruleTab.colAmount')}</th>
                <th>{t('ruleTab.colNext')}</th>
                <th>{t('ruleTab.colState')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rules.map((rule) => {
                const count = data.generatedCounts.get(rule.id) ?? 0
                const next = nextRuleDate(rule, today, count)
                const status = statusOf(rule, count, today)
                return (
                  <tr key={rule.id} className={rule.id === mode ? 'master-table__row--selected' : undefined}>
                    <td className="master-table__nowrap">
                      <button
                        type="button"
                        className="master-link"
                        aria-current={rule.id === mode ? 'true' : undefined}
                        onClick={() => {
                          setMode(rule.id)
                          setArmed(false)
                          setError(null)
                        }}
                      >
                        {rule.name}
                      </button>
                    </td>
                    <td>
                      {describeRecurringSchedule(rule, tRule)}
                      {describeRecurringScheduleNotes(rule, tRule).map((note) => (
                        <p key={note} className="master-note">
                          {note}
                        </p>
                      ))}
                    </td>
                    <td className="master-table__nowrap">
                      {yen(listAmountOf(rule, data.generatedCounts.get(rule.id) ?? 0))}
                      {rule.amountMode === 'last_confirmed' && <p className="master-note">{t('ruleTab.lastConfirmed')}</p>}
                      {rule.amountMode === 'schedule' && (
                        <p className="master-note">
                          {t('ruleTab.scheduleProgress', {
                            n: Math.min((data.generatedCounts.get(rule.id) ?? 0) + 1, rule.schedule.length),
                            total: rule.schedule.length,
                          })}
                        </p>
                      )}
                    </td>
                    <td className="master-table__nowrap">{next === null ? '-' : slashDate(next)}</td>
                    <td className="master-table__nowrap">
                      {status === 'ended' ? (
                        <span className="master-state--ended">{t('ruleTab.stateEnded')}</span>
                      ) : status === 'active' ? (
                        t('ruleTab.active')
                      ) : (
                        t('ruleTab.inactive')
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {mode !== null && (mode === 'create' || selectedRule) && (
        <RuleEditForm
          key={mode === 'create' ? 'create' : selectedRule!.id}
          initial={selectedRule ? ruleFormFromRule(selectedRule) : emptyRuleForm(today)}
          isCreate={mode === 'create'}
          status={selectedRule ? statusOf(selectedRule, generated, today) : 'active'}
          endedReason={selectedRule ? describeEnded(selectedRule, today, t) : ''}
          today={today}
          generatedCount={generated}
          accountCategories={pickers.accounts}
          counterpartyCategories={pickers.counterparties}
          projectCategories={pickers.projects}
          members={data.members}
          accounts={data.accounts}
          batches={data.batches}
          onCreateBatch={
            settlementBatchRepository === undefined
              ? undefined
              : async (name) => {
                  const created = await settlementBatchRepository.create({ name, type: 'expense_splitting' })
                  setData((prev) => (prev === null ? prev : { ...prev, batches: [...prev.batches, created] }))
                  return created
                }
          }
          onRequestCreateCounterparty={(apply) => setCounterpartyDialog({ apply })}
          onRequestCreateProject={(apply) => setProjectDialog({ apply })}
          error={error}
          busy={busy}
          armed={armed}
          blockedText={describeDeletionBlocks(listDeletionBlocks('recurringRule', generatedUsage), t)}
          onSubmit={(form) =>
            run(async () => {
              if (selectedRule) {
                await ruleRepo.update(selectedRule.id, buildRuleInput(form))
              } else {
                const created = await ruleRepo.create(buildRuleInput(form))
                setMode(created.id)
              }
            }, t(selectedRule ? 'accountTab.saveError' : 'ruleTab.registerError'))
          }
          onCancel={() => setMode(null)}
          onDeactivate={() => selectedRule && run(() => ruleRepo.deactivate(selectedRule.id), t('accountTab.toggleError'))}
          onActivate={(resumedOn) =>
            selectedRule && run(() => ruleRepo.activate(selectedRule.id, resumedOn, today), t('ruleTab.activateError'))
          }
          onDelete={() => {
            if (!selectedRule) return
            if (!armed) {
              setArmed(true)
              return
            }
            void run(async () => {
              await ruleRepo.delete(selectedRule.id)
              setMode(null)
              setArmed(false)
            }, t('accountTab.deleteError'))
          }}
        />
      )}
      {counterpartyDialog && (
        <QuickCreateDialog
          title="取引先を追加"
          nameLabel="取引先名"
          onSubmit={async (name) => {
            const created = await counterpartyRepository.create({ name })
            setData((prev) => (prev === null ? prev : { ...prev, counterparties: [...prev.counterparties, created] }))
            counterpartyDialog.apply(created.id)
            setCounterpartyDialog(null)
          }}
          onCancel={() => setCounterpartyDialog(null)}
        />
      )}
      {projectDialog && (
        <QuickCreateDialog
          title="プロジェクトを追加"
          nameLabel="プロジェクト名"
          onSubmit={async (name) => {
            const created = await projectRepository.create({ name })
            setData((prev) => (prev === null ? prev : { ...prev, projects: [...prev.projects, created] }))
            projectDialog.apply(created.id)
            setProjectDialog(null)
          }}
          onCancel={() => setProjectDialog(null)}
        />
      )}
    </div>
  )
}
