import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Account } from '../../domain/account/Account'
import type { Counterparty } from '../../domain/counterparty/Counterparty'
import type { HouseholdMember } from '../../domain/household-member/HouseholdMember'
import type { CreateJournalEntryInput, JournalEntry } from '../../domain/journal/JournalEntry'
import type { Project } from '../../domain/project/Project'
import { buildExpenseSplittingJournalEntryInputs } from '../../domain/expense-splitting/buildExpenseSplittingJournalEntryInputs'
import { formatCurrency } from '../../infrastructure/i18n/formatCurrency'
import {
  calculateParticipantAmounts,
  createEmptyParticipantRow,
  toExpenseSplitRecipients,
  type ExpenseSplittingAllocationMode,
  type ExpenseSplittingParticipantRow,
} from './expenseSplittingFormParticipant'
import './ExpenseSplittingForm.css'

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
interface JournalEntryCreator {
  create(input: CreateJournalEntryInput): JournalEntry | Promise<JournalEntry>
}

export interface ExpenseSplittingFormProps {
  /** 割勘対象として選択済みの元の支出仕訳 */
  originalEntry: JournalEntry
  accountRepository: AccountFinder
  projectRepository: ProjectFinder
  householdMemberRepository: HouseholdMemberFinder
  counterpartyRepository: CounterpartyFinder
  journalEntryRepository: JournalEntryCreator
  onComplete: (createdEntries: JournalEntry[]) => void
  onBack: () => void
  /** 割勘仕訳の取引日の既定値(YYYY-MM-DD)。省略時は本日の日付 */
  today?: string
}

interface MasterData {
  accounts: Account[]
  projects: Project[]
  householdMembers: HouseholdMember[]
  counterparties: Counterparty[]
}

/**
 * 割勘起票フォーム(計画Issue #40)。世帯メンバー間(docs/domain/expense-splitting.md
 * 1.3節)・世帯外相手(同1.4節)との割勘を、複式簿記の概念(借方/貸方・仕訳明細)を
 * 見せない単一フォームで起票する。分担者は世帯メンバー・世帯外相手の混在を含め
 * 複数選択でき、配分方法(均等割/カスタム比率/金額直接指定)を選んで按分額を計算する
 * (計算結果は確定前に手動修正できる編集可能なプレビュー)。確定操作では、立替者を
 * 除いた分担者ごとにbuildExpenseSplittingJournalEntryInputsで組み立てた仕訳を
 * 1件ずつ作成する(複数人割勘は複数の2者間仕訳として実現する、計画Issue #40の合意事項)。
 */
