import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import { previewUpcomingDueDates } from '../../domain/recurring-transaction/previewUpcomingDueDates'
import type { SettlementBatch } from '../../domain/settlement-batch/SettlementBatch'
import { JournalLinesEditor } from '../journal-entry/JournalLinesEditor'
import type { TreeSelectCategory } from '../common/tree-select/treeSelectModel'
import { isRuleFormValid, isScheduleFormValid, ruleFromForm, type RuleForm } from './recurringRuleForm'
import { RuleAmountSchedulePanel } from './RuleAmountSchedulePanel'
import '../journal-entry/JournalEntryEditor.css'
import './master.css'

/** 終了は、is_activeとは独立した状態(終了日の経過・回数の上限への到達)。無効より終了を優先して表示する */
export type RuleStatus = 'active' | 'inactive' | 'ended'

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

const slashDate = (date: string) => date.replaceAll('-', '/')

export interface RuleEditFormProps {
  initial: RuleForm
  /** 渡すと、行の精算バッチの選択肢に「+ 新しいバッチ」を出す(計画Issue #180) */
  onCreateBatch?: (name: string) => Promise<SettlementBatch>
  /** 渡すと、行の取引先の選択ツリーに「+ 新規追加」を出す */
  onRequestCreateCounterparty?: (apply: (id: number) => void) => void
  /** 渡すと、行のプロジェクトの選択ツリーに「+ 新規追加」を出す */
  onRequestCreateProject?: (apply: (id: number) => void) => void
  isCreate: boolean
  /** 保存済みのルールの状態。作成フォームでは常にactive(状態の案内は出さない) */
  status: RuleStatus
  endedReason: string
  today: string
  /** 保存済みのルールの生成済み件数。プレビューの回数の上限の残りの計算に使う */
  generatedCount: number
  accountCategories: readonly TreeSelectCategory[]
  counterpartyCategories: readonly TreeSelectCategory[]
  projectCategories: readonly TreeSelectCategory[]
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
export function RuleEditForm(props: RuleEditFormProps) {
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
        onCreateBatch={props.onCreateBatch}
        onRequestCreateCounterparty={props.onRequestCreateCounterparty}
        onRequestCreateProject={props.onRequestCreateProject}
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
