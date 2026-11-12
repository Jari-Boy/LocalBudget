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
import { previewUpcomingDueDates } from '../../domain/recurring-transaction/previewUpcomingDueDates'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { JournalLinesEditor } from '../journal-entry/JournalLinesEditor'
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
  isRuleFormValid,
  isScheduleFormValid,
  ruleFormFromRule,
  ruleFromForm,
  type RuleForm,
} from './recurringRuleForm'
import { RuleAmountSchedulePanel } from './RuleAmountSchedulePanel'
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
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll'>>
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  /** 行の精算バッチの選択肢(計画Issue #180)。省略時は選択肢なし */
  settlementBatchRepository?: MaybeAsync<Pick<SettlementBatchRepository, 'findAll'>>
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

/** 終了は、is_activeとは独立した状態(終了日の経過・回数の上限への到達)。無効より終了を優先して表示する */
type RuleStatus = 'active' | 'inactive' | 'ended'

const WEEKDAY_VALUES = [0, 1, 2, 3, 4, 5, 6]
const WEEK_VALUES: ReadonlyArray<{ value: number; key: string }> = [
  { value: 1, key: 'weekOption1' },
  { value: 2, key: 'weekOption2' },
  { value: 3, key: 'weekOption3' },
  { value: 4, key: 'weekOption4' },
  { value: 5, key: 'weekOption5' },
  { value: -1, key: 'weekOptionLast' },
]
const WEEKDAY_KEYS = ['dayOfWeekSun', 'dayOfWeekMon', 'dayOfWeekTue', 'dayOfWeekWed', 'dayOfWeekThu', 'dayOfWeekFri', 'dayOfWeekSat']
const INTERVAL_UNIT_KEYS = { weekly: 'ruleTab.unitWeekly', monthly: 'ruleTab.unitMonthly', yearly: 'ruleTab.unitYearly' } as const

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
 * マスタ画面の「定期取引」タブ(計画Issue #154、#164)。ルールの一覧(名称・繰り返し・金額・次回・状態。
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
        <RuleForm
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
    </div>
  )
}

interface RuleFormProps {
  initial: RuleForm
  isCreate: boolean
  /** 保存済みのルールの状態。作成フォームでは常にactive(状態の案内は出さない) */
  status: RuleStatus
  endedReason: string
  today: string
  /** 保存済みのルールの生成済み件数。プレビューの回数の上限の残りの計算に使う */
  generatedCount: number
  accountCategories: ReturnType<typeof buildTreeSelectCategories>
  counterpartyCategories: ReturnType<typeof buildTreeSelectCategories>
  projectCategories: ReturnType<typeof buildTreeSelectCategories>
  members: readonly HouseholdMember[]
  accounts: readonly Account[]
  batches: readonly SettlementBatch[]
  /** 直前の操作の失敗。操作ボタンの直上に表示する */
  error: { message: string; reason: string } | null
  busy: boolean
  armed: boolean
  blockedText: string
  onSubmit: (form: RuleForm) => unknown
  onCancel: () => void
  onDeactivate: () => unknown
  onActivate: (resumedOn: string) => unknown
  onDelete: () => void
}

/**
 * 定期仕訳ルールの作成・編集フォーム(右パネル)。入力は下書きとして持ち、保存・登録で確定する。
 * 借方・貸方の行の部分は、仕訳の起票と同じ行編集の共通部品(JournalLinesEditor、計画Issue #180)で、
 * 3行以上の複合仕訳・精算バッチ・行ごとの世帯メンバーも編集できる。金額の初期値が「回ごとの金額表」のときは、
 * 行の金額ではなく金額表(RuleAmountSchedulePanel)で金額を決める。
 */