export function ExpenseSplittingForm({
  originalEntry,
  accountRepository,
  projectRepository,
  householdMemberRepository,
  counterpartyRepository,
  journalEntryRepository,
  onComplete,
  onBack,
  today,
}: ExpenseSplittingFormProps) {
  const { t } = useTranslation('expenseSplitting')
  const { t: tCommon } = useTranslation('common')

  const [masterData, setMasterData] = useState<MasterData | null>(null)
  const [advanceAssetAccountId, setAdvanceAssetAccountId] = useState<number | null>(null)
  const [advanceLiabilityAccountId, setAdvanceLiabilityAccountId] = useState<number | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [allocationMode, setAllocationMode] = useState<ExpenseSplittingAllocationMode>('equal')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const rowKeyRef = useRef(0)
  const createRow = () => {
    rowKeyRef.current += 1
    return createEmptyParticipantRow(rowKeyRef.current)
  }
  const [participants, setParticipants] = useState<ExpenseSplittingParticipantRow[]>(() => [createRow()])

  const originalExpenseLine = masterData
    ? originalEntry.lines.find(
        (line) => masterData.accounts.find((account) => account.id === line.accountId)?.category === 'expense',
      )
    : undefined
  const [totalAmountInput, setTotalAmountInput] = useState<string>('')

  if (masterData === null) {
    void Promise.all([
      Promise.resolve(accountRepository.findAll()),
      Promise.resolve(projectRepository.findAll()),
      Promise.resolve(householdMemberRepository.findAll()),
      Promise.resolve(counterpartyRepository.findAll()),
    ]).then(([accounts, projects, householdMembers, counterparties]) => {
      const expenseLine = originalEntry.lines.find(
        (line) => accounts.find((account) => account.id === line.accountId)?.category === 'expense',
      )
      setTotalAmountInput(expenseLine ? String(expenseLine.amount) : '')
      setMasterData({ accounts, projects, householdMembers, counterparties })
    })
    return <p role="status">{tCommon('loading')}</p>
  }

  const assetAccounts = masterData.accounts.filter((account) => account.category === 'asset')
  const liabilityAccounts = masterData.accounts.filter((account) => account.category === 'liability')
  const settlementProjects = masterData.projects.filter((project) => project.kind === 'settlement')

  function updateRow(key: number, updater: (row: ExpenseSplittingParticipantRow) => ExpenseSplittingParticipantRow) {
    setParticipants((prev) => prev.map((row) => (row.key === key ? updater(row) : row)))
  }

  function addRow() {
    setParticipants((prev) => [...prev, createRow()])
  }

  function removeRow(key: number) {
    setParticipants((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.key !== key)))
  }

  function handleCalculate() {
    const totalAmount = Number(totalAmountInput)
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return
    const amounts = calculateParticipantAmounts(totalAmount, participants, allocationMode)
    setParticipants((prev) =>
      prev.map((row) => ({ ...row, amountInput: String(amounts.get(String(row.key)) ?? 0) })),
    )
  }

  async function handleSubmit() {
    if (submitting) return
    setError(null)

    if (originalExpenseLine === undefined) {
      setError(t('expenseAccountNotFoundError'))
      return
    }
    if (advanceAssetAccountId === null || projectId === null) {
      setError(t('requiredFieldMissingError'))
      return
    }

    /**
     * 世帯メンバー分担者はadvanceLiabilityAccountIdが無いと仕訳を組み立てられない
     * (toExpenseSplitRecipientsが黙って除外する)。ここで事前に検証しないと、
     * 世帯外相手の行が1件でも有効な場合にnoRecipientErrorをすり抜け、世帯メンバー分の
     * 割勘だけが無警告で消失したまま確定されてしまう(evaluatorレビュー指摘、
     * 計画Issue #40 Review Attempt 1対応)。
     */
    const hasHouseholdMemberParticipant = participants.some(
      (row) => row.kind === 'householdMember' && row.targetId !== null,
    )
    if (hasHouseholdMemberParticipant && advanceLiabilityAccountId === null) {
      setError(t('advanceLiabilityAccountRequiredError'))
      return
    }

    const recipients = toExpenseSplitRecipients(participants, advanceLiabilityAccountId)
    if (recipients.length === 0) {
      setError(t('noRecipientError'))
      return
    }

    const inputs = buildExpenseSplittingJournalEntryInputs({
      originalEntryId: originalEntry.id,
      expenseAccountId: originalExpenseLine.accountId,
      advanceAssetAccountId,
      fromMemberId: originalEntry.householdMemberId,
      projectId,
      entryDate: today ?? new Date().toISOString().slice(0, 10),
      memo: originalEntry.memo === null ? null : t('splitMemoTemplate', { memo: originalEntry.memo }),
      recipients,
    })

    setSubmitting(true)
    try {
      const created: JournalEntry[] = []
      for (const input of inputs) {
        created.push(await journalEntryRepository.create(input))
      }
      onComplete(created)
    } catch {
      setError(t('submitError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="expense-splitting-form">
      <h2>{t('formTitle')}</h2>

      <div className="expense-splitting-original-entry">
        <span>{originalEntry.entryDate}</span>
        <span>{originalEntry.memo}</span>
        {originalExpenseLine !== undefined && <span>{formatCurrency(originalExpenseLine.amount, 'JPY')}</span>}
      </div>

      <div>
        <label htmlFor="expense-splitting-advance-asset">{t('advanceAssetAccountLabel')}</label>
        <select
          id="expense-splitting-advance-asset"
          value={advanceAssetAccountId ?? ''}
          onChange={(event) =>
            setAdvanceAssetAccountId(event.target.value === '' ? null : Number(event.target.value))
          }
        >
          <option value="">{t('unselected')}</option>
          {assetAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="expense-splitting-advance-liability">{t('advanceLiabilityAccountLabel')}</label>
        <select
          id="expense-splitting-advance-liability"
          value={advanceLiabilityAccountId ?? ''}
          onChange={(event) =>
            setAdvanceLiabilityAccountId(event.target.value === '' ? null : Number(event.target.value))
          }
        >
          <option value="">{t('unselected')}</option>
          {liabilityAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="expense-splitting-project">{t('projectLabel')}</label>
        <select
          id="expense-splitting-project"
          value={projectId ?? ''}
          onChange={(event) => setProjectId(event.target.value === '' ? null : Number(event.target.value))}
        >
          <option value="">{t('unselected')}</option>
          {settlementProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="expense-splitting-total-amount">{t('totalAmountLabel')}</label>
        <input
          id="expense-splitting-total-amount"
          type="number"
          value={totalAmountInput}
          onChange={(event) => setTotalAmountInput(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="expense-splitting-allocation-mode">{t('allocationModeLabel')}</label>
        <select
          id="expense-splitting-allocation-mode"
          value={allocationMode}
          onChange={(event) => setAllocationMode(event.target.value as ExpenseSplittingAllocationMode)}
        >
          <option value="equal">{t('allocationModeEqual')}</option>
          <option value="ratio">{t('allocationModeRatio')}</option>
          <option value="amount">{t('allocationModeAmount')}</option>
        </select>
      </div>

      {participants.map((row, index) => {
        const targetOptions =
          row.kind === 'householdMember'
            ? masterData.householdMembers.filter((member) => member.id !== originalEntry.householdMemberId)
            : masterData.counterparties
        const idPrefix = `expense-splitting-participant-${row.key}`
        return (
          <fieldset key={row.key}>
            <legend>{t('participantGroupLabel', { index: index + 1 })}</legend>

            <label htmlFor={`${idPrefix}-kind`}>{t('participantKindLabel')}</label>
            <select
              id={`${idPrefix}-kind`}
              value={row.kind}
              onChange={(event) =>
                updateRow(row.key, (current) => ({
                  ...current,
                  kind: event.target.value as ExpenseSplittingParticipantRow['kind'],
                  targetId: null,
                }))
              }
            >
              <option value="householdMember">{t('participantKindHouseholdMember')}</option>
              <option value="counterparty">{t('participantKindCounterparty')}</option>
            </select>

            <label htmlFor={`${idPrefix}-target`}>{t('participantTargetLabel')}</label>
            <select
              id={`${idPrefix}-target`}
              value={row.targetId ?? ''}
              onChange={(event) =>
                updateRow(row.key, (current) => ({
                  ...current,
                  targetId: event.target.value === '' ? null : Number(event.target.value),
                }))
              }
            >
              <option value="">{t('unselected')}</option>
              {targetOptions.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>

            {allocationMode === 'ratio' && (
              <>
                <label htmlFor={`${idPrefix}-ratio`}>{t('participantRatioLabel')}</label>
                <input
                  id={`${idPrefix}-ratio`}
                  type="number"
                  value={row.ratioInput}
                  onChange={(event) =>
                    updateRow(row.key, (current) => ({ ...current, ratioInput: event.target.value }))
                  }
                />
              </>
            )}

            <label htmlFor={`${idPrefix}-amount`}>{t('participantAmountLabel')}</label>
            <input
              id={`${idPrefix}-amount`}
              type="number"
              value={row.amountInput}
              readOnly={allocationMode !== 'amount'}
              onChange={(event) =>
                updateRow(row.key, (current) => ({ ...current, amountInput: event.target.value }))
              }
            />

            <button type="button" onClick={() => removeRow(row.key)} disabled={participants.length <= 1}>
              {t('removeParticipant')}
            </button>
          </fieldset>
        )
      })}

      <button type="button" onClick={addRow}>
        {t('addParticipant')}
      </button>

      {allocationMode !== 'amount' && (
        <button type="button" onClick={handleCalculate}>
          {t('calculate')}
        </button>
      )}

      {error !== null && <p role="alert">{error}</p>}

      <div>
        <button type="button" onClick={onBack} disabled={submitting}>
          {t('back')}
        </button>
        <button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {t('confirmSplit')}
        </button>
      </div>
    </div>
  )
}
