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
import { isRecurringRuleEnded } from '../../domain/recurring-transaction/isRecurringRuleEnded'
import { previewUpcomingDueDates } from '../../domain/recurring-transaction/previewUpcomingDueDates'
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { TreeSelect } from '../common/tree-select/TreeSelect'
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
  const [error, setError] = useState('')
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
  } = props
  const today = props.today ?? new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    const [rules, accounts, accountGroups, counterparties, counterpartyGroups, projects, projectGroups, members] =
      await Promise.all([
        ruleRepo.findAll(),
        accountRepository.findAll(),
        accountGroupRepository.findAll(),
        counterpartyRepository.findAll(),
        counterpartyGroupRepository.findAll(),
        projectRepository.findAll(),
        projectGroupRepository.findAll(),
        householdMemberRepository.findAll(),
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

  const accountById = new Map(data.accounts.map((a) => [a.id, a]))
  const projectNameById = new Map(data.projects.map((p) => [p.id, p.name]))
  const run = async (action: () => unknown, errorMessage: string) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
    } catch {
      setError(errorMessage)
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
              setError('')
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
                          setError('')
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
                      {yen(rule.amount)}
                      {rule.amountMode === 'last_confirmed' && <p className="master-note">{t('ruleTab.lastConfirmed')}</p>}
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

      {error && (
        <p role="alert" className="master-error master-split__alert">
          {error}
        </p>
      )}

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
          accountById={accountById}
          projectNameById={projectNameById}
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
  accountById: ReadonlyMap<number, Account>
  projectNameById: ReadonlyMap<number, string>
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
 * 定期取引ルールの作成・編集フォーム(右パネル)。入力は下書きとして持ち、保存・登録で確定する。
 * 借方・貸方の行の部分は仕訳エディタと同じ見た目(journal-editorのCSS)で、今のルールの表で持てない項目
 * (行の追加・削除、貸方の金額、貸方のプロジェクト、行ごとの世帯メンバー)は無効の表示にする
 * (複数行への対応・共通部品化・精算バッチは計画Issue #180で扱う)。
 */
function RuleForm(props: RuleFormProps) {
  const { t } = useTranslation('master')
  const { t: tRule } = useTranslation('recurringTransaction')
  const [form, setForm] = useState<RuleForm>(props.initial)
  const [resuming, setResuming] = useState(false)
  const [resumedOn, setResumedOn] = useState(props.today)
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const num = (value: string): number | '' => (value === '' ? '' : Number(value))
  const isPl = (id: number | '') => {
    const category = id === '' ? undefined : props.accountById.get(id)?.category
    return category === 'expense' || category === 'revenue'
  }
  // 取引先は、仕訳エディタと同じく費用・収益の科目の行にだけ出す(両方なら借方の行)
  const debitHasCounterparty = isPl(form.debitAccountId)
  const creditHasCounterparty = !debitHasCounterparty && isPl(form.creditAccountId)
  const title = t(props.isCreate ? 'ruleTab.createTitle' : 'ruleTab.editTitle')
  const valid = isRuleFormValid(form)
  const monthly = form.frequency === 'monthly'
  const byWeekday = monthly && form.monthlyMode === 'weekday'
  const showDay = form.frequency === 'yearly' || (monthly && !byWeekday)
  const showWeekday = form.frequency === 'weekly' || byWeekday
  const amountNumber = Number(form.amount)
  const total = Number.isFinite(amountNumber) ? amountNumber : 0
  const projectName = form.projectId === '' ? t('ruleTab.none') : (props.projectNameById.get(form.projectId) ?? t('ruleTab.none'))

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

  const counterpartyField = (
    <div className="journal-editor__sub-field">
      <TreeSelect
        label={t('ruleTab.counterparty')}
        categories={props.counterpartyCategories}
        value={form.counterpartyId === '' ? '' : String(form.counterpartyId)}
        onChange={(v) => set('counterpartyId', num(v))}
        emptyLabel={t('ruleTab.none')}
        placeholder={t('ruleTab.none')}
      />
    </div>
  )

  /** 今のルールの表では行ごとに持てない世帯メンバー(起票者に従う)。無効の表示にする */
  const memberFollowsField = (
    <select
      disabled
      className="journal-editor__control journal-editor__select"
      aria-label={t('ruleTab.memberFollowsLabel')}
      value="follows"
    >
      <option value="follows">{t('ruleTab.memberFollows')}</option>
    </select>
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
        <p className="master-note">{t('ruleTab.amountModeHint')}</p>
      </fieldset>

      <div className="journal-editor__columns">
        <section role="group" aria-label={t('ruleTab.debitColumn')} className="journal-editor__column">
          <header className="journal-editor__column-head">
            <span>{t('ruleTab.debitColumn')}</span>
            <span className="journal-editor__amount-text">{yen(total)}</span>
          </header>
          <div className="journal-editor__line">
            <div className="journal-editor__line-main">
              <div className="journal-editor__grow">
                <TreeSelect
                  label={t('ruleTab.debit')}
                  categories={props.accountCategories}
                  value={form.debitAccountId === '' ? '' : String(form.debitAccountId)}
                  onChange={(v) => set('debitAccountId', num(v))}
                  placeholder={t('ruleTab.choose')}
                />
              </div>
              <input
                id="rule-amount"
                className="journal-editor__control journal-editor__amount"
                inputMode="numeric"
                aria-label={t('ruleTab.amount')}
                value={form.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
              <button type="button" className="journal-editor__icon-button" aria-label={t('ruleTab.deleteRow')} disabled>
                ×
              </button>
            </div>
            <div className="journal-editor__line-sub">
              {debitHasCounterparty && counterpartyField}
              <div className="journal-editor__sub-field">
                <TreeSelect
                  label={t('ruleTab.project')}
                  categories={props.projectCategories}
                  value={form.projectId === '' ? '' : String(form.projectId)}
                  onChange={(v) => set('projectId', num(v))}
                  emptyLabel={t('ruleTab.none')}
                  placeholder={t('ruleTab.none')}
                />
              </div>
              {memberFollowsField}
            </div>
          </div>
          <button type="button" className="journal-editor__add" disabled>
            {t('ruleTab.addDebitRow')}
          </button>
        </section>

        <section role="group" aria-label={t('ruleTab.creditColumn')} className="journal-editor__column">
          <header className="journal-editor__column-head">
            <span>{t('ruleTab.creditColumn')}</span>
            <span className="journal-editor__amount-text">{yen(total)}</span>
          </header>
          <div className="journal-editor__line">
            <div className="journal-editor__line-main">
              <div className="journal-editor__grow">
                <TreeSelect
                  label={t('ruleTab.credit')}
                  categories={props.accountCategories}
                  value={form.creditAccountId === '' ? '' : String(form.creditAccountId)}
                  onChange={(v) => set('creditAccountId', num(v))}
                  placeholder={t('ruleTab.choose')}
                />
              </div>
              <input
                disabled
                className="journal-editor__control journal-editor__amount"
                aria-label={t('ruleTab.creditAmount')}
                value={form.amount}
                readOnly
              />
              <button type="button" className="journal-editor__icon-button" aria-label={t('ruleTab.deleteRow')} disabled>
                ×
              </button>
            </div>
            <div className="journal-editor__line-sub">
              {creditHasCounterparty && counterpartyField}
              <select
                disabled
                className="journal-editor__control journal-editor__select"
                aria-label={t('ruleTab.creditProject')}
                value="same"
              >
                <option value="same">{projectName}</option>
              </select>
              {memberFollowsField}
            </div>
          </div>
          <button type="button" className="journal-editor__add" disabled>
            {t('ruleTab.addCreditRow')}
          </button>
        </section>
      </div>
      <div role="status" className="journal-editor__balance">
        {t('ruleTab.balanced')}
      </div>

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
