import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { Project } from '../../domain/project/Project'
import type {
  CreateRecurringTransactionRuleInput,
  RecurringTransactionFrequency,
  RecurringTransactionRule,
  UpdateRecurringTransactionRuleInput,
} from '../../domain/recurring-transaction/RecurringTransactionRule'
import { isCounterpartyEligibleCategory, isManualEntryEligibleAccount } from '../journal-entry/journalEntryFormLine'
import { describeRecurringSchedule } from './describeRecurringSchedule'
import './RecurringTransactionRuleManagementScreen.css'

interface AccountFinder {
  findAll(): Account[] | Promise<Account[]>
}
interface ProjectFinder {
  findAll(): Project[] | Promise<Project[]>
}
interface HouseholdMemberFinder {
  findAll(): HouseholdMember[] | Promise<HouseholdMember[]>
}
interface CounterpartyFinder {
  findAll(): Counterparty[] | Promise<Counterparty[]>
}
interface RuleFinder {
  findAll(): RecurringTransactionRule[] | Promise<RecurringTransactionRule[]>
}
interface RuleCreator {
  create(
    input: CreateRecurringTransactionRuleInput,
  ): RecurringTransactionRule | Promise<RecurringTransactionRule>
}
interface RuleUpdater {
  update(
    id: number,
    input: UpdateRecurringTransactionRuleInput,
  ): RecurringTransactionRule | Promise<RecurringTransactionRule>
}
interface RuleDeleter {
  delete(id: number): void | Promise<void>
}
interface RuleDeactivator {
  deactivate(id: number): RecurringTransactionRule | Promise<RecurringTransactionRule>
}
interface RuleGeneratedCounter {
  countGeneratedJournalEntries(id: number): number | Promise<number>
}

export interface RecurringTransactionRuleManagementScreenProps {
  recurringTransactionRuleRepository: RuleFinder &
    RuleCreator &
    RuleUpdater &
    RuleDeleter &
    RuleDeactivator &
    RuleGeneratedCounter
  accountRepository: AccountFinder
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  onBack: () => void
}

interface LoadedData {
  rules: RecurringTransactionRule[]
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
  /** ルールidごとの生成済みjournal_entries件数(削除可否判定用、1.6節) */
  generatedCountByRuleId: Map<number, number>
}

/** nullは非表示、'create'は新規作成フォーム、number(id)は該当ルールの編集フォームを表す */
type FormMode = 'create' | number | null

type MonthlyMode = 'dayOfMonth' | 'weekday'

interface FormState {
  name: string
  debitAccountId: number | ''
  creditAccountId: number | ''
  amount: string
  frequency: RecurringTransactionFrequency
  monthlyMode: MonthlyMode
  dayOfWeek: number | ''
  dayOfMonth: number | ''
  weekOfMonth: number | ''
  monthOfYear: number | ''
  projectId: number | ''
  householdMemberId: number | ''
  counterpartyId: number | ''
  maxOccurrences: string
}

function emptyFormState(): FormState {
  return {
    name: '',
    debitAccountId: '',
    creditAccountId: '',
    amount: '',
    frequency: 'monthly',
    monthlyMode: 'dayOfMonth',
    dayOfWeek: '',
    dayOfMonth: '',
    weekOfMonth: '',
    monthOfYear: '',
    projectId: '',
    householdMemberId: '',
    counterpartyId: '',
    maxOccurrences: '',
  }
}

function formStateFromRule(rule: RecurringTransactionRule): FormState {
  return {
    name: rule.name,
    debitAccountId: rule.debitAccountId,
    creditAccountId: rule.creditAccountId,
    amount: String(rule.amount),
    frequency: rule.frequency,
    monthlyMode: rule.dayOfMonth !== null && rule.frequency === 'monthly' ? 'dayOfMonth' : 'weekday',
    dayOfWeek: rule.dayOfWeek ?? '',
    dayOfMonth: rule.dayOfMonth ?? '',
    weekOfMonth: rule.weekOfMonth ?? '',
    monthOfYear: rule.monthOfYear ?? '',
    projectId: rule.projectId ?? '',
    householdMemberId: rule.householdMemberId ?? '',
    counterpartyId: rule.counterpartyId ?? '',
    maxOccurrences: rule.maxOccurrences === null ? '' : String(rule.maxOccurrences),
  }
}

