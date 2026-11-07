import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { RecurringTransactionRule } from '../../domain/recurring-transaction/RecurringTransactionRule'
import type { RecurringTransactionRuleRepository } from '../../domain/recurring-transaction/RecurringTransactionRuleRepository'
import { TreeSelect } from '../common/tree-select/TreeSelect'
import { describeRecurringSchedule } from '../recurring-transaction-management/describeRecurringSchedule'
import { buildTreeSelectCategories } from './buildTreeSelectCategories'
import { describeDeletionBlocks } from './describeDeletionBlocks'
import { buildAccountTree, buildCounterpartyTree, buildProjectTree } from './masterTreeNodes'
import type { MaybeAsync } from './maybeAsync'
import { nextRuleDate } from './nextRuleDate'
import {
  buildRuleInput,
  emptyRuleForm,
  isRuleFormValid,
  ruleFormFromRule,
  type RuleForm,
} from './recurringRuleForm'
import './master.css'

export interface RuleMasterTabProps {
  recurringTransactionRuleRepository: MaybeAsync<
    Pick<
      RecurringTransactionRuleRepository,
      'findAll' | 'create' | 'update' | 'delete' | 'deactivate' | 'countGeneratedJournalEntries'
    >
  >
  accountRepository: MaybeAsync<Pick<AccountRepository, 'findAll'>>
  accountGroupRepository: MaybeAsync<Pick<AccountGroupRepository, 'findAll'>>
  counterpartyRepository: MaybeAsync<Pick<CounterpartyRepository, 'findAll'>>
  counterpartyGroupRepository: MaybeAsync<Pick<CounterpartyGroupRepository, 'findAll'>>
  projectRepository: MaybeAsync<Pick<ProjectRepository, 'findAll'>>
  projectGroupRepository: MaybeAsync<Pick<ProjectGroupRepository, 'findAll'>>
  householdMemberRepository: MaybeAsync<Pick<HouseholdMemberRepository, 'findAll'>>
  /** 「次回」の基準日(YYYY-MM-DD)。省略時は今日 */
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

const yen = (amount: number) => `¥${amount.toLocaleString('ja-JP')}`

/**
 * マスタ画面の「定期取引」タブ(計画Issue #154)。ルールの一覧(名称・借方→貸方・繰り返し・金額・
 * 次回・状態)と、右パネルの作成・編集フォームを持つ。科目・取引先・プロジェクトは選択ツリーで選び、
 * 繰り返し(毎週・毎月の日付または第N曜日・毎年)に応じて入力欄が切り替わる。無効化と、生成済みの
 * 仕訳が無いルールの2回押しの削除ができ、生成済みの仕訳があるルールは削除できず理由を表示する。
 * 再有効化の手段はRepositoryに無いため、現行どおり提供しない。
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
    <div className="master-split">
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
                const next = nextRuleDate(rule, today, data.generatedCounts.get(rule.id) ?? 0)
                return (
                  <tr key={rule.id} className={rule.id === mode ? 'master-table__row--selected' : undefined}>
                    <td>
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
                      <div className="master-note">
                        {`${accountById.get(rule.debitAccountId)?.name ?? ''} → ${accountById.get(rule.creditAccountId)?.name ?? ''}`}
                      </div>
                    </td>
                    <td>{describeRecurringSchedule(rule, tRule)}</td>
                    <td>{yen(rule.amount)}</td>
                    <td>{next === null ? '-' : next.replaceAll('-', '/')}</td>
                    <td>{rule.isActive ? t('ruleTab.active') : t('ruleTab.inactive')}</td>
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
          initial={selectedRule ? ruleFormFromRule(selectedRule) : emptyRuleForm()}
          isCreate={mode === 'create'}
          isActive={selectedRule?.isActive ?? true}
          accountCategories={pickers.accounts}
          counterpartyCategories={pickers.counterparties}
          projectCategories={pickers.projects}
          members={data.members}
          accountById={accountById}
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
  isActive: boolean
  accountCategories: ReturnType<typeof buildTreeSelectCategories>
  counterpartyCategories: ReturnType<typeof buildTreeSelectCategories>
  projectCategories: ReturnType<typeof buildTreeSelectCategories>
  members: readonly HouseholdMember[]
  accountById: ReadonlyMap<number, Account>
  busy: boolean
  armed: boolean
  blockedText: string
  onSubmit: (form: RuleForm) => unknown
  onCancel: () => void
  onDeactivate: () => unknown
  onDelete: () => void
}

/** 定期取引ルールの作成・編集フォーム(右パネル)。入力は下書きとして持ち、保存・登録で確定する */
function RuleForm(props: RuleFormProps) {
  const { t } = useTranslation('master')
  const { t: tRule } = useTranslation('recurringTransaction')
  const [form, setForm] = useState<RuleForm>(props.initial)
  const set = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const num = (value: string): number | '' => (value === '' ? '' : Number(value))
  const isPl = (id: number | '') => {
    const category = id === '' ? undefined : props.accountById.get(id)?.category
    return category === 'expense' || category === 'revenue'
  }
  const showCounterparty = isPl(form.debitAccountId) || isPl(form.creditAccountId)
  const title = t(props.isCreate ? 'ruleTab.createTitle' : 'ruleTab.editTitle')
  const valid = isRuleFormValid(form)
  const monthly = form.frequency === 'monthly'
  const byWeekday = monthly && form.monthlyMode === 'weekday'
  const showDay = form.frequency === 'yearly' || (monthly && !byWeekday)
  const showWeekday = form.frequency === 'weekly' || byWeekday

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
      <h2 className="master-panel__title">{title}</h2>

      <div className="master-field">
        <label className="master-field__label" htmlFor="rule-name">
          {t('ruleTab.name')}
        </label>
        <input id="rule-name" className="master-field__control" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </div>

      <div className="master-field">
        <span className="master-field__label">{t('ruleTab.debit')}</span>
        <TreeSelect
          label={t('ruleTab.debit')}
          categories={props.accountCategories}
          value={form.debitAccountId === '' ? '' : String(form.debitAccountId)}
          onChange={(v) => set('debitAccountId', num(v))}
          placeholder={t('ruleTab.choose')}
        />
      </div>
      <div className="master-field">
        <span className="master-field__label">{t('ruleTab.credit')}</span>
        <TreeSelect
          label={t('ruleTab.credit')}
          categories={props.accountCategories}
          value={form.creditAccountId === '' ? '' : String(form.creditAccountId)}
          onChange={(v) => set('creditAccountId', num(v))}
          placeholder={t('ruleTab.choose')}
        />
      </div>

      <div className="master-field">
        <label className="master-field__label" htmlFor="rule-amount">
          {t('ruleTab.amount')}
        </label>
        <input
          id="rule-amount"
          className="master-field__control"
          inputMode="numeric"
          value={form.amount}
          onChange={(e) => set('amount', e.target.value)}
        />
      </div>

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

      {showCounterparty && (
        <div className="master-field">
          <span className="master-field__label">{t('ruleTab.counterparty')}</span>
          <TreeSelect
            label={t('ruleTab.counterparty')}
            categories={props.counterpartyCategories}
            value={form.counterpartyId === '' ? '' : String(form.counterpartyId)}
            onChange={(v) => set('counterpartyId', num(v))}
            emptyLabel={t('ruleTab.none')}
            placeholder={t('ruleTab.none')}
          />
        </div>
      )}
      <div className="master-field">
        <span className="master-field__label">{t('ruleTab.project')}</span>
        <TreeSelect
          label={t('ruleTab.project')}
          categories={props.projectCategories}
          value={form.projectId === '' ? '' : String(form.projectId)}
          onChange={(v) => set('projectId', num(v))}
          emptyLabel={t('ruleTab.none')}
          placeholder={t('ruleTab.none')}
        />
      </div>
      {select(
        'rule-member',
        t('ruleTab.member'),
        form.householdMemberId,
        (v) => set('householdMemberId', num(v)),
        <>
          <option value="">{t('ruleTab.memberNone')}</option>
          {props.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </>,
      )}
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
            {props.isActive && (
              <button type="button" className="master-btn" disabled={props.busy} onClick={() => void props.onDeactivate()}>
                {t('accountTab.deactivate')}
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