function RuleForm(props: RuleFormProps) {
  const { t } = useTranslation('master')
  const { t: tRule } = useTranslation('recurringTransaction')
  const [form, setForm] = useState<RuleForm>(props.initial)
  const [resuming, setResuming] = useState(false)
  const [resumedOn, setResumedOn] = useState(props.today)
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const num = (value: string): number | '' => (value === '' ? '' : Number(value))
  const title = t(props.isCreate ? 'ruleTab.createTitle' : 'ruleTab.editTitle')
  const valid = isRuleFormValid(form)
  const monthly = form.frequency === 'monthly'
  const byWeekday = monthly && form.monthlyMode === 'weekday'
  const showDay = form.frequency === 'yearly' || (monthly && !byWeekday)
  const showWeekday = form.frequency === 'weekly' || byWeekday
  const master = useMemo(
    () => ({
      accounts: props.accounts,
      accountCategories: props.accountCategories,
      counterpartyCategories: props.counterpartyCategories,
      projectCategories: props.projectCategories,
      members: props.members,
      batches: props.batches,
    }),
    [props.accounts, props.accountCategories, props.counterpartyCategories, props.projectCategories, props.members, props.batches],
  )
  const accountNameById = new Map(props.accounts.map((a) => [a.id, a.name]))
  /** 金額表の各回の期日(土日の調整前)。開始日から数えた回の数だけ求める。入力が揃わないときは空 */
  const scheduleDueDates = useMemo(
    () =>
      form.amountMode === 'schedule' && isScheduleFormValid(form)
        ? previewUpcomingDueDates(ruleFromForm(form), form.startsOn, Math.max(form.schedule.length, 1), 0).map((d) => d.dueDate)
        : [],
    [form],
  )

  const preview = useMemo(
    () => (isScheduleFormValid(form) ? previewUpcomingDueDates(ruleFromForm(form), props.today, 3, props.generatedCount) : null),
    [form, props.today, props.generatedCount],
  )

  const select = (id: string, label: string, value: string | number, onChange: (v: string) => void, options: ReactNodeOptions) => (
    <div className="master-field">
      <label className="master-field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="master-field__control" value={value} onChange={(event) => onChange(event.target.value)}>
        {options}
      </select>
    </div>
  )

  return (
    <section className="master-panel" aria-label={title}>
      <div className="master-panel__heading">
        <span className="master-tag">{t('ruleTab.tag')}</span>
        <h2 className="master-panel__title">{title}</h2>
      </div>

      {!props.isCreate && props.status !== 'active' && (
        <div className="master-status">
          <strong>
            {t('ruleTab.stateLabel', {
              state: props.status === 'ended' ? t('ruleTab.stateEnded') : t('ruleTab.inactive'),
            })}
          </strong>
          {props.status === 'inactive' && <span className="master-note">{t('ruleTab.inactiveNote')}</span>}
          {props.status === 'ended' && (
            <>
              <span className="master-note">{props.endedReason}</span>
              <span className="master-note">{t('ruleTab.endedHint')}</span>
            </>
          )}
        </div>
      )}

      {resuming && props.status === 'inactive' && (
        <div className="master-resume" role="group" aria-label={t('ruleTab.resumeGroup')}>
          <span className="master-resume__title">{t('ruleTab.resumeTitle')}</span>
          <div className="master-field">
            <label className="master-field__label" htmlFor="rule-resume">
              {t('ruleTab.resumeDate')}
            </label>
            <input
              id="rule-resume"
              type="date"
              className="master-field__control"
              value={resumedOn}
              onChange={(e) => setResumedOn(e.target.value)}
            />
          </div>
          <p className="master-note">{t('ruleTab.resumeHint')}</p>
          <div className="master-actions">
            <button
              type="button"
              className="master-btn master-btn--primary"
              disabled={props.busy || resumedOn === ''}
              onClick={() => {
                setResuming(false)
                void props.onActivate(resumedOn)
              }}
            >
              {t('ruleTab.resumeStart')}
            </button>
            <button type="button" className="master-btn" onClick={() => setResuming(false)}>
              {t('ruleTab.resumeCancel')}
            </button>
          </div>
        </div>
      )}

      <div className="journal-editor__head">
        <div className="journal-editor__field journal-editor__field--memo">
          <label className="journal-editor__label" htmlFor="rule-name">
            {t('ruleTab.name')}
          </label>
          <input id="rule-name" className="journal-editor__control" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="journal-editor__field journal-editor__field--bookkeeper">
          <label className="journal-editor__label" htmlFor="rule-member">
            {t('ruleTab.bookkeeper')}
          </label>
          <select
            id="rule-member"
            className="journal-editor__control"
            value={form.householdMemberId}
            onChange={(e) => set('householdMemberId', num(e.target.value))}
          >
            <option value="">{t('ruleTab.bookkeeperNone')}</option>
            {props.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="master-schedule" aria-label={t('ruleTab.schedule')}>
        <header className="journal-editor__column-head">
          <span>{t('ruleTab.schedule')}</span>
        </header>
        <div className="master-schedule__body">
          {select(
            'rule-frequency',
            t('ruleTab.frequency'),
            form.frequency,
            (v) => set('frequency', v as RuleForm['frequency']),
            <>
              <option value="weekly">{t('ruleTab.weekly')}</option>
              <option value="monthly">{t('ruleTab.monthly')}</option>
              <option value="yearly">{t('ruleTab.yearly')}</option>
            </>,
          )}
          <div className="master-field">
            <label className="master-field__label" htmlFor="rule-interval">
              {t('ruleTab.interval')}
            </label>
            <div className="master-interval">
              <input
                id="rule-interval"
                className="master-field__control"
                inputMode="numeric"
                value={form.interval}
                onChange={(e) => set('interval', e.target.value)}
              />
              <span>{t(INTERVAL_UNIT_KEYS[form.frequency])}</span>
            </div>
          </div>
          {monthly &&
            select(
              'rule-mode',
              t('ruleTab.mode'),
              form.monthlyMode,
              (v) => set('monthlyMode', v as RuleForm['monthlyMode']),
              <>
                <option value="dayOfMonth">{t('ruleTab.modeDay')}</option>
                <option value="weekday">{t('ruleTab.modeWeekday')}</option>
              </>,
            )}
          {form.frequency === 'yearly' &&
            select(
              'rule-month',
              t('ruleTab.month'),
              form.monthOfYear,
              (v) => set('monthOfYear', num(v)),
              <>
                <option value="">{t('ruleTab.choose')}</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{`${m}月`}</option>
                ))}
              </>,
            )}
          {showDay &&
            select(
              'rule-day',
              t('ruleTab.day'),
              form.dayOfMonth,
              (v) => set('dayOfMonth', num(v)),
              <>
                <option value="">{t('ruleTab.choose')}</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{`${d}日`}</option>
                ))}
              </>,
            )}
          {byWeekday &&
            select(
              'rule-week',
              t('ruleTab.week'),
              form.weekOfMonth,
              (v) => set('weekOfMonth', num(v)),
              <>
                <option value="">{t('ruleTab.choose')}</option>
                {WEEK_VALUES.map((w) => (
                  <option key={w.value} value={w.value}>
                    {t(`ruleTab.${w.key}`)}
                  </option>
                ))}
              </>,
            )}
          {showWeekday &&
            select(
              'rule-weekday',
              t('ruleTab.weekday'),
              form.dayOfWeek,
              (v) => set('dayOfWeek', num(v)),
              <>
                <option value="">{t('ruleTab.choose')}</option>
                {WEEKDAY_VALUES.map((d) => (
                  <option key={d} value={d}>{`${tRule(WEEKDAY_KEYS[d])}曜`}</option>
                ))}
              </>,
            )}
          <div className="master-field">
            <label className="master-field__label" htmlFor="rule-starts">
              {t('ruleTab.startsOn')}
            </label>
            <input
              id="rule-starts"
              type="date"
              className="master-field__control"
              value={form.startsOn}
              onChange={(e) => set('startsOn', e.target.value)}
            />
          </div>
          <div className="master-field">
            <label className="master-field__label" htmlFor="rule-ends">
              {t('ruleTab.endsOn')}
            </label>
            <input
              id="rule-ends"
              type="date"
              className="master-field__control"
              value={form.endsOn}
              onChange={(e) => set('endsOn', e.target.value)}
            />
          </div>
          <div className="master-field">
            <label className="master-field__label" htmlFor="rule-max">
              {t('ruleTab.maxOccurrences')}
            </label>
            <input
              id="rule-max"
              className="master-field__control"
              inputMode="numeric"
              value={form.maxOccurrences}
              onChange={(e) => set('maxOccurrences', e.target.value)}
            />
          </div>
          {select(
            'rule-weekend',
            t('ruleTab.weekend'),
            form.weekendAdjustment,
            (v) => set('weekendAdjustment', v as RuleForm['weekendAdjustment']),
            <>
              <option value="none">{t('ruleTab.weekendNone')}</option>
              <option value="next">{t('ruleTab.weekendNext')}</option>
              <option value="previous">{t('ruleTab.weekendPrevious')}</option>
            </>,
          )}
          {preview !== null && (
            <p className="master-preview master-schedule__wide" aria-label={t('ruleTab.previewLabel')}>
              {preview.length === 0
                ? t('ruleTab.previewEmpty')
                : `${t('ruleTab.previewTitle')}: ${preview.map((d) => slashDate(d.entryDate)).join('・')}…`}
            </p>
          )}
        </div>
      </section>

      <fieldset className="master-fieldset">
        <legend className="master-field__label">{t('ruleTab.amountModeLegend')}</legend>
        <label className="master-radio">
          <input
            type="radio"
            name="rule-amount-mode"
            checked={form.amountMode === 'fixed'}
            onChange={() => set('amountMode', 'fixed')}
          />
          {t('ruleTab.amountModeFixed')}
        </label>
        <label className="master-radio">
          <input
            type="radio"
            name="rule-amount-mode"
            checked={form.amountMode === 'last_confirmed'}
            onChange={() => set('amountMode', 'last_confirmed')}
          />
          {t('ruleTab.amountModeLast')}
        </label>
        <label className="master-radio">
          <input
            type="radio"
            name="rule-amount-mode"
            checked={form.amountMode === 'schedule'}
            onChange={() => set('amountMode', 'schedule')}
          />
          {t('ruleTab.amountModeSchedule')}
        </label>
        <p className="master-note">{t('ruleTab.amountModeHint')}</p>
      </fieldset>

      <JournalLinesEditor
        lines={form.lines}
        onChange={(lines) => set('lines', lines)}
        master={master}
        bookkeeperId={null}
        memberNoneLabel={t('ruleTab.memberFollows')}
      />

      {form.amountMode === 'schedule' && (
        <RuleAmountSchedulePanel
          lines={form.lines.map(({ line }) => ({
            side: line.side ?? 'debit',
            accountName: line.accountId === null ? '未選択' : (accountNameById.get(line.accountId) ?? '未選択'),
          }))}
          schedule={form.schedule}
          onChange={(schedule) => set('schedule', schedule)}
          confirmedRounds={props.generatedCount}
          dueDates={scheduleDueDates}
        />
      )}

      {props.error && (
        <div role="alert" className="master-error">
          <p className="master-error__message">{props.error.message}</p>
          {props.error.reason !== '' && (
            <p className="master-note">{t('ruleTab.errorReason', { reason: props.error.reason })}</p>
          )}
        </div>
      )}

      <div className="master-actions">
        <button
          type="button"
          className="master-btn master-btn--primary"
          disabled={props.busy || !valid}
          onClick={() => void props.onSubmit(form)}
        >
          {t(props.isCreate ? 'ruleTab.register' : 'accountTab.save')}
        </button>
        {props.isCreate ? (
          <button type="button" className="master-btn" onClick={props.onCancel}>
            {t('ruleTab.cancel')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={`master-btn${props.armed ? ' master-btn--danger' : ''}`}
              disabled={props.busy || props.blockedText !== ''}
              onClick={props.onDelete}
            >
              {props.armed ? t('accountTab.deleteConfirm') : t('accountTab.delete')}
            </button>
            {props.status === 'active' && (
              <button type="button" className="master-btn" disabled={props.busy} onClick={() => void props.onDeactivate()}>
                {t('accountTab.deactivate')}
              </button>
            )}
            {props.status === 'inactive' && (
              <button
                type="button"
                className="master-btn"
                disabled={props.busy || resuming}
                onClick={() => {
                  setResumedOn(props.today)
                  setResuming(true)
                }}
              >
                {t('ruleTab.activate')}
              </button>
            )}
          </>
        )}
      </div>
      {props.blockedText !== '' && <p className="master-note">{props.blockedText}</p>}
    </section>
  )
}

type ReactNodeOptions = React.ReactNode