/**
 * フォーム入力からRepository送信用の入力(frequencyごとのカラム組み合わせ、
 * docs/domain/recurring-transactions.md 1.3節)を組み立てる。組み合わせが崩れないよう、
 * 使用しないカラムは必ずnullにする(assertValidRecurringScheduleが検証する4パターンに従う)。
 */
function buildScheduleColumns(form: FormState): {
  dayOfWeek: number | null
  dayOfMonth: number | null
  weekOfMonth: number | null
  monthOfYear: number | null
} {
  switch (form.frequency) {
    case 'weekly':
      return {
        dayOfWeek: form.dayOfWeek === '' ? null : form.dayOfWeek,
        dayOfMonth: null,
        weekOfMonth: null,
        monthOfYear: null,
      }
    case 'monthly':
      if (form.monthlyMode === 'dayOfMonth') {
        return {
          dayOfWeek: null,
          dayOfMonth: form.dayOfMonth === '' ? null : form.dayOfMonth,
          weekOfMonth: null,
          monthOfYear: null,
        }
      }
      return {
        dayOfWeek: form.dayOfWeek === '' ? null : form.dayOfWeek,
        dayOfMonth: null,
        weekOfMonth: form.weekOfMonth === '' ? null : form.weekOfMonth,
        monthOfYear: null,
      }
    case 'yearly':
      return {
        dayOfWeek: null,
        dayOfMonth: form.dayOfMonth === '' ? null : form.dayOfMonth,
        weekOfMonth: null,
        monthOfYear: form.monthOfYear === '' ? null : form.monthOfYear,
      }
  }
}

function isFormValid(form: FormState): boolean {
  if (form.name.trim() === '' || form.debitAccountId === '' || form.creditAccountId === '') return false
  const amount = Number(form.amount)
  if (form.amount === '' || !Number.isFinite(amount) || amount <= 0) return false

  const schedule = buildScheduleColumns(form)
  switch (form.frequency) {
    case 'weekly':
      return schedule.dayOfWeek !== null
    case 'monthly':
      return form.monthlyMode === 'dayOfMonth'
        ? schedule.dayOfMonth !== null
        : schedule.dayOfWeek !== null && schedule.weekOfMonth !== null
    case 'yearly':
      return schedule.dayOfMonth !== null && schedule.monthOfYear !== null
  }
}

const WEEK_OF_MONTH_OPTIONS = [1, 2, 3, 4, 5, -1] as const

/**
 * 定期取引ルール管理画面(計画Issue #39)。登録済みルールの一覧表示・新規作成・編集・
 * 非アクティブ化・削除を単一画面+インラインフォームで提供する
 * (docs/domain/recurring-transactions.md 1章・2章)。フォームはfrequencyセレクトの
 * 選択に応じて入力項目を条件分岐させる単一フォームとする(ステップ式ウィザードにはしない、
 * 計画Issue #39でユーザーと合意済みの方針)。物理削除は生成済み仕訳が0件の場合のみ許可し、
 * 1件以上の場合は理由を表示した上で非アクティブ化のみ選択できる(1.6節)。
 */
export function RecurringTransactionRuleManagementScreen({
  recurringTransactionRuleRepository,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  onBack,
}: RecurringTransactionRuleManagementScreenProps) {
  const { t } = useTranslation('recurringTransaction')
  const { t: tCommon } = useTranslation('common')
  const [data, setData] = useState<LoadedData | null>(null)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [form, setForm] = useState<FormState>(emptyFormState())
  const [error, setError] = useState<string | null>(null)
  /** 作成・編集・削除・非アクティブ化のいずれか進行中は全操作ボタンを無効化する(連打による二重実行防止) */
  const [isSubmitting, setIsSubmitting] = useState(false)

  const load = () => {
    void Promise.all([
      Promise.resolve(recurringTransactionRuleRepository.findAll()),
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(async ([rules, accounts, projects, householdMembers, counterparties]) => {
      const generatedCountByRuleId = new Map<number, number>()
      for (const rule of rules) {
        generatedCountByRuleId.set(
          rule.id,
          await Promise.resolve(recurringTransactionRuleRepository.countGeneratedJournalEntries(rule.id)),
        )
      }
      setData({ rules, accounts, projects, householdMembers, counterparties, generatedCountByRuleId })
    })
  }

  useEffect(load, [
    recurringTransactionRuleRepository,
    accountRepository,
    projectRepository,
    householdMemberRepository,
    counterpartyRepository,
  ])

  if (data === null) {
    return <p role="status">{tCommon('loading')}</p>
  }

  const eligibleAccounts = data.accounts.filter(isManualEntryEligibleAccount)
  const accountById = new Map(data.accounts.map((account) => [account.id, account]))

  const openCreateForm = () => {
    setForm(emptyFormState())
    setError(null)
    setFormMode('create')
  }

  const openEditForm = (rule: RecurringTransactionRule) => {
    setForm(formStateFromRule(rule))
    setError(null)
    setFormMode(rule.id)
  }

  const closeForm = () => {
    setFormMode(null)
    setError(null)
  }

  const submitForm = () => {
    if (isSubmitting || !isFormValid(form)) return
    setIsSubmitting(true)
    setError(null)
    const schedule = buildScheduleColumns(form)
    const input = {
      name: form.name.trim(),
      debitAccountId: form.debitAccountId as number,
      creditAccountId: form.creditAccountId as number,
      amount: Number(form.amount),
      frequency: form.frequency,
      ...schedule,
      projectId: form.projectId === '' ? null : form.projectId,
      householdMemberId: form.householdMemberId === '' ? null : form.householdMemberId,
      counterpartyId: form.counterpartyId === '' ? null : form.counterpartyId,
      maxOccurrences: form.maxOccurrences === '' ? null : Number(form.maxOccurrences),
    }

    // Repository呼び出しは.then()コールバック内で行う(Promise.resolve(fn())ではなく
    // Promise.resolve().then(() => fn()))。DDLトリガー違反等でfn()が同期的に例外を
    // 投げる場合、Promise.resolve(fn())だとfn()の評価がPromise.resolve呼び出しより先に
    // 走るため例外が.catch()に届かずisSubmittingがtrueのまま固定されてしまう
    // (docs/decisions.md 2026-08-13参照)。
    void Promise.resolve()
      .then(() =>
        formMode === 'create'
          ? recurringTransactionRuleRepository.create(input)
          : recurringTransactionRuleRepository.update(formMode as number, input),
      )
      .then(() => {
        closeForm()
        load()
      })
      .catch(() => setError(t('saveError')))
      .finally(() => setIsSubmitting(false))
  }

  const deleteRule = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => recurringTransactionRuleRepository.delete(id))
      .then(load)
      .catch(() => setError(t('deleteError')))
      .finally(() => setIsSubmitting(false))
  }

  const deactivateRule = (id: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    void Promise.resolve()
      .then(() => recurringTransactionRuleRepository.deactivate(id))
      .then(load)
      .catch(() => setError(t('deactivateError')))
      .finally(() => setIsSubmitting(false))
  }

  const debitAccount = form.debitAccountId === '' ? null : (accountById.get(form.debitAccountId) ?? null)
  const creditAccount = form.creditAccountId === '' ? null : (accountById.get(form.creditAccountId) ?? null)
  const showCounterpartyField =
    (debitAccount !== null && isCounterpartyEligibleCategory(debitAccount.category)) ||
    (creditAccount !== null && isCounterpartyEligibleCategory(creditAccount.category))

  return (
    <div className="recurring-transaction-rule-management-screen">
      <h2>{t('ruleListTitle')}</h2>

      {error !== null && <p role="alert">{error}</p>}

      {data.rules.length === 0 ? (
        <p>{t('ruleListEmpty')}</p>
      ) : (
        <ul>
          {data.rules.map((rule) => {
            const generatedCount = data.generatedCountByRuleId.get(rule.id) ?? 0
            return (
              <li key={rule.id}>
                <div className="recurring-transaction-rule-list-row">
                  <span className="recurring-transaction-rule-list-name">
                    {rule.name}
                    <span className="recurring-transaction-rule-list-schedule">
                      {describeRecurringSchedule(rule, t)}
                    </span>
                    {!rule.isActive && (
                      <span className="recurring-transaction-rule-list-inactive">{t('inactiveLabel')}</span>
                    )}
                  </span>
                  <span className="recurring-transaction-rule-list-actions">
                    <button type="button" onClick={() => openEditForm(rule)} disabled={isSubmitting}>
                      {t('editButton')}
                    </button>
                    {generatedCount === 0 && (
                      <button type="button" onClick={() => deleteRule(rule.id)} disabled={isSubmitting}>
                        {t('deleteButton')}
                      </button>
                    )}
                    {rule.isActive && (
                      <button type="button" onClick={() => deactivateRule(rule.id)} disabled={isSubmitting}>
                        {t('deactivateButton')}
                      </button>
                    )}
                  </span>
                </div>
                {generatedCount > 0 && <p className="recurring-transaction-rule-delete-disabled-reason">{t('deleteDisabledReason')}</p>}
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
        <div className="recurring-transaction-rule-form">
          <label htmlFor="recurring-rule-name">{t('nameLabel')}</label>
          <input
            id="recurring-rule-name"
            type="text"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />

          <label htmlFor="recurring-rule-debit-account">{t('debitAccountLabel')}</label>
          <select
            id="recurring-rule-debit-account"
            value={form.debitAccountId}
            onChange={(event) =>
              setForm({ ...form, debitAccountId: event.target.value === '' ? '' : Number(event.target.value) })
            }
          >
            <option value="">{t('unselected')}</option>
            {eligibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          <label htmlFor="recurring-rule-credit-account">{t('creditAccountLabel')}</label>
          <select
            id="recurring-rule-credit-account"
            value={form.creditAccountId}
            onChange={(event) =>
              setForm({ ...form, creditAccountId: event.target.value === '' ? '' : Number(event.target.value) })
            }
          >
            <option value="">{t('unselected')}</option>
            {eligibleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          <label htmlFor="recurring-rule-amount">{t('amountLabel')}</label>
          <input
            id="recurring-rule-amount"
            type="number"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />

          <label htmlFor="recurring-rule-frequency">{t('frequencyLabel')}</label>
          <select
            id="recurring-rule-frequency"
            value={form.frequency}
            onChange={(event) =>
              // monthlyModeは編集元ルールのfrequencyから引き継がれたままだと、weeklyのルールを
              // monthlyへ変更した際に(元がweeklyのため)既定で'weekday'側のフィールドが
              // 表示されてしまう(formStateFromRuleはfrequency==='monthly'の場合のみ
              // 'dayOfMonth'を選ぶため)。frequency変更時は常に'dayOfMonth'へ揃え直す。
              setForm({
                ...form,
                frequency: event.target.value as RecurringTransactionFrequency,
                monthlyMode: 'dayOfMonth',
              })
            }
          >
            <option value="weekly">{t('frequencyWeekly')}</option>
            <option value="monthly">{t('frequencyMonthly')}</option>
            <option value="yearly">{t('frequencyYearly')}</option>
          </select>

          {form.frequency === 'weekly' && (
            <>
              <label htmlFor="recurring-rule-day-of-week">{t('dayOfWeekLabel')}</label>
              <select
                id="recurring-rule-day-of-week"
                value={form.dayOfWeek}
                onChange={(event) =>
                  setForm({ ...form, dayOfWeek: event.target.value === '' ? '' : Number(event.target.value) })
                }
              >
                <option value="">{t('unselected')}</option>
                <option value={0}>{t('dayOfWeekSun')}</option>
                <option value={1}>{t('dayOfWeekMon')}</option>
                <option value={2}>{t('dayOfWeekTue')}</option>
                <option value={3}>{t('dayOfWeekWed')}</option>
                <option value={4}>{t('dayOfWeekThu')}</option>
                <option value={5}>{t('dayOfWeekFri')}</option>
                <option value={6}>{t('dayOfWeekSat')}</option>
              </select>
            </>
          )}

          {form.frequency === 'monthly' && (
            <>
              <label htmlFor="recurring-rule-monthly-mode">{t('monthlyModeLabel')}</label>
              <select
                id="recurring-rule-monthly-mode"
                value={form.monthlyMode}
                onChange={(event) => setForm({ ...form, monthlyMode: event.target.value as MonthlyMode })}
              >
                <option value="dayOfMonth">{t('monthlyModeDayOfMonth')}</option>
                <option value="weekday">{t('monthlyModeWeekday')}</option>
              </select>

              {form.monthlyMode === 'dayOfMonth' ? (
                <>
                  <label htmlFor="recurring-rule-day-of-month">{t('dayOfMonthLabel')}</label>
                  <input
                    id="recurring-rule-day-of-month"
                    type="number"
                    min={1}
                    max={31}
                    value={form.dayOfMonth}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dayOfMonth: event.target.value === '' ? '' : Number(event.target.value),
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <label htmlFor="recurring-rule-week-of-month">{t('weekOfMonthLabel')}</label>
                  <select
                    id="recurring-rule-week-of-month"
                    value={form.weekOfMonth}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        weekOfMonth: event.target.value === '' ? '' : Number(event.target.value),
                      })
                    }
                  >
                    <option value="">{t('unselected')}</option>
                    {WEEK_OF_MONTH_OPTIONS.map((week) => (
                      <option key={week} value={week}>
                        {week === -1 ? t('weekOfMonthLast') : t(`weekOfMonth${week}` as const)}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="recurring-rule-day-of-week">{t('dayOfWeekLabel')}</label>
                  <select
                    id="recurring-rule-day-of-week"
                    value={form.dayOfWeek}
                    onChange={(event) =>
                      setForm({ ...form, dayOfWeek: event.target.value === '' ? '' : Number(event.target.value) })
                    }
                  >
                    <option value="">{t('unselected')}</option>
                    <option value={0}>{t('dayOfWeekSun')}</option>
                    <option value={1}>{t('dayOfWeekMon')}</option>
                    <option value={2}>{t('dayOfWeekTue')}</option>
                    <option value={3}>{t('dayOfWeekWed')}</option>
                    <option value={4}>{t('dayOfWeekThu')}</option>
                    <option value={5}>{t('dayOfWeekFri')}</option>
                    <option value={6}>{t('dayOfWeekSat')}</option>
                  </select>
                </>
              )}
            </>
          )}

          {form.frequency === 'yearly' && (
            <>
              <label htmlFor="recurring-rule-month-of-year">{t('monthOfYearLabel')}</label>
              <select
                id="recurring-rule-month-of-year"
                value={form.monthOfYear}
                onChange={(event) =>
                  setForm({ ...form, monthOfYear: event.target.value === '' ? '' : Number(event.target.value) })
                }
              >
                <option value="">{t('unselected')}</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>

              <label htmlFor="recurring-rule-day-of-month">{t('dayOfMonthLabel')}</label>
              <input
                id="recurring-rule-day-of-month"
                type="number"
                min={1}
                max={31}
                value={form.dayOfMonth}
                onChange={(event) =>
                  setForm({ ...form, dayOfMonth: event.target.value === '' ? '' : Number(event.target.value) })
                }
              />
            </>
          )}

          <label htmlFor="recurring-rule-project">{t('projectLabel')}</label>
          <select
            id="recurring-rule-project"
            value={form.projectId}
            onChange={(event) =>
              setForm({ ...form, projectId: event.target.value === '' ? '' : Number(event.target.value) })
            }
          >
            <option value="">{t('unselected')}</option>
            {data.projects
              .filter((project) => project.isActive || project.id === form.projectId)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>

          <label htmlFor="recurring-rule-household-member">{t('householdMemberLabel')}</label>
          <select
            id="recurring-rule-household-member"
            value={form.householdMemberId}
            onChange={(event) =>
              setForm({
                ...form,
                householdMemberId: event.target.value === '' ? '' : Number(event.target.value),
              })
            }
          >
            <option value="">{t('unselected')}</option>
            {data.householdMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          {showCounterpartyField && (
            <>
              <label htmlFor="recurring-rule-counterparty">{t('counterpartyLabel')}</label>
              <select
                id="recurring-rule-counterparty"
                value={form.counterpartyId}
                onChange={(event) =>
                  setForm({
                    ...form,
                    counterpartyId: event.target.value === '' ? '' : Number(event.target.value),
                  })
                }
              >
                <option value="">{t('unselected')}</option>
                {data.counterparties.map((counterparty) => (
                  <option key={counterparty.id} value={counterparty.id}>
                    {counterparty.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <label htmlFor="recurring-rule-max-occurrences">{t('maxOccurrencesLabel')}</label>
          <input
            id="recurring-rule-max-occurrences"
            type="number"
            min={1}
            value={form.maxOccurrences}
            onChange={(event) => setForm({ ...form, maxOccurrences: event.target.value })}
          />

          <div className="recurring-transaction-rule-form-actions">
            <button type="button" onClick={submitForm} disabled={!isFormValid(form) || isSubmitting}>
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
